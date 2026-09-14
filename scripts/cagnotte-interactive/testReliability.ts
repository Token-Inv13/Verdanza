import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { fileURLToPath } from "node:url";
import {
  RECIPE_HOST,
  RECIPE_PORTS,
} from "./constants.js";
import {
  coordinateRecipeStartup,
  isRecipeStartupCancelled,
  RecipeStartupCancelledError,
  startRecipeHarness,
  stopOwnedProcess,
  type OwnedProcess,
  type RecipeHarness,
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
} else {

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
  });
} else {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    await check(`signal ${signal} réel reçu pendant le démarrage`, async () => {
      await assertRealStartupSignal(signal);
    });
  }
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

function waitUntilCancelled(signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new RecipeStartupCancelledError());
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new RecipeStartupCancelledError()), { once: true });
  });
}

function waitForOutput(
  child: ReturnType<typeof spawn>,
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

function waitForChildExit(child: ReturnType<typeof spawn>, timeoutMs: number) {
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
