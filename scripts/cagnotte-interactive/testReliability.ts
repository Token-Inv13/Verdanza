import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  RECIPE_HOST,
  RECIPE_PORTS,
} from "./constants.js";
import {
  coordinateRecipeStartup,
  isRecipeStartupCancelled,
  ownedProcessReliabilitySnapshot,
  RecipeStartupCancelledError,
  spawnOwned,
  startRecipeHarness,
  stopOwnedProcess,
  waitForOwnedProcessLog,
  type OwnedProcess,
  type RecipeHarness,
  type SpawnOwnedOptions,
  type RecipeStartupDriver,
} from "./harness.js";
import { runRecipeCommand } from "./run.js";
import {
  configureOwnedResource,
  runWithViewportResources,
  type CleanupReport,
  type ViewportResourceDependencies,
} from "./resourceLifecycle.js";
import {
  assertNoUnexpectedRuntimeFailures,
  type ConsoleEvidence,
  type FirestoreListenProbeEvidence,
  type NetworkEvidence,
} from "./runtimeDiagnostics.js";

type FakeHarness = { stopCalls: number };
type FakeMonitor = { role: "client" | "admin"; closeCalls: number };
type FakePage = { role: "client" | "admin"; closeCalls: number };

const failures: Array<{ name: string; error: string }> = [];

