import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  RECIPE_HOST,
  RECIPE_CACHE_ROOT,
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
import {
  installRecipeSignalCancellation,
  isRecipeSignalCancellation,
  runRecipeCommand,
} from "./run.js";
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
import {
  publishCurrentPassEvidence,
  runViewportSequence,
} from "./test.js";

type FakeHarness = { stopCalls: number };
type FakeMonitor = { role: "client" | "admin"; closeCalls: number };
type FakePage = { role: "client" | "admin"; closeCalls: number };

const failures: Array<{ name: string; error: string }> = [];

if (process.argv.includes("--signal-child")) {
  await runSignalChild();
} else if (process.argv.includes("--owned-tree-parent")) {
  await runOwnedTreeParent();
} else if (process.argv.includes("--windows-job-only")) {
  await runWindowsOwnedProcessChecks();
  reportReliabilityResult(" Job Object Windows");
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
    if (process.platform === "win32") {
      await waitForCondition(() => fixture.owned.windowsJobReady === true, "Job Object prêt avant exit synthétique");
    }
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

await check("la preuve du runner attend exit puis close et conserve la sortie tardive", async () => {
  const child = syntheticChildProcess();
  const output = trackChildOutput(child);
  child.emit("exit", 130, null);
  assert.equal(output.complete, false, "exit seul ne doit pas clore la preuve de sortie");
  assert.equal(output.stderr, "");
  (child.stderr as PassThrough).write("ANNULÉE par SIGINT\n");
  (child.stdout as PassThrough).end();
  (child.stderr as PassThrough).end();
  child.emit("close", 130, null);
  const completed = await output.waitForCompletion(1_000);
  assert.equal(completed.exitCode, 130);
  assert.match(completed.stderr, /ANNULÉE par SIGINT/);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(child.stdout?.listenerCount("data"), 0);
  assert.equal(child.stderr?.listenerCount("data"), 0);
});

await check("la preuve du runner attend close avant de restituer une erreur de flux", async () => {
  const child = syntheticChildProcess();
  const output = trackChildOutput(child);
  child.stderr?.emit("error", codedError("EPIPE"));
  child.emit("exit", 1, null);
  assert.equal(output.complete, false, "une erreur de flux ne doit pas court-circuiter la fermeture");
  (child.stdout as PassThrough).end();
  (child.stderr as PassThrough).end();
  child.emit("close", 1, null);
  await assert.rejects(output.waitForCompletion(1_000), /stderr.*EPIPE/i);
  assert.equal(child.stderr?.listenerCount("error"), 0);
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
    if (process.platform === "win32") {
      assert.equal(await waitForChildExit(fixture.owned.child, 10_000), 86);
      await waitForCondition(() => fixture.owned.childClosed === true, "fermeture du superviseur Windows");
      await waitForOwnedProcessLog(fixture.owned);
      assert.equal(fixture.owned.windowsJobSetupFailed, true);
      assert.equal(fixture.owned.windowsJobReady, false);
      await assert.rejects(stopOwnedProcess(fixture.owned), /fermeture du Job Object Windows non prouvée/);
    } else {
      await waitForCondition(() => fixture.owned.spawnError !== undefined, "erreur spawn ENOENT");
      await waitForOwnedProcessLog(fixture.owned);
      assert.equal((fixture.owned.spawnError as NodeJS.ErrnoException | undefined)?.code, "ENOENT");
      assert.match(chunks.join(""), /\[spawn-error\] code=ENOENT/);
      const outcome = await stopOwnedProcess(fixture.owned);
      assert.equal(outcome.log.finalized, true);
    }
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

await check("une ressource acquise pendant l’annulation reste recensée puis fermée", async () => {
  const signals = new EventEmitter();
  const cancellation = installRecipeSignalCancellation(signals);
  const fixture = fakeDependencies({ failAt: "cleanup" });
  const acquisitionStarted = deferred<void>();
  const releaseAcquisition = deferred<void>();
  let adminAcquisitions = 0;
  fixture.dependencies.cancellation = cancellation;
  fixture.dependencies.createMonitor = async (role) => {
    if (role === "client") {
      acquisitionStarted.resolve();
      await releaseAcquisition.promise;
      return fixture.clientMonitor;
    }
    adminAcquisitions += 1;
    return fixture.adminMonitor;
  };
  try {
    const execution = runWithViewportResources(fixture.dependencies, async () => {
      assert.fail("le parcours ne doit pas commencer après l’annulation");
    });
    await acquisitionStarted.promise;
    signals.emit("SIGINT");
    releaseAcquisition.resolve();
    await assert.rejects(execution, isRecipeSignalCancellation);
    assert.equal(adminAcquisitions, 0, "aucune acquisition suivante ne doit commencer");
    assert.equal(fixture.clientMonitor.closeCalls, 1, "le contexte acquis tardivement doit être fermé");
    assert.equal(fixture.harness.stopCalls, 1, "le harness déjà acquis doit être arrêté");
  } finally {
    cancellation.dispose();
  }
});

await check("l’annulation d’un parcours rejoint un nettoyage unique malgré un second signal", async () => {
  const signals = new EventEmitter();
  const cancellation = installRecipeSignalCancellation(signals);
  const fixture = fakeDependencies({ failAt: "cleanup" });
  const operationStarted = deferred<void>();
  const cleanupStarted = deferred<void>();
  const releaseCleanup = deferred<void>();
  fixture.dependencies.cancellation = cancellation;
  fixture.dependencies.persistEvidence = async () => {
    cleanupStarted.resolve();
    await releaseCleanup.promise;
  };
  try {
    const execution = runWithViewportResources(fixture.dependencies, async () => {
      operationStarted.resolve();
      await waitUntilCancelled(cancellation.signal);
    });
    await operationStarted.promise;
    signals.emit("SIGTERM");
    await cleanupStarted.promise;
    signals.emit("SIGINT");
    assert.equal(signals.listenerCount("SIGINT"), 1, "les handlers restent actifs pendant le nettoyage");
    assert.equal(signals.listenerCount("SIGTERM"), 1, "les handlers restent actifs pendant le nettoyage");
    releaseCleanup.resolve();
    await assert.rejects(execution, (error) => (
      isRecipeSignalCancellation(error) && error.signal === "SIGTERM"
    ));
    assert.equal(fixture.clientPage.closeCalls, 1);
    assert.equal(fixture.adminPage.closeCalls, 1);
    assert.equal(fixture.clientMonitor.closeCalls, 1);
    assert.equal(fixture.adminMonitor.closeCalls, 1);
    assert.equal(fixture.harness.stopCalls, 1);
  } finally {
    cancellation.dispose();
  }
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});

await check("une erreur de parcours observée avant le signal reste prioritaire", async () => {
  const signals = new EventEmitter();
  const cancellation = installRecipeSignalCancellation(signals);
  const fixture = fakeDependencies({ failAt: "cleanup" });
  fixture.dependencies.cancellation = cancellation;
  fixture.dependencies.onPrimaryError = () => { signals.emit("SIGTERM"); };
  try {
    await assert.rejects(
      runWithViewportResources(fixture.dependencies, async () => {
        throw new Error("injected-primary-before-signal");
      }),
      /injected-primary-before-signal/,
    );
    assert.equal(cancellation.requestedSignal(), "SIGTERM");
    assert.equal(fixture.harness.stopCalls, 1);
  } finally {
    cancellation.dispose();
  }
});

await check("une interruption entre desktop et mobile interdit le viewport suivant", async () => {
  const signals = new EventEmitter();
  const cancellation = installRecipeSignalCancellation(signals);
  const started: string[] = [];
  const completed: string[] = [];
  try {
    await assert.rejects(
      runViewportSequence({
        items: ["desktop", "mobile"],
        cancellation,
        run: async (viewport) => {
          started.push(viewport);
          if (viewport === "desktop") signals.emit("SIGTERM");
          return viewport;
        },
        onCompleted: (viewport) => completed.push(viewport),
      }),
      isRecipeSignalCancellation,
    );
    assert.deepEqual(started, ["desktop"]);
    assert.deepEqual(completed, ["desktop"], "le résultat terminé reste une preuve partielle");
  } finally {
    cancellation.dispose();
  }
});

await check("une interruption avant le bilan final retire tout PASS courant", async () => {
  const signals = new EventEmitter();
  const cancellation = installRecipeSignalCancellation(signals);
  const directory = await mkdtemp(resolve(tmpdir(), "verdanza-runner-pass-"));
  const passPath = resolve(directory, "latest-result.json");
  try {
    await assert.rejects(
      publishCurrentPassEvidence({
        path: passPath,
        contents: '{"status":"PASS"}\n',
        cancellation,
        afterWrite: () => { signals.emit("SIGINT"); },
      }),
      isRecipeSignalCancellation,
    );
    await assert.rejects(access(passPath), /ENOENT/, "aucun PASS écrit avant l’interruption ne doit rester courant");
  } finally {
    cancellation.dispose();
    await rm(directory, { recursive: true, force: true });
  }
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

if (process.platform !== "win32") {
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
}

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
    console.log("[INFO] Signaux réels du runner test.ts NON EXÉCUTÉS localement sous Windows ; ils restent obligatoires dans verify sous Linux.");
    console.log("[INFO] Tests d'arbre de processus Unix NON EXÉCUTÉS localement sous Windows ; ils restent obligatoires dans verify sous Linux.");
  });
  await runWindowsOwnedProcessChecks();
} else {
  await check("le vrai runner reçoit SIGINT après acquisition et nettoie sans faux PASS", async () => {
    await assertRealAutomatedRunnerSignal({
      signal: "SIGINT",
      probe: "after-resources",
      sendSecondSignalDuringCleanup: false,
    });
  });
  await check("le vrai runner reçoit SIGTERM pendant une attente et rejoint le même nettoyage", async () => {
    await assertRealAutomatedRunnerSignal({
      signal: "SIGTERM",
      probe: "during-active-wait",
      sendSecondSignalDuringCleanup: true,
    });
  });
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

const realHarnessSuffix = process.argv.includes("--real-harness")
  ? " et nettoyage du harness réel"
  : "";
reportReliabilityResult(` acquisitions partielles, erreurs primaires${realHarnessSuffix}`);

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

function reportReliabilityResult(scope: string) {
  if (failures.length > 0) {
    console.error(`Fiabilité interactive en échec : ${failures.length} cas.`);
    for (const failure of failures) console.error(`- ${failure.name}: ${failure.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Fiabilité interactive vérifiée :${scope}.`);
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

async function runWindowsOwnedProcessChecks() {
  await check("Windows exige un environnement Job Object réel", async () => {
    assert.equal(process.platform, "win32", "ce lot ciblé doit s’exécuter sur un runner Windows");
  });
  if (process.platform !== "win32") return;

  await check("Windows arrête le parent actif et son descendant sans toucher au témoin", async () => {
    const witness = spawn(process.execPath, [
      "-e",
      "process.stdout.write('WINDOWS_WITNESS_READY');setInterval(()=>{},1000)",
    ], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let witnessOutput = "";
    witness.stdout?.on("data", (chunk) => { witnessOutput += String(chunk); });
    const fixture = await spawnOwnedTreeProcess("windows-owned-tree-active");
    try {
      await waitForOutput(witness, () => witnessOutput.includes("WINDOWS_WITNESS_READY"), 5_000);
      assert.equal(fixture.owned.windowsJobReady, true, "l’appartenance doit être prouvée avant le démarrage cible");
      assert.equal(fixture.owned.windowsPrimaryProcessId, fixture.parentPid);
      const firstStop = stopOwnedProcess(fixture.owned);
      const secondStop = stopOwnedProcess(fixture.owned);
      assert.equal(firstStop, secondStop, "un second arrêt doit rejoindre la même opération");
      const outcome = await firstStop;
      assert.equal(outcome.mode, "forced");
      assert.equal(outcome.forced, true);
      assert.match(outcome.fallbackReason ?? "", /Job Object Windows/);
      assert.equal(fixture.owned.windowsJobTreeStopped, true);
      assert.equal(outcome.ownedTreeStopped, true);
      await assertPidGone(fixture.parentPid, "parent Windows possédé");
      await assertPidGone(fixture.descendantPid, "descendant Windows possédé");
      assert.equal(isPidAlive(witness.pid), true, "le témoin extérieur doit rester actif");
    } finally {
      await cleanupOwnedTreeProcess(fixture);
      await stopWitness(witness);
    }
  });

  await check("Windows ferme les descendants quand le parent cible sort le premier", async () => {
    const witness = spawn(process.execPath, [
      "-e",
      "process.stdout.write('WINDOWS_PARENT_GONE_WITNESS_READY');setInterval(()=>{},1000)",
    ], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let witnessOutput = "";
    witness.stdout?.on("data", (chunk) => { witnessOutput += String(chunk); });
    const fixture = await spawnOwnedTreeProcess("windows-owned-tree-parent-gone", {
      exitParentAfterReady: true,
    });
    try {
      await waitForOutput(witness, () => witnessOutput.includes("WINDOWS_PARENT_GONE_WITNESS_READY"), 5_000);
      assert.equal(await waitForChildExit(fixture.owned.child, 10_000), 0);
      await waitForCondition(() => fixture.owned.childClosed === true, "fermeture du superviseur Windows");
      assert.equal(fixture.owned.windowsJobReady, true);
      assert.equal(fixture.owned.windowsJobTreeStopped, true);
      await assertPidGone(fixture.parentPid, "parent Windows déjà terminé");
      await assertPidGone(fixture.descendantPid, "descendant Windows après sortie du parent");
      assert.equal(isPidAlive(witness.pid), true, "le témoin extérieur doit survivre à la fermeture du Job Object");
      const firstStop = stopOwnedProcess(fixture.owned);
      const secondStop = stopOwnedProcess(fixture.owned);
      assert.equal(firstStop, secondStop);
      await assert.rejects(firstStop, /s’est arrêté avant la demande d’arrêt/);
      assert.equal(fixture.owned.stopOutcome?.mode, "already-stopped");
      assert.equal(fixture.owned.stopOutcome?.ownedTreeStopped, true);
    } finally {
      await cleanupOwnedTreeProcess(fixture);
      await stopWitness(witness);
    }
  });

  await check("Windows refuse de lancer la cible si la preuve Job Object échoue", async () => {
    const runDirectory = await mkdtemp(resolve(tmpdir(), "verdanza-windows-job-failure-"));
    const markerPath = resolve(runDirectory, "target-started.txt");
    const owned = spawnOwned(
      "windows-job-setup-failure",
      ["-e", "require('node:fs').writeFileSync(process.argv[1], 'started')", markerPath],
      process.env,
      runDirectory,
      "one-shot",
      {
        parentStdoutWrite: () => undefined,
        parentStderrWrite: () => undefined,
        simulateWindowsJobSetupFailure: true,
        stopForcePeriodMs: 100,
      },
    );
    try {
      assert.equal(await waitForChildExit(owned.child, 10_000), 86);
      await waitForCondition(() => owned.childClosed === true, "fermeture après échec Job Object");
      await waitForOwnedProcessLog(owned);
      assert.equal(owned.windowsJobSetupFailed, true);
      assert.equal(owned.windowsJobReady, false);
      await assert.rejects(access(markerPath), /ENOENT/, "la cible ne doit jamais démarrer");
      await assert.rejects(stopOwnedProcess(owned), /fermeture du Job Object Windows non prouvée/);
      assert.equal(owned.stopOutcome?.ownedTreeStopped, false);
    } finally {
      await stopOwnedProcess(owned).catch(() => undefined);
      await waitForOwnedProcessLog(owned).catch(() => undefined);
      await rm(runDirectory, { recursive: true, force: true });
    }
  });

  await check("Windows reproduit le parent terminé et refuse l’arrêt non prouvé du descendant", async () => {
    const child = spawn(process.execPath, [
      "--import", "tsx",
      fileURLToPath(import.meta.url),
      "--owned-tree-parent",
      "--exit-parent-after-ready",
      "--detach-descendant",
    ], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    let descendantPid: number | undefined;
    try {
      await waitForOutput(child, () => /OWNED_TREE_READY parent=\d+ descendant=\d+/.test(stdout), 5_000);
      const match = stdout.match(/OWNED_TREE_READY parent=(\d+) descendant=(\d+)/);
      assert.ok(match);
      descendantPid = Number(match[2]);
      assert.equal(await waitForChildExit(child, 5_000), 0);
      assert.equal(isPidAlive(descendantPid), true, "le défaut initial exige un descendant encore actif après exit du parent");
      const owned: OwnedProcess = {
        name: "windows-parent-gone-without-ownership",
        kind: "service",
        child,
        logPath: "synthetic-unowned-windows.log",
        stopRequested: false,
      };
      await assert.rejects(stopOwnedProcess(owned), /s’est arrêté avant la demande d’arrêt/);
      assert.equal(owned.stopOutcome?.childStopped, true);
      assert.equal(owned.stopOutcome?.ownedTreeStopped, false);
      assert.equal(isPidAlive(descendantPid), true, "le refus de preuve ne doit pas être présenté comme un arrêt");
    } finally {
      if (isPidAlive(descendantPid)) {
        process.kill(descendantPid as number, "SIGKILL");
        console.error(`[test-fallback:unowned-windows] descendant=${descendantPid}`);
      }
      if (isPidAlive(child.pid)) child.kill("SIGKILL");
      await waitForChildExit(child, 5_000).catch(() => undefined);
    }
  });
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
      process.platform === "win32" ? 15_000 : 5_000,
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
  const fallbackPids: number[] = [];
  for (const pid of [fixture.parentPid, fixture.descendantPid]) {
    try {
      if (isPidAlive(pid)) {
        process.kill(pid, "SIGKILL");
        fallbackPids.push(pid);
      }
    } catch {
      // Le processus a pu disparaître entre la sonde et le signal de secours du test.
    }
  }
  if (fallbackPids.length > 0) {
    console.error(`[test-fallback:owned-tree] pids=${fallbackPids.join(",")}`);
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
  const output = trackChildOutput(child);
  try {
    await waitForOutput(child, () => output.stdout.includes("SIGNAL_CHILD_READY"), 5_000);
    assert.equal(child.kill(signal), true, `${signal} doit être envoyé au sous-processus contrôlé`);
    const completed = await output.waitForCompletion(5_000);
    assert.equal(completed.exitCode, 0, completed.stderr || completed.stdout);
    assert.match(completed.stdout, /SIGNAL_CHILD_CLEANUP 1/);
    assert.match(completed.stdout, /SIGNAL_CHILD_RESULT STARTUP_CANCELLED/);
    assert.match(completed.stdout, /ANNULÉE pendant le démarrage/);
  } finally {
    output.dispose();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

async function assertRealAutomatedRunnerSignal(options: {
  signal: "SIGINT" | "SIGTERM";
  probe: "after-resources" | "during-active-wait";
  sendSecondSignalDuringCleanup: boolean;
}) {
  assert.notEqual(process.platform, "win32", "ce contrôle de signal réel est réservé à la CI Unix");
  const witness = spawn(process.execPath, [
    "-e",
    "process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});process.stdout.write('RUNNER_WITNESS_READY');setInterval(()=>{},1000)",
  ], {
    detached: true,
    shell: false,
    stdio: ["ignore", "pipe", "ignore"],
  });
  let witnessOutput = "";
  witness.stdout?.on("data", (chunk) => { witnessOutput += String(chunk); });
  const runner = spawn(process.execPath, [
    "--import", "tsx",
    resolve(process.cwd(), "scripts/cagnotte-interactive/test.ts"),
    `--runner-signal-probe=${options.probe}`,
  ], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = trackChildOutput(runner);
  let descendants: number[] = [];
  try {
    await waitForOutput(witness, () => witnessOutput.includes("RUNNER_WITNESS_READY"), 5_000);
    await waitForOutput(
      runner,
      () => output.stdout.includes(`RUNNER_SIGNAL_PROBE READY ${options.probe} desktop`),
      120_000,
    );
    descendants = await linuxDescendantPids(runner.pid as number);
    assert.ok(descendants.length > 0, "le runner réel doit posséder Chromium et les services de recette");
    assert.equal(runner.kill(options.signal), true, `${options.signal} doit viser directement le runner Node test.ts`);
    if (options.sendSecondSignalDuringCleanup) {
      await waitForOutput(
        runner,
        () => output.stdout.includes("RUNNER_SIGNAL_PROBE CLEANUP_START desktop"),
        30_000,
      );
      const secondSignal = options.signal === "SIGINT" ? "SIGTERM" : "SIGINT";
      assert.equal(runner.kill(secondSignal), true, "le second signal doit rejoindre le nettoyage en cours");
    }
    const expectedExitCode = options.signal === "SIGINT" ? 130 : 143;
    const verificationFailures: Error[] = [];
    let completed: Awaited<ReturnType<typeof output.waitForCompletion>> | undefined;
    try {
      completed = await output.waitForCompletion(120_000);
    } catch (error) {
      verificationFailures.push(new Error(`fermeture et capture des sorties : ${safeError(error)}`));
    }
    const stdout = completed?.stdout ?? output.stdout;
    const stderr = completed?.stderr ?? output.stderr;
    const exitCode = completed?.exitCode ?? runner.exitCode;
    const record = async (label: string, assertion: () => void | Promise<void>) => {
      try {
        await assertion();
      } catch (error) {
        verificationFailures.push(new Error(`${label} : ${safeError(error)}`));
      }
    };

    await record("code de sortie du signal", () => {
      assert.equal(exitCode, expectedExitCode, stderr || stdout);
    });
    await record("aucun viewport mobile après annulation", () => {
      assert.doesNotMatch(stdout, /RUNNER_VIEWPORT_START mobile/);
    });
    await record("aucun faux succès du runner", () => {
      assert.doesNotMatch(stdout, /Recette interactive locale réussie/);
    });
    await record("message d’annulation complet", () => {
      assert.match(stderr, new RegExp(`ANNULÉE par ${options.signal}`));
    });
    await record("absence de latest-result PASS", async () => {
      const latestResultPath = resolve(RECIPE_CACHE_ROOT, "latest-result.json");
      await assert.rejects(access(latestResultPath), /ENOENT/, "aucun latest-result PASS ne doit survivre");
    });

    let cancellation: {
      status?: string;
      signal?: string;
      exitCode?: number;
      activeRunDirectory?: string;
      completedExecutions?: unknown[];
      cleanupIssues?: unknown[];
    } | undefined;
    await record("preuve structurée d’annulation", async () => {
      cancellation = JSON.parse(
        await readFile(resolve(RECIPE_CACHE_ROOT, "latest-failure.json"), "utf8"),
      ) as typeof cancellation;
      assert.equal(cancellation?.status, "CANCELLED");
      assert.equal(cancellation?.signal, options.signal);
      assert.equal(cancellation?.exitCode, expectedExitCode);
      assert.deepEqual(cancellation?.completedExecutions, []);
      assert.deepEqual(cancellation?.cleanupIssues, []);
      assert.ok(cancellation?.activeRunDirectory, "le dossier du viewport interrompu doit rester traçable");
    });
    await record("résumé d’exécution interrompu", async () => {
      assert.ok(cancellation?.activeRunDirectory, "dossier actif absent");
      const executionSummary = JSON.parse(
        await readFile(resolve(cancellation.activeRunDirectory, "execution-summary.json"), "utf8"),
      ) as { status?: string; interruption?: { status?: string; signal?: string } };
      assert.equal(executionSummary.status, "INTERRUPTED");
      assert.deepEqual(executionSummary.interruption, { status: "CANCELLED", signal: options.signal });
    });
    await record("nettoyage propre du harness", async () => {
      assert.ok(cancellation?.activeRunDirectory, "dossier actif absent");
      const cleanup = JSON.parse(
        await readFile(resolve(cancellation.activeRunDirectory, "cleanup.json"), "utf8"),
      ) as {
        steps?: Array<{ name?: string; status?: string }>;
        ownedProcesses?: Array<{
          pid?: number;
          stop?: { childStopped?: boolean; ownedTreeStopped?: boolean };
        }>;
      };
      assert.equal(
        cleanup.steps?.find((step) => step.name === "stop-harness")?.status,
        "completed",
        "le propriétaire du harness doit terminer son nettoyage",
      );
      assert.ok((cleanup.ownedProcesses?.length ?? 0) >= 5);
      assert.equal(
        cleanup.ownedProcesses?.every((entry) => (
          entry.stop?.childStopped === true && entry.stop?.ownedTreeStopped === true
        )),
        true,
        "chaque processus possédé doit être arrêté avec son arbre",
      );
    });
    await record("ports de recette libérés", async () => {
      assert.deepEqual(await occupiedRecipePorts(), [], "les sept ports doivent être libres après le signal");
    });
    await record("descendants du runner arrêtés", async () => {
      for (const pid of descendants) await assertPidGone(pid, `descendant ${pid} du runner`);
    });
    await record("témoin extérieur préservé", () => {
      assert.equal(isPidAlive(witness.pid), true, "le témoin extérieur ne doit recevoir aucun signal");
    });
    if (verificationFailures.length > 0) {
      throw new AggregateError(verificationFailures, verificationFailures.map((error) => error.message).join(" | "));
    }
  } finally {
    output.dispose();
    const fallback = await cleanupRunnerProcess(runner, descendants);
    if (fallback.length > 0) {
      console.error(`[test-fallback:runner] ${fallback.join(",")}`);
    }
    await stopWitness(witness);
  }
}

async function linuxDescendantPids(rootPid: number) {
  const parentByPid = new Map<number, number>();
  for (const entry of await readdir("/proc", { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const match = stat.match(/^\d+ \(.*\) \S (\d+) /);
      if (match) parentByPid.set(pid, Number(match[1]));
    } catch {
      // Un processus peut disparaître pendant l'inventaire.
    }
  }
  const descendants: number[] = [];
  const pending = [rootPid];
  while (pending.length > 0) {
    const parent = pending.shift() as number;
    for (const [pid, ppid] of parentByPid) {
      if (ppid !== parent || descendants.includes(pid)) continue;
      descendants.push(pid);
      pending.push(pid);
    }
  }
  return descendants;
}

async function cleanupRunnerProcess(runner: ChildProcess, knownDescendants: number[]) {
  const currentDescendants = runner.pid && isPidAlive(runner.pid)
    ? await linuxDescendantPids(runner.pid)
    : [];
  const fallback: string[] = [];
  for (const pid of [...new Set([...currentDescendants, ...knownDescendants])].reverse()) {
    try {
      if (isPidAlive(pid)) {
        process.kill(pid, "SIGKILL");
        fallback.push(`descendant=${pid}`);
      }
    } catch {
      // Le processus peut disparaître entre le contrôle et le signal de secours.
    }
  }
  if (runner.pid && isPidAlive(runner.pid)) {
    runner.kill("SIGKILL");
    fallback.push(`runner=${runner.pid}`);
  }
  return fallback;
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
  const detachDescendant = process.argv.includes("--detach-descendant");
  const descendant = spawn(process.execPath, ["-e", descendantScript], {
    detached: detachDescendant,
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
    if (detachDescendant) descendant.unref();
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

function syntheticChildProcess() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: null,
    exitCode: null,
    signalCode: null,
    killed: false,
    kill: () => true,
  }) as unknown as ChildProcess;
}

function trackChildOutput(child: ChildProcess) {
  let stdout = "";
  let stderr = "";
  let exitCode = child.exitCode;
  let signalCode = child.signalCode;
  let terminationObserved = exitCode !== null || signalCode !== null;
  let closeObserved = false;
  let complete = false;
  let disposed = false;
  const errors: Array<{ source: string; error: unknown }> = [];
  const completion = deferred<void>();

  const onStdoutData = (chunk: unknown) => { stdout += String(chunk); };
  const onStderrData = (chunk: unknown) => { stderr += String(chunk); };
  const onStdoutError = (error: unknown) => { errors.push({ source: "stdout", error }); };
  const onStderrError = (error: unknown) => { errors.push({ source: "stderr", error }); };
  const onProcessError = (error: unknown) => {
    errors.push({ source: "process", error });
    terminationObserved = true;
    maybeComplete();
  };
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    exitCode = code;
    signalCode = signal;
    terminationObserved = true;
    maybeComplete();
  };
  const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
    exitCode ??= code;
    signalCode ??= signal;
    closeObserved = true;
    maybeComplete();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    child.stdout?.off("data", onStdoutData);
    child.stderr?.off("data", onStderrData);
    child.stdout?.off("error", onStdoutError);
    child.stderr?.off("error", onStderrError);
    child.off("error", onProcessError);
    child.off("exit", onExit);
    child.off("close", onClose);
  };
  function maybeComplete() {
    if (complete || !terminationObserved || !closeObserved) return;
    complete = true;
    dispose();
    completion.resolve();
  }

  child.stdout?.on("data", onStdoutData);
  child.stderr?.on("data", onStderrData);
  child.stdout?.on("error", onStdoutError);
  child.stderr?.on("error", onStderrError);
  child.on("error", onProcessError);
  child.on("exit", onExit);
  child.on("close", onClose);

  return {
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    get complete() { return complete; },
    async waitForCompletion(timeoutMs: number) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          completion.promise,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              dispose();
              reject(new Error(`Fermeture complète du sous-processus non observée après ${timeoutMs} ms.`));
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (errors.length > 0) {
        const details = errors.map((entry) => `${entry.source}: ${safeError(entry.error)}`).join(" | ");
        throw new AggregateError(
          errors.map((entry) => entry.error),
          `Capture de sortie du sous-processus en échec après fermeture (${details}).`,
        );
      }
      return { exitCode, signalCode, stdout, stderr };
    },
    dispose,
  };
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