if (process.argv.includes("--signal-child")) {
  await runSignalChild();
} else if (process.argv.includes("--owned-tree-parent")) {
  await runOwnedTreeParent();
} else {

await check("spawnOwned contient un EACCES d'ouverture du log", async () => {
  const diagnostics: string[] = [];
  const fixture = await spawnReliabilityProcess(
    "log-open-eacces",
    ["-e", "setTimeout(() => process.stdout.write('done'), 25)"],
    "one-shot",
    {
      createLogStream: () => {
        const stream = passthroughLogStream();
        process.nextTick(() => stream.emit("error", codedError("EACCES")));
        return stream;
      },
      diagnosticWrite: (value) => diagnostics.push(value),
    },
  );
  try {
    assert.equal(await waitForChildExit(fixture.owned.child, 5_000), 0);
    await waitForOwnedProcessLog(fixture.owned);
    const outcome = await stopOwnedProcess(fixture.owned);
    assert.deepEqual(outcome.log.issues, [{ phase: "open", code: "EACCES", auxiliary: true }]);
    assert.equal(outcome.log.status, "incomplete");
    assert.equal(outcome.log.finalized, true);
    assert.equal(ownedProcessReliabilitySnapshot(fixture.owned).log.status, "incomplete");
    assert.equal(diagnostics.length, 1, "le secours expurgé ne doit être écrit qu'une fois");
    assert.equal(diagnostics[0]?.includes("injected"), false, "le secours ne doit pas recopier le message brut");
  } finally {
    await cleanupReliabilityProcess(fixture);
  }
});

await check("spawnOwned coupe les écritures après ENOSPC tout en drainant l'enfant vivant", async () => {
  const failureObserved = deferred<void>();
  let writes = 0;
  const fixture = await spawnReliabilityProcess(
    "log-write-enospc",
    ["-e", "process.stdout.write('ready\\n');setInterval(() => process.stdout.write('tail\\n'), 2)"],
    "service",
    {
      createLogStream: () => {
        const stream = new Writable({
          write(_chunk, _encoding, callback) {
            writes += 1;
            callback();
            if (writes === 1) {
              process.nextTick(() => {
                stream.emit("error", codedError("ENOSPC"));
                failureObserved.resolve();
              });
            }
          },
        });
        process.nextTick(() => stream.emit("open", 1));
        return stream;
      },
      stopGracePeriodMs: 100,
      stopForcePeriodMs: 2_000,
    },
  );
  try {
    await failureObserved.promise;
    assert.equal(fixture.owned.child.exitCode, null, "l'enfant doit être vivant lors de l'ENOSPC");
    const writesAfterFailure = writes;
    await delay(50);
    assert.equal(writes, writesAfterFailure, "aucun chunk suivant ne doit être accumulé dans le log défaillant");
    const outcome = await stopOwnedProcess(fixture.owned);
    assert.equal(outcome.log.issues.some((issue) => issue.phase === "write" && issue.code === "ENOSPC"), true);
    assert.equal(outcome.childStopped, true);
  } finally {
    await cleanupReliabilityProcess(fixture);
  }
});

await check("spawnOwned borne et signale une erreur de fermeture du log", async () => {
  const fixture = await spawnReliabilityProcess(
    "log-close-failure",
    ["-e", "process.stdout.write('complete')"],
    "one-shot",
    {
      createLogStream: () => {
        const stream = new Writable({
          write(_chunk, _encoding, callback) { callback(); },
          final(callback) { callback(codedError("ECLOSE")); },
        });
        process.nextTick(() => stream.emit("open", 1));
        return stream;
      },
      logCloseTimeoutMs: 100,
    },
  );
  try {
    assert.equal(await waitForChildExit(fixture.owned.child, 5_000), 0);
    await waitForOwnedProcessLog(fixture.owned);
    const report = fixture.owned.logReport;
    assert.equal(report?.finalized, true);
    assert.equal(report?.issues.some((issue) => issue.phase === "close" && issue.code === "ECLOSE"), true);
    await stopOwnedProcess(fixture.owned);
  } finally {
    await cleanupReliabilityProcess(fixture);
  }
});

await check("spawnOwned conserve les dernières sorties entre exit et close", async () => {
  const chunks: string[] = [];
  const fixture = await spawnReliabilityProcess(
    "log-after-exit",
    ["-e", "setTimeout(() => process.stdout.write('FINAL_AFTER_EXIT'), 120)"],
    "one-shot",
    { createLogStream: () => collectingLogStream(chunks) },
  );
  try {
    fixture.owned.child.emit("exit", 0, null);
    assert.equal(fixture.owned.logReport?.finalized, false, "exit seul ne doit pas fermer le log");
    assert.equal(await waitForChildExit(fixture.owned.child, 5_000), 0);
    await waitForOwnedProcessLog(fixture.owned);
    assert.match(chunks.join(""), /FINAL_AFTER_EXIT/);
    assert.equal(fixture.owned.childClosed, true);
    await stopOwnedProcess(fixture.owned);
  } finally {
    await cleanupReliabilityProcess(fixture);
  }
});

await check("spawnOwned conserve l'échec de démarrage et finalise son log", async () => {
  const chunks: string[] = [];
  const fixture = await spawnReliabilityProcess(
    "spawn-error",
    [],
    "one-shot",
    {
      command: resolve(tmpdir(), `verdanza-missing-command-${process.pid}`),
      createLogStream: () => collectingLogStream(chunks),
    },
  );
  try {
    await waitForCondition(() => fixture.owned.spawnError !== undefined, "erreur spawn ENOENT");
    await waitForOwnedProcessLog(fixture.owned);
    assert.equal((fixture.owned.spawnError as NodeJS.ErrnoException | undefined)?.code, "ENOENT");
    assert.match(chunks.join(""), /\[spawn-error\] code=ENOENT/);
    const outcome = await stopOwnedProcess(fixture.owned);
    assert.equal(outcome.log.finalized, true);
  } finally {
    await cleanupReliabilityProcess(fixture);
  }
});

await check("une écriture parent défaillante reste un diagnostic auxiliaire borné", async () => {
  const chunks: string[] = [];
  const diagnostics: string[] = [];
  const fixture = await spawnReliabilityProcess(
    "parent-output-failure",
    ["-e", "process.stdout.write('kept-in-log')"],
    "one-shot",
    {
      createLogStream: () => collectingLogStream(chunks),
      parentStdoutWrite: () => { throw codedError("EPIPE"); },
      diagnosticWrite: (value) => diagnostics.push(value),
    },
  );
  try {
    assert.equal(await waitForChildExit(fixture.owned.child, 5_000), 0);
    await waitForOwnedProcessLog(fixture.owned);
    assert.match(chunks.join(""), /kept-in-log/);
    assert.deepEqual(fixture.owned.logReport?.issues, [{ phase: "parent-output", code: "EPIPE", auxiliary: true }]);
    assert.equal(diagnostics.length, 1);
    await stopOwnedProcess(fixture.owned);
  } finally {
    await cleanupReliabilityProcess(fixture);
  }
});

await check("les signaux sont inscrits avant le démarrage et le nettoyage reste unique", async () => {
  const signals = new EventEmitter();
  let starts = 0;
  let cleanupCalls = 0;
  const messages: string[] = [];
  const result = await runRecipeCommand({
    signalSource: signals,
    startHarness: async (signal) => {
      starts += 1;
      signals.emit("SIGINT");
      signals.emit("SIGTERM");
      assert.equal(signal.aborted, true, "le premier signal doit annuler immédiatement le démarrage");
      cleanupCalls += 1;
      throw new RecipeStartupCancelledError();
    },
    printAccess: () => assert.fail("aucun accès READY ne doit être imprimé"),
    writeLine: (message) => messages.push(message),
  });
  assert.equal(result, "STARTUP_CANCELLED");
  assert.equal(starts, 1);
  assert.equal(cleanupCalls, 1, "un second signal ne doit pas lancer un nettoyage concurrent");
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
  assert.equal(messages.some((message) => message.includes("ANNULÉE")), true);
});

await check("un second signal pendant l’arrêt ne concurrence pas la finalisation", async () => {
  const signals = new EventEmitter();
  const ready = deferred<void>();
  const cleanupStarted = deferred<void>();
  const releaseCleanup = deferred<void>();
  let stopCalls = 0;
  const command = runRecipeCommand({
    signalSource: signals,
    startHarness: async () => ({
      stop: async () => {
        stopCalls += 1;
        cleanupStarted.resolve();
        await releaseCleanup.promise;
      },
    }),
    printAccess: () => ready.resolve(),
    writeLine: () => undefined,
  });
  await ready.promise;
  signals.emit("SIGTERM");
  await cleanupStarted.promise;
  signals.emit("SIGINT");
  assert.equal(stopCalls, 1);
  assert.equal(signals.listenerCount("SIGINT"), 1, "les handlers restent présents pendant le nettoyage");
  assert.equal(signals.listenerCount("SIGTERM"), 1, "les handlers restent présents pendant le nettoyage");
  releaseCleanup.resolve();
  assert.equal(await command, "STOPPED");
  assert.equal(stopCalls, 1);
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});

await check("annulation avant le premier processus", async () => {
  const controller = new AbortController();
  controller.abort();
  const fixture = controlledStartupDriver(controller.signal, "never");
  await assert.rejects(coordinateRecipeStartup(fixture.driver), isRecipeStartupCancelled);
  assert.deepEqual(fixture.events, [], "aucun service ne doit démarrer après une annulation déjà demandée");
});

await check("annulation pendant la disponibilité émulateur interrompt la suite", async () => {
  const controller = new AbortController();
  const fixture = controlledStartupDriver(controller.signal, "emulator-readiness");
  const startup = coordinateRecipeStartup(fixture.driver);
  await fixture.reached.promise;
  controller.abort();
  await assert.rejects(startup, isRecipeStartupCancelled);
  assert.equal(fixture.events.includes("acquire:firebase-emulators"), true);
  assert.equal(fixture.events.some((entry) => entry.startsWith("one-shot:")), false);
  assert.equal(fixture.events.includes("acquire:local-api"), false);
});

await check("annulation pendant le one-shot seed n’admet aucun service suivant", async () => {
  const controller = new AbortController();
  const fixture = controlledStartupDriver(controller.signal, "seed");
  const startup = coordinateRecipeStartup(fixture.driver);
  await fixture.reached.promise;
  controller.abort();
  await assert.rejects(startup, isRecipeStartupCancelled);
  assert.equal(fixture.events.includes("one-shot:seed"), true);
  assert.equal(fixture.events.includes("one-shot:warm-firestore-listen"), false);
  assert.equal(fixture.events.includes("acquire:local-api"), false);
});

await check("acquisition API achevée pendant l’annulation est arrêtée avant Vite", async () => {
  const controller = new AbortController();
  const fixture = controlledStartupDriver(controller.signal, "api-readiness-late-success");
  const startup = coordinateRecipeStartup(fixture.driver);
  await fixture.reached.promise;
  controller.abort();
  fixture.release.resolve();
  await assert.rejects(startup, isRecipeStartupCancelled);
  assert.equal(fixture.events.includes("acquire:local-api"), true);
  assert.equal(fixture.events.includes("ready:local-api"), false);
  assert.equal(fixture.events.includes("acquire:vite-app"), false);
});

await check("un code de sortie API non nul invalide le résultat d’arrêt", async () => {
  const child = spawn(process.execPath, [
    "-e",
    'process.stdin.once("data",()=>{process.exitCode=1;process.stdin.pause()});console.log("OWNED_API_READY")',
  ], {
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
  await waitForOutput(child, () => stdout.includes("OWNED_API_READY"), 5_000);
  let gracefulCalls = 0;
  const owned: OwnedProcess = {
    name: "local-api",
    kind: "service",
    child,
    logPath: "synthetic-owned-api.log",
    stopRequested: false,
    gracefulStop: async () => {
      gracefulCalls += 1;
      child.stdin?.end("stop\n");
    },
  };
  await assert.rejects(stopOwnedProcess(owned), /arrêt en échec/);
  await assert.rejects(stopOwnedProcess(owned), /arrêt en échec/);
  assert.equal(gracefulCalls, 1, "le même arrêt en échec ne doit pas être rejoué");
  assert.equal(child.exitCode, 1);
});

await check("vrai harness annule et nettoie le premier processus possédé", async () => {
  const controller = new AbortController();
  const acquiredNames: string[] = [];
  let startupError: unknown;
  try {
    await startRecipeHarness("startup-cancel-real", {
      signal: controller.signal,
      onLifecycleEvent: (event) => {
        if (event.type !== "process-acquired") return;
        acquiredNames.push(event.name);
        if (event.name === "firebase-emulators") controller.abort();
      },
    });
  } catch (error) {
    startupError = error;
  }
  assert.equal(isRecipeStartupCancelled(startupError), true);
  assert.deepEqual(acquiredNames, ["firebase-emulators"], "aucun processus ne doit être créé après l’annulation");
  assert.deepEqual(await occupiedRecipePorts(), [], "les sept ports doivent être libres après l’annulation");
  const runDirectory = String((startupError as { runDirectory?: unknown })?.runDirectory ?? "");
  assert.ok(runDirectory, "le dossier de diagnostic de l’annulation doit rester traçable");
  const cleanup = JSON.parse(await readFile(`${runDirectory}/cleanup.json`, "utf8")) as {
    startupState?: string;
    ownedProcesses?: Array<{ name?: string }>;
  };
  assert.equal(cleanup.startupState, "CANCELLED");
  assert.deepEqual(cleanup.ownedProcesses?.map((entry) => entry.name), ["firebase-emulators"]);
});

if (process.platform === "win32") {
  await check("Windows distingue l’annulation logique d’un vrai Ctrl+C", async () => {
    assert.equal(process.platform, "win32");
    console.log("[INFO] Aucun process.kill(SIGINT) n’est présenté comme preuve Ctrl+C sous Windows.");
    console.log("[INFO] Tests d'arbre de processus Unix NON EXÉCUTÉS localement sous Windows ; ils restent obligatoires dans verify sous Linux.");
  });
} else {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    await check(`signal ${signal} réel reçu pendant le démarrage`, async () => {
      await assertRealStartupSignal(signal);
    });
  }
  await check("le repli forcé arrête le groupe possédé et épargne le témoin", async () => {
    const witness = spawn(process.execPath, [
      "-e",
      "process.on('SIGINT',()=>{});process.stdout.write('WITNESS_READY');setInterval(()=>{},1000)",
    ], {
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let witnessOutput = "";
    witness.stdout?.on("data", (chunk) => { witnessOutput += String(chunk); });
    const fixture = await spawnOwnedTreeProcess("owned-tree-forced");
    try {
      await waitForOutput(witness, () => witnessOutput.includes("WITNESS_READY"), 5_000);
      const firstStop = stopOwnedProcess(fixture.owned);
      const secondStop = stopOwnedProcess(fixture.owned);
      assert.equal(firstStop, secondStop, "le second arrêt doit réutiliser la même opération");
      const outcome = await firstStop;
      assert.equal(outcome.mode, "forced");
      assert.equal(outcome.forced, true);
      assert.match(outcome.fallbackReason ?? "", /SIGINT/);
      await assertPidGone(fixture.parentPid, "parent possédé");
      await assertPidGone(fixture.descendantPid, "descendant possédé");
      assert.equal(isPidAlive(witness.pid), true, "le témoin étranger ne doit pas recevoir le signal du groupe possédé");
      assert.equal(outcome.ownedTreeStopped, true);
    } finally {
      await cleanupOwnedTreeProcess(fixture);
      await stopWitness(witness);
    }
  });

  await check("un descendant est arrêté même si son parent possédé est déjà mort", async () => {
    const fixture = await spawnOwnedTreeProcess("owned-tree-parent-gone", { exitParentAfterReady: true });
    try {
      assert.equal(await waitForChildExit(fixture.owned.child, 5_000), 0);
      assert.equal(isPidAlive(fixture.descendantPid), true, "le descendant synthétique doit persister avant le nettoyage");
      const firstStop = stopOwnedProcess(fixture.owned);
      const secondStop = stopOwnedProcess(fixture.owned);
      assert.equal(firstStop, secondStop);
      await assert.rejects(firstStop, /s’est arrêté avant la demande d’arrêt/);
      await assert.rejects(secondStop, /s’est arrêté avant la demande d’arrêt/);
      assert.equal(fixture.owned.stopOutcome?.mode, "forced");
      assert.equal(fixture.owned.stopOutcome?.ownedTreeStopped, true);
      await assertPidGone(fixture.parentPid, "parent déjà terminé");
      await assertPidGone(fixture.descendantPid, "descendant orphelin possédé");
    } finally {
      await cleanupOwnedTreeProcess(fixture);
    }
  });

  await check("un ENOSPC auxiliaire ne bloque pas l'arrêt forcé de l'arbre possédé", async () => {
    const logFailure = deferred<void>();
    const diagnostics: string[] = [];
    const fixture = await spawnOwnedTreeProcess("owned-tree-log-failure", {
      createLogStream: () => {
        const stream = new Writable({
          write(_chunk, _encoding, callback) {
            callback();
            process.nextTick(() => {
              stream.emit("error", codedError("ENOSPC"));
              logFailure.resolve();
            });
          },
        });
        process.nextTick(() => stream.emit("open", 1));
        return stream;
      },
      diagnosticWrite: (value) => diagnostics.push(value),
    });
    try {
      await logFailure.promise;
      const outcome = await stopOwnedProcess(fixture.owned);
      assert.equal(outcome.mode, "forced");
      assert.equal(outcome.log.status, "incomplete");
      assert.equal(outcome.log.issues.some((issue) => issue.phase === "write" && issue.code === "ENOSPC"), true);
      assert.equal(diagnostics.length, 1, "le défaut du log doit produire un seul secours");
      await assertPidGone(fixture.parentPid, "parent du cas combiné");
      await assertPidGone(fixture.descendantPid, "descendant du cas combiné");
    } finally {
      await cleanupOwnedTreeProcess(fixture);
    }
  });
}

await check("échec de création du premier contexte", async () => {
  const fixture = fakeDependencies({ failAt: "client-monitor" });
  await assert.rejects(
    runWithViewportResources(fixture.dependencies, async () => undefined),
    /injected-client-monitor/,
  );
  assert.equal(fixture.harness.stopCalls, 1, "le harness doit être arrêté après l’échec du premier contexte");
});

await check("échec de création du second contexte", async () => {
  const fixture = fakeDependencies({ failAt: "admin-monitor" });
  await assert.rejects(
    runWithViewportResources(fixture.dependencies, async () => undefined),
    /injected-admin-monitor/,
  );
  assert.equal(fixture.clientMonitor.closeCalls, 1, "le premier contexte doit être fermé");
  assert.equal(fixture.harness.stopCalls, 1, "le harness doit être arrêté");
});

await check("échec de création de la première page", async () => {
  const fixture = fakeDependencies({ failAt: "client-page" });
  await assert.rejects(
    runWithViewportResources(fixture.dependencies, async () => undefined),
    /injected-client-page/,
  );
  assert.equal(fixture.clientMonitor.closeCalls, 1);
  assert.equal(fixture.adminMonitor.closeCalls, 1);
  assert.equal(fixture.harness.stopCalls, 1);
});

await check("échec de création de la seconde page", async () => {
  const fixture = fakeDependencies({ failAt: "admin-page" });
  await assert.rejects(
    runWithViewportResources(fixture.dependencies, async () => undefined),
    /injected-admin-page/,
  );
  assert.equal(fixture.clientPage.closeCalls, 1, "la première page doit être fermée");
  assert.equal(fixture.clientMonitor.closeCalls, 1);
  assert.equal(fixture.adminMonitor.closeCalls, 1);
  assert.equal(fixture.harness.stopCalls, 1);
});

await check("échec de configuration d’un contexte déjà créé", async () => {
  const resource = { closeCalls: 0 };
  await assert.rejects(
    configureOwnedResource({
      create: async () => resource,
      configure: async () => { throw new Error("injected-context-configuration"); },
      close: async (owned) => { owned.closeCalls += 1; },
    }),
    /injected-context-configuration/,
  );
  assert.equal(resource.closeCalls, 1, "le contexte créé doit être fermé si sa configuration échoue");
});

await check("erreur initiale préservée malgré les erreurs de preuve et de fermeture", async () => {
  const fixture = fakeDependencies({
    failAt: "cleanup",
    failEvidence: true,
    failClientClose: true,
    failHarnessStop: true,
  });
  await assert.rejects(
    runWithViewportResources(fixture.dependencies, async () => {
      throw new Error("injected-primary-failure");
    }),
    /injected-primary-failure/,
  );
  assert.equal(fixture.clientPage.closeCalls, 1);
  assert.equal(fixture.adminPage.closeCalls, 1);
  assert.equal(fixture.clientMonitor.closeCalls, 1);
  assert.equal(fixture.adminMonitor.closeCalls, 1);
  assert.equal(fixture.harness.stopCalls, 1);
  assert.equal(fixture.reports.length, 1, "un compte rendu de nettoyage doit être conservé");
});

await check("nettoyage borné sans abandonner l’arrêt du harness", async () => {
  const fixture = fakeDependencies({ failAt: "cleanup" });
  fixture.dependencies.cleanupTimeoutMs = 40;
  fixture.dependencies.closePage = async (page) => {
    page.closeCalls += 1;
    if (page.role === "client") await new Promise<void>(() => undefined);
  };
  const startedAt = Date.now();
  await assert.rejects(
    runWithViewportResources(fixture.dependencies, async () => {
      throw new Error("injected-bounded-primary");
    }),
    /injected-bounded-primary/,
  );
  assert.ok(Date.now() - startedAt < 1_000, "la fermeture bloquée doit être bornée");
  assert.equal(fixture.harness.stopCalls, 1, "l’arrêt du harness doit être tenté après le dépassement");
  assert.equal(
    fixture.reports[0]?.steps.some((step) => step.name === "close-client-page" && step.status === "failed"),
    true,
  );
});

await check("incident Listen qualifié une seule fois avec reprise fraîche du même contexte", async () => {
  const fixture = recoveredListenFixture();
  const result = assertNoUnexpectedRuntimeFailures(fixture.network, fixture.console, fixture.probe);
  assert.equal(result.firestoreTransportRecoveries.length, 1, "console et réponse décrivent un seul incident");
  assert.equal(result.firestoreTransportRecoveries[0]?.requestId, "mobile:client:request-7");
});

await check("400 métier ou signature Listen inconnue restent bloquants", async () => {
  const business = recoveredListenFixture();
  business.network[0] = {
    ...business.network[0]!,
    origin: "http://127.0.0.1:14173",
    pathname: "/api/create-order",
    requestShape: undefined,
    responseSignature: undefined,
  };
  assert.throws(
    () => assertNoUnexpectedRuntimeFailures(business.network, business.console, business.probe),
    /réponse HTTP locale inattendue/,
  );
  const unknown = recoveredListenFixture();
  unknown.network[0] = {
    ...unknown.network[0]!,
    responseSignature: { ...unknown.network[0]!.responseSignature!, byteLength: 7, sha256: "unknown" },
  };
  assert.throws(
    () => assertNoUnexpectedRuntimeFailures(unknown.network, unknown.console, unknown.probe),
    /signature Listen 400 inconnue/,
  );
});

await check("incident Listen sans reprise ou avec reprise d’un autre contexte reste bloquant", async () => {
  const missing = recoveredListenFixture();
  assert.throws(
    () => assertNoUnexpectedRuntimeFailures(missing.network, missing.console, []),
    /aucune donnée Firestore fraîche/,
  );
  const otherContext = recoveredListenFixture();
  otherContext.probe[0] = { ...otherContext.probe[0]!, contextId: "mobile:admin", pageId: "mobile:admin:page-1" };
  assert.throws(
    () => assertNoUnexpectedRuntimeFailures(otherContext.network, otherContext.console, otherContext.probe),
    /aucune donnée Firestore fraîche/,
  );
});

await check("une réponse 200 antérieure ne prouve pas la reprise Listen", async () => {
  const fixture = recoveredListenFixture();
  const priorOk: NetworkEvidence = {
    ...fixture.network[0]!,
    requestId: "mobile:client:request-6",
    sequence: 1,
    occurredAtEpochMs: 900,
    status: 200,
    responseSignature: undefined,
  };
  assert.throws(
    () => assertNoUnexpectedRuntimeFailures([priorOk, ...fixture.network], fixture.console, []),
    /aucune donnée Firestore fraîche/,
  );
});

await check("incidents Listen persistants ou au-delà de la borne restent bloquants", async () => {
  const fixture = recoveredListenFixture();
  const second = {
    ...fixture.network[0]!,
    requestId: "mobile:client:request-8",
    sequence: 5,
    occurredAtEpochMs: 1_400,
  };
  assert.throws(
    () => assertNoUnexpectedRuntimeFailures([...fixture.network, second], fixture.console, fixture.probe),
    /au plus 1 incident Listen local/,
  );
});

await check("pageerror et fuite réseau restent bloquants", async () => {
  const pageError = recoveredListenFixture();
  pageError.console.push({
    phase: "client-final-wallet",
    contextId: "mobile:client",
    pageId: "mobile:client:page-1",
    sequence: 9,
    occurredAtEpochMs: 1_500,
    source: "pageerror",
    type: "error",
    text: "injected-pageerror",
  });
  assert.throws(
    () => assertNoUnexpectedRuntimeFailures(pageError.network, pageError.console, pageError.probe),
    /console navigateur inattendue/,
  );
  const leak = recoveredListenFixture();
  leak.network.push({
    phase: "client-final-wallet",
    contextId: "mobile:client",
    pageId: "mobile:client:page-1",
    sequence: 10,
    occurredAtEpochMs: 1_600,
    requestId: "mobile:client:request-9",
    direction: "request",
    method: "GET",
    origin: "https://example.invalid",
    pathname: "/leak",
    resourceType: "fetch",
    blocked: true,
  });
  assert.throws(
    () => assertNoUnexpectedRuntimeFailures(leak.network, leak.console, leak.probe),
    /aucune tentative navigateur externe attendue/,
  );
});

if (process.argv.includes("--real-harness")) {
  await check("harness réel libéré après un échec avant parcours", async () => {
    let harness: RecipeHarness | undefined;
    try {
      await assert.rejects(
        runWithViewportResources({
          label: "reliability-real-harness",
          startHarness: async () => {
            harness = await startRecipeHarness("reliability-real-harness");
            return harness;
          },
          createMonitor: async () => {
            throw new Error("injected-real-first-context");
          },
          createPage: async () => ({ unused: true }),
          persistEvidence: async () => undefined,
          closePage: async () => undefined,
          closeMonitor: async () => undefined,
          stopHarness: (ownedHarness) => ownedHarness.stop(),
        }, async () => undefined),
        /injected-real-first-context/,
      );
      assert.deepEqual(
        await occupiedRecipePorts(),
        [],
        "aucun port de la recette ne doit rester occupé après l’échec injecté",
      );
    } finally {
      await harness?.stop().catch(() => undefined);
      await harness?.stop().catch(() => undefined);
    }
    assert.deepEqual(await occupiedRecipePorts(), [], "le second arrêt doit rester sans effet indésirable");
  });
}

if (failures.length > 0) {
  console.error(`Fiabilité interactive en échec : ${failures.length} cas.`);
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.error}`);
  process.exitCode = 1;
} else {
  const realHarnessSuffix = process.argv.includes("--real-harness")
    ? " et nettoyage du harness réel"
    : "";
  console.log(`Fiabilité interactive vérifiée : acquisitions partielles, erreurs primaires${realHarnessSuffix}.`);
}

}

async function check(name: string, test: () => Promise<void>) {
  try {
    await test();
    console.log(`[OK] ${name}`);
  } catch (error) {
    failures.push({ name, error: safeError(error) });
    console.error(`[ECHEC] ${name}: ${safeError(error)}`);
  }
}

function fakeDependencies(options: {
  failAt: "client-monitor" | "admin-monitor" | "client-page" | "admin-page" | "cleanup";
  failEvidence?: boolean;
  failClientClose?: boolean;
  failHarnessStop?: boolean;
}) {
  const harness: FakeHarness = { stopCalls: 0 };
  const clientMonitor: FakeMonitor = { role: "client", closeCalls: 0 };
  const adminMonitor: FakeMonitor = { role: "admin", closeCalls: 0 };
  const clientPage: FakePage = { role: "client", closeCalls: 0 };
  const adminPage: FakePage = { role: "admin", closeCalls: 0 };
  const reports: CleanupReport[] = [];
  const dependencies: ViewportResourceDependencies<FakeHarness, FakeMonitor, FakePage> = {
    label: `fake-${options.failAt}`,
    startHarness: async () => harness,
    createMonitor: async (role) => {
      if (options.failAt === `${role}-monitor`) throw new Error(`injected-${role}-monitor`);
      return role === "client" ? clientMonitor : adminMonitor;
    },
    createPage: async (_monitor, role) => {
      if (options.failAt === `${role}-page`) throw new Error(`injected-${role}-page`);
      return role === "client" ? clientPage : adminPage;
    },
    persistEvidence: async () => {
      if (options.failEvidence) throw new Error("injected-evidence-failure");
    },
    closePage: async (page) => { page.closeCalls += 1; },
    closeMonitor: async (monitor) => {
      monitor.closeCalls += 1;
      if (options.failClientClose && monitor.role === "client") {
        throw new Error("injected-client-close-failure");
      }
    },
    stopHarness: async (ownedHarness) => {
      ownedHarness.stopCalls += 1;
      if (options.failHarnessStop) throw new Error("injected-harness-stop-failure");
    },
    writeCleanupReport: async (report) => { reports.push(report); },
    cleanupTimeoutMs: 500,
  };
  return {
    dependencies,
    harness,
    clientMonitor,
    adminMonitor,
    clientPage,
    adminPage,
    reports,
  };
}

function recoveredListenFixture(): {
  network: NetworkEvidence[];
  console: ConsoleEvidence[];
  probe: FirestoreListenProbeEvidence[];
} {
  return {
    network: [{
      phase: "client1-auth",
      contextId: "mobile:client",
      pageId: "mobile:client:page-1",
      sequence: 2,
      occurredAtEpochMs: 1_000,
      requestId: "mobile:client:request-7",
      direction: "response",
      method: "GET",
      origin: "http://127.0.0.1:18086",
      pathname: "/google.firestore.v1.Firestore/Listen/channel",
      resourceType: "fetch",
      status: 400,
      requestShape: {
        queryParameterNames: ["AID", "CI", "RID", "SID", "TYPE", "VER", "database"],
        hasSessionId: true,
        requestIdKind: "rpc",
        transportType: "xmlhttp",
        protocolVersion: "8",
      },
      responseSignature: {
        byteLength: 0,
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        contentType: null,
        bodyPrefix: "",
        truncated: false,
      },
    }],
    console: [{
      phase: "client1-auth",
      contextId: "mobile:client",
      pageId: "mobile:client:page-1",
      sequence: 3,
      occurredAtEpochMs: 1_010,
      source: "console",
      type: "error",
      text: "Failed to load resource: the server responded with a status of 400 (Bad Request)",
    }],
    probe: [{
      phase: "firestore-listen-recovery",
      contextId: "mobile:client",
      pageId: "mobile:client:page-1",
      sequence: 4,
      occurredAtEpochMs: 1_300,
      probeId: "mobile-probe",
      generation: "recovery-mobile-12345678",
      fromCache: false,
      hasPendingWrites: false,
    }],
  };
}

async function occupiedRecipePorts() {
  const occupied: number[] = [];
  for (const port of Object.values(RECIPE_PORTS)) {
    if (!(await canBind(port))) occupied.push(port);
  }
  return occupied;
}

async function canBind(port: number) {
  return new Promise<boolean>((resolvePromise) => {
    const server = net.createServer();
    const timeout = setTimeout(() => {
      server.close();
      resolvePromise(false);
    }, 2_000);
    server.once("error", () => {
      clearTimeout(timeout);
      resolvePromise(false);
    });
    server.listen(port, RECIPE_HOST, () => {
      server.close(() => {
        clearTimeout(timeout);
        resolvePromise(true);
      });
    });
  });
}

type ReliabilityProcessFixture = {
  owned: OwnedProcess;
  runDirectory: string;
};

type OwnedTreeFixture = ReliabilityProcessFixture & {
  parentPid: number;
  descendantPid: number;
};

async function spawnReliabilityProcess(
  name: string,
  args: string[],
  kind: OwnedProcess["kind"],
  options: SpawnOwnedOptions = {},
): Promise<ReliabilityProcessFixture> {
  const runDirectory = await mkdtemp(resolve(tmpdir(), "verdanza-owned-process-"));
  try {
    const owned = spawnOwned(name, args, process.env, runDirectory, kind, {
      parentStdoutWrite: () => undefined,
      parentStderrWrite: () => undefined,
      childStdioCloseTimeoutMs: 500,
      logCloseTimeoutMs: 250,
      ...options,
    });
    return { owned, runDirectory };
  } catch (error) {
    await rm(runDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function cleanupReliabilityProcess(fixture: ReliabilityProcessFixture) {
  await stopOwnedProcess(fixture.owned).catch(() => undefined);
  await waitForOwnedProcessLog(fixture.owned).catch(() => undefined);
  await rm(fixture.runDirectory, { recursive: true, force: true });
}

async function spawnOwnedTreeProcess(
  name: string,
  options: SpawnOwnedOptions & { exitParentAfterReady?: boolean } = {},
): Promise<OwnedTreeFixture> {
  const { exitParentAfterReady = false, ...spawnOptions } = options;
  const fixture = await spawnReliabilityProcess(
    name,
    [
      "--import", "tsx",
      fileURLToPath(import.meta.url),
      "--owned-tree-parent",
      ...(exitParentAfterReady ? ["--exit-parent-after-ready"] : []),
    ],
    "service",
    {
      stopGracePeriodMs: 100,
      stopForcePeriodMs: 3_000,
      ...spawnOptions,
    },
  );
  let stdout = "";
  fixture.owned.child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
  try {
    await waitForOutput(
      fixture.owned.child,
      () => /OWNED_TREE_READY parent=\d+ descendant=\d+/.test(stdout),
      5_000,
    );
    const match = stdout.match(/OWNED_TREE_READY parent=(\d+) descendant=(\d+)/);
    assert.ok(match, "les PID parent et descendant doivent être annoncés explicitement");
    return {
      ...fixture,
      parentPid: Number(match[1]),
      descendantPid: Number(match[2]),
    };
  } catch (error) {
    await cleanupReliabilityProcess(fixture);
    throw error;
  }
}

async function cleanupOwnedTreeProcess(fixture: OwnedTreeFixture) {
  await stopOwnedProcess(fixture.owned).catch(() => undefined);
  for (const pid of [fixture.parentPid, fixture.descendantPid]) {
    try {
      if (isPidAlive(pid)) process.kill(pid, "SIGKILL");
    } catch {
      // Le processus a pu disparaître entre la sonde et le signal de secours du test.
    }
  }
  await waitForOwnedProcessLog(fixture.owned).catch(() => undefined);
  await rm(fixture.runDirectory, { recursive: true, force: true });
}

async function stopWitness(witness: ChildProcess) {
  if (!isPidAlive(witness.pid)) return;
  witness.kill("SIGKILL");
  await waitForChildExit(witness, 5_000).catch(() => undefined);
}

function passthroughLogStream() {
  return new Writable({ write(_chunk, _encoding, callback) { callback(); } });
}

function collectingLogStream(chunks: string[]) {
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  process.nextTick(() => stream.emit("open", 1));
  return stream;
}

function codedError(code: string) {
  return Object.assign(new Error(`injected-${code.toLowerCase()}`), { code });
}

async function waitForCondition(predicate: () => boolean, label: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error(`Condition non atteinte : ${label}.`);
}

function isPidAlive(pid: number | undefined) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code !== "ESRCH";
  }
}

async function assertPidGone(pid: number, label: string) {
  await waitForCondition(() => !isPidAlive(pid), `${label} encore actif`, 5_000);
  assert.equal(isPidAlive(pid), false, `${label} doit avoir disparu`);
}

function delay(timeoutMs: number) {
  return new Promise<void>((resolvePromise) => setTimeout(resolvePromise, timeoutMs));
}

type ControlledStartupBlock =
  | "never"
  | "emulator-readiness"
  | "seed"
  | "api-readiness-late-success";

function controlledStartupDriver(signal: AbortSignal, block: ControlledStartupBlock) {
  const events: string[] = [];
  const reached = deferred<void>();
  const release = deferred<void>();
  let emulatorWaits = 0;
  const driver: RecipeStartupDriver<string> = {
    signal,
    acquireService: (name) => {
      events.push(`acquire:${name}`);
      return name;
    },
    waitForService: async (_url, processName) => {
      events.push(`wait:${processName}`);
      if (processName === "firebase-emulators") emulatorWaits += 1;
      if (block === "emulator-readiness" && processName === "firebase-emulators" && emulatorWaits === 1) {
        reached.resolve();
        await waitUntilCancelled(signal);
      }
      if (block === "api-readiness-late-success" && processName === "local-api") {
        reached.resolve();
        await release.promise;
      }
    },
    runOneShot: async (name) => {
      events.push(`one-shot:${name}`);
      if (block === "seed" && name === "seed") {
        reached.resolve();
        await waitUntilCancelled(signal);
      }
    },
    markServiceReady: (name) => { events.push(`ready:${name}`); },
    complete: async () => { events.push("complete"); },
  };
  return { driver, events, reached, release };
}

async function assertRealStartupSignal(signal: "SIGINT" | "SIGTERM") {
  const child = spawn(process.execPath, [
    "--import", "tsx",
    fileURLToPath(import.meta.url),
    "--signal-child",
  ], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  try {
    await waitForOutput(child, () => stdout.includes("SIGNAL_CHILD_READY"), 5_000);
    assert.equal(child.kill(signal), true, `${signal} doit être envoyé au sous-processus contrôlé`);
    const code = await waitForChildExit(child, 5_000);
    assert.equal(code, 0, stderr || stdout);
    assert.match(stdout, /SIGNAL_CHILD_CLEANUP 1/);
    assert.match(stdout, /SIGNAL_CHILD_RESULT STARTUP_CANCELLED/);
    assert.match(stdout, /ANNULÉE pendant le démarrage/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

async function runSignalChild() {
  let cleanupCalls = 0;
  const result = await runRecipeCommand<{ stop: () => Promise<void> }>({
    signalSource: process,
    startHarness: async (signal) => {
      console.log("SIGNAL_CHILD_READY");
      try {
        await waitUntilCancelled(signal);
        throw new Error("Le signal contrôlé était attendu.");
      } finally {
        cleanupCalls += 1;
        console.log(`SIGNAL_CHILD_CLEANUP ${cleanupCalls}`);
      }
    },
    printAccess: () => assert.fail("le sous-processus ne doit pas devenir READY"),
    writeLine: (message) => console.log(message),
  });
  assert.equal(cleanupCalls, 1);
  console.log(`SIGNAL_CHILD_RESULT ${result}`);
}

async function runOwnedTreeParent() {
  process.on("SIGINT", () => undefined);
  process.on("SIGTERM", () => undefined);
  const descendantScript = [
    "process.on('SIGINT',()=>{});",
    "process.on('SIGTERM',()=>{});",
    "if (process.send) process.send('READY');",
    "setInterval(()=>{},1000);",
  ].join("");
  const descendant = spawn(process.execPath, ["-e", descendantScript], {
    shell: false,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  await new Promise<void>((resolvePromise, reject) => {
    descendant.once("error", reject);
    descendant.once("message", (message) => {
      if (message === "READY") resolvePromise();
    });
  });
  console.log(`OWNED_TREE_READY parent=${process.pid} descendant=${descendant.pid}`);
  if (process.argv.includes("--exit-parent-after-ready")) {
    descendant.disconnect();
    process.exit(0);
  }
  await new Promise<void>(() => undefined);
}

function waitUntilCancelled(signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new RecipeStartupCancelledError());
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new RecipeStartupCancelledError()), { once: true });
  });
}

function waitForOutput(
  child: ChildProcess,
  predicate: () => boolean,
  timeoutMs: number,
) {
  if (predicate()) return Promise.resolve();
  return new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(() => finish(new Error("Point de synchronisation du signal non atteint.")), timeoutMs);
    const onData = () => {
      if (predicate()) finish();
    };
    const onExit = (code: number | null) => finish(new Error(`Sous-processus arrêté avant synchronisation (${code}).`));
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolvePromise();
    };
    child.stdout?.on("data", onData);
    child.once("exit", onExit);
  });
}

function waitForChildExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise<number | null>((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Arrêt du sous-processus signal hors délai."));
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolvePromise(code);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function deferred<Value>() {
  let resolvePromise: (value: Value | PromiseLike<Value>) => void = () => undefined;
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function safeError(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
