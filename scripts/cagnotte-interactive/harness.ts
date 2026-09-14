import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import { resolve } from "node:path";
import {
  localUrl,
  RECIPE_ACCOUNTS,
  RECIPE_CACHE_ROOT,
  RECIPE_HOST,
  RECIPE_PORTS,
  RECIPE_PROJECT_ID,
  RECIPE_ROOT,
} from "./constants.js";
import { buildRecipeEnvironment } from "./environment.js";
import { assertInteractivePrerequisites } from "./prerequisites.js";
import {
  API_DIAGNOSTICS_PATH,
  API_SHUTDOWN_PATH,
  assertDiagnosticJournalComplete,
  diagnosticErrorCode,
  incompleteDiagnosticJournalSnapshot,
  isDiagnosticJournalSnapshot,
  type DiagnosticJournalSnapshot,
} from "./diagnosticJournal.js";

export type OwnedProcess = {
  name: string;
  kind: "service" | "one-shot";
  child: ChildProcess;
  logPath: string;
  stopRequested: boolean;
  stopPromise?: Promise<void>;
  spawnError?: Error;
  gracefulStop?: () => Promise<void>;
};
const AUTH_EMULATOR_READY_TIMEOUT_MS = 120_000;
const ONE_SHOT_TIMEOUT_MS = 60_000;

export type RecipeHarnessLifecycleEvent =
  | { type: "process-acquired"; name: string; kind: OwnedProcess["kind"]; pid: number | undefined }
  | { type: "service-ready"; name: string }
  | { type: "startup-ready" };

export type StartRecipeHarnessOptions = {
  signal?: AbortSignal;
  onLifecycleEvent?: (event: RecipeHarnessLifecycleEvent) => void;
};

export type RecipeStartupDriver<ProcessRef> = {
  signal?: AbortSignal;
  acquireService: (name: string, args: string[]) => ProcessRef;
  waitForService: (url: string, processRef: ProcessRef, timeoutMs: number) => Promise<void>;
  runOneShot: (name: string, args: string[]) => Promise<void>;
  markServiceReady: (name: string) => void;
  complete: () => Promise<void>;
};

export class RecipeStartupCancelledError extends Error {
  readonly code = "RECIPE_STARTUP_CANCELLED";

  constructor(message = "Démarrage de la recette annulé.") {
    super(message);
    this.name = "RecipeStartupCancelledError";
  }
}

export function isRecipeStartupCancelled(error: unknown): error is RecipeStartupCancelledError {
  return error instanceof RecipeStartupCancelledError ||
    (Boolean(error) && typeof error === "object" &&
      (error as { code?: unknown }).code === "RECIPE_STARTUP_CANCELLED");
}

export type RecipeHarness = {
  runDirectory: string;
  environment: NodeJS.ProcessEnv;
  processes: OwnedProcess[];
  stop: () => Promise<void>;
  stopService: (name: string) => Promise<void>;
  finalizeDiagnostics: () => Promise<DiagnosticJournalSnapshot>;
  diagnosticsSnapshot: () => DiagnosticJournalSnapshot | undefined;
  startupState: () => "STARTING" | "READY" | "CANCELLED" | "FAILED";
};

export async function coordinateRecipeStartup<ProcessRef>(
  driver: RecipeStartupDriver<ProcessRef>,
): Promise<void> {
  throwIfStartupCancelled(driver.signal);
  const emulators = driver.acquireService("firebase-emulators", [
    resolve(RECIPE_ROOT, "node_modules/firebase-tools/lib/bin/firebase.js"),
    "emulators:start",
    "--only", "auth,firestore",
    "--project", RECIPE_PROJECT_ID,
    "--config", resolve(RECIPE_ROOT, "firebase.cagnotte.interactive.json"),
  ]);
  throwIfStartupCancelled(driver.signal);
  await driver.waitForService(localUrl(RECIPE_PORTS.firestore), emulators, 60_000);
  throwIfStartupCancelled(driver.signal);
  await driver.waitForService(
    localUrl(RECIPE_PORTS.auth, `/emulator/v1/projects/${RECIPE_PROJECT_ID}/accounts`),
    emulators,
    AUTH_EMULATOR_READY_TIMEOUT_MS,
  );
  throwIfStartupCancelled(driver.signal);
  driver.markServiceReady("firebase-emulators");
  throwIfStartupCancelled(driver.signal);

  await driver.runOneShot("seed", [
    "--import", "tsx",
    resolve(RECIPE_ROOT, "scripts/cagnotte-interactive/seed.ts"),
  ]);
  throwIfStartupCancelled(driver.signal);
  await driver.runOneShot("warm-firestore-listen", [
    "--import", "tsx",
    resolve(RECIPE_ROOT, "scripts/cagnotte-interactive/warmFirestoreListen.ts"),
  ]);
  throwIfStartupCancelled(driver.signal);

  const api = driver.acquireService("local-api", [
    "--import", "tsx",
    resolve(RECIPE_ROOT, "scripts/cagnotte-interactive/server.ts"),
  ]);
  throwIfStartupCancelled(driver.signal);
  await driver.waitForService(localUrl(RECIPE_PORTS.api, "/__recette/health"), api, 30_000);
  throwIfStartupCancelled(driver.signal);
  driver.markServiceReady("local-api");
  throwIfStartupCancelled(driver.signal);

  const app = driver.acquireService("vite-app", [
    resolve(RECIPE_ROOT, "node_modules/vite/bin/vite.js"),
    "--config", resolve(RECIPE_ROOT, "vite.cagnotte-interactive.config.ts"),
    "--host", RECIPE_HOST,
    "--port", String(RECIPE_PORTS.app),
    "--strictPort",
  ]);
  throwIfStartupCancelled(driver.signal);
  await driver.waitForService(localUrl(RECIPE_PORTS.app, "/connexion"), app, 30_000);
  throwIfStartupCancelled(driver.signal);
  driver.markServiceReady("vite-app");
  throwIfStartupCancelled(driver.signal);
  await driver.complete();
  throwIfStartupCancelled(driver.signal);
}

export async function startRecipeHarness(
  label: string,
  options: StartRecipeHarnessOptions = {},
): Promise<RecipeHarness> {
  const startedAt = new Date().toISOString();
  throwIfStartupCancelled(options.signal);
  assertInteractivePrerequisites();
  const runDirectory = resolve(
    RECIPE_CACHE_ROOT,
    "runs",
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${label}`,
  );
  await mkdir(runDirectory, { recursive: true });
  throwIfStartupCancelled(options.signal);
  await assertPortsAvailable(options.signal);
  throwIfStartupCancelled(options.signal);
  const environment = buildRecipeEnvironment(runDirectory);
  const processes: OwnedProcess[] = [];
  let finalizedDiagnostics: DiagnosticJournalSnapshot | undefined;
  let finalizationPromise: Promise<DiagnosticJournalSnapshot> | undefined;
  let stopPromise: Promise<void> | undefined;
  const serviceStopPromises = new Map<string, Promise<void>>();
  let apiReady = false;
  let state: "STARTING" | "READY" | "CANCELLED" | "FAILED" = "STARTING";
  const finalizeDiagnostics = () => {
    if (finalizedDiagnostics) return Promise.resolve(finalizedDiagnostics);
    if (!apiReady) {
      return Promise.reject(new Error("Le contrôle diagnostic est indisponible avant la disponibilité de l’API locale."));
    }
    if (!finalizationPromise) {
      finalizationPromise = captureApiDiagnostics(processes, runDirectory).then((snapshot) => {
        finalizedDiagnostics = snapshot;
        return snapshot;
      });
    }
    return finalizationPromise;
  };
  const harness: RecipeHarness = {
    runDirectory,
    environment,
    processes,
    stop: () => {
      if (!stopPromise) {
        stopPromise = stopAllWithDiagnostics(processes, finalizeDiagnostics, () => apiReady);
      }
      return stopPromise;
    },
    stopService: (name) => {
      const existing = serviceStopPromises.get(name);
      if (existing) return existing;
      const stopping = (async () => {
        const target = processes.find((entry) => entry.name === name);
        if (!target) return;
        const failures: unknown[] = [];
        if (name === "local-api" && apiReady) {
          try {
            assertDiagnosticJournalComplete(await finalizeDiagnostics());
          } catch (error) {
            failures.push(error);
          }
        }
        try {
          await stopOwnedProcess(target);
        } catch (error) {
          failures.push(error);
        }
        throwCollectedFailures(failures, `Arrêt incomplet du service ${name}.`);
      })();
      serviceStopPromises.set(name, stopping);
      return stopping;
    },
    finalizeDiagnostics,
    diagnosticsSnapshot: () => finalizedDiagnostics,
    startupState: () => state,
  };
  try {
    await coordinateRecipeStartup({
      signal: options.signal,
      acquireService: (name, args) => registerOwnedProcess(
        processes,
        spawnOwned(name, args, environment, runDirectory, "service"),
        options.onLifecycleEvent,
      ),
      waitForService: (url, processRef, timeoutMs) => (
        waitForHttp(url, processRef, timeoutMs, options.signal)
      ),
      runOneShot: (name, args) => runOneShot(
        name,
        args,
        environment,
        runDirectory,
        processes,
        options.signal,
        options.onLifecycleEvent,
      ),
      markServiceReady: (name) => {
        if (name === "local-api") {
          apiReady = true;
          const api = processes.find((entry) => entry.name === "local-api");
          if (api) api.gracefulStop = requestApiShutdown;
        }
        options.onLifecycleEvent?.({ type: "service-ready", name });
      },
      complete: async () => {
        await writeFile(resolve(runDirectory, "processes.json"), `${JSON.stringify({
          projectId: RECIPE_PROJECT_ID,
          origin: localUrl(RECIPE_PORTS.app),
          ports: RECIPE_PORTS,
          processes: processes.map(({ name, kind, child, logPath }) => ({
            name,
            kind,
            pid: child.pid,
            exitCode: child.exitCode,
            logPath,
          })),
        }, null, 2)}\n`, "utf8");
      },
    });
    state = "READY";
    options.onLifecycleEvent?.({ type: "startup-ready" });
    return harness;
  } catch (error) {
    state = isRecipeStartupCancelled(error) ? "CANCELLED" : "FAILED";
    const cleanupStartedAt = Date.now();
    let cleanupError: unknown;
    try {
      await harness.stop();
    } catch (caughtCleanupError) {
      cleanupError = caughtCleanupError;
      console.error(`[harness-cleanup] ${safeError(caughtCleanupError)}`);
      if (error instanceof Error) {
        Object.defineProperty(error, "cleanupError", {
          configurable: true,
          enumerable: false,
          value: safeError(caughtCleanupError),
        });
      }
    }
    try {
      await writeFile(resolve(runDirectory, "cleanup.json"), `${JSON.stringify({
         label,
         startupState: state,
         startedAt,
        completedAt: new Date().toISOString(),
        primaryError: safeError(error),
        steps: [{
          name: "stop-partially-started-harness",
          status: cleanupError === undefined ? "completed" : "failed",
          durationMs: Date.now() - cleanupStartedAt,
          ...(cleanupError === undefined ? {} : { error: safeError(cleanupError) }),
        }],
        ownedProcesses: processes.map(({ name, child }) => ({
          name,
          pid: child.pid,
          exitCode: child.exitCode,
        })),
      }, null, 2)}\n`, "utf8");
      await writePartialStartDiagnostics(runDirectory, processes);
    } catch (evidenceError) {
      console.error(`[harness-cleanup-evidence] ${safeError(evidenceError)}`);
    }
    if (error instanceof Error) {
      try {
        Object.defineProperty(error, "runDirectory", {
          configurable: true,
          enumerable: false,
          value: runDirectory,
        });
      } catch {
        // L'identité de l'erreur de démarrage reste prioritaire.
      }
    }
    throw error;
  }
}

export function printRecipeAccess(harness: RecipeHarness) {
  console.log("\nRECETTE LOCALE — DONNÉES FICTIVES");
  console.log(`URL : ${localUrl(RECIPE_PORTS.app, "/connexion")}`);
  for (const [role, account] of Object.entries(RECIPE_ACCOUNTS)) {
    console.log(`${role}: ${account.email} / ${account.password}`);
  }
  console.log(`Processus : ${harness.processes.map((entry) => `${entry.name}=${entry.child.pid}`).join(", ")}`);
  console.log(`Preuves : ${harness.runDirectory}`);
  console.log("Arrêt : Ctrl+C dans ce terminal\n");
}

export async function runRecipeScript(
  harness: RecipeHarness,
  name: string,
  script: string,
  args: string[] = [],
) {
  await runOneShot(name, [
    "--import", "tsx",
    resolve(RECIPE_ROOT, script),
    ...args,
  ], harness.environment, harness.runDirectory, harness.processes);
}

async function assertPortsAvailable(signal?: AbortSignal) {
  const occupied: number[] = [];
  for (const port of Object.values(RECIPE_PORTS)) {
    throwIfStartupCancelled(signal);
    const available = await canBind(port, signal);
    throwIfStartupCancelled(signal);
    if (!available) occupied.push(port);
  }
  if (occupied.length) {
    throw new Error(`Démarrage refusé : port(s) déjà occupé(s), aucun processus arrêté : ${occupied.join(", ")}.`);
  }
}

async function canBind(port: number, signal?: AbortSignal) {
  return new Promise<boolean>((resolvePromise) => {
    const server = net.createServer();
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolvePromise(value);
    };
    const onAbort = () => {
      try {
        server.close();
      } catch {
        // La vérification de port ne possède aucun autre processus à nettoyer.
      }
      finish(false);
    };
    const timer = setTimeout(() => {
      server.close();
      finish(false);
    }, 2_000);
    signal?.addEventListener("abort", onAbort, { once: true });
    server.once("error", () => finish(false));
    server.listen(port, RECIPE_HOST, () => server.close(() => finish(true)));
  });
}

function spawnOwned(
  name: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  runDirectory: string,
  kind: OwnedProcess["kind"],
) {
  const logPath = resolve(runDirectory, `${name}.log`);
  const log = createWriteStream(logPath, { flags: "a" });
  const child = spawn(process.execPath, args, {
    cwd: RECIPE_ROOT,
    env: environment,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const owned: OwnedProcess = { name, kind, child, logPath, stopRequested: false };
  child.stdout?.on("data", (chunk) => { process.stdout.write(`[${name}] ${chunk}`); log.write(chunk); });
  child.stderr?.on("data", (chunk) => { process.stderr.write(`[${name}] ${chunk}`); log.write(chunk); });
  child.once("error", (error) => {
    owned.spawnError = error;
    log.write(`[spawn-error] ${safeError(error)}\n`);
    log.end();
  });
  child.once("exit", () => log.end());
  return owned;
}

function registerOwnedProcess(
  processes: OwnedProcess[],
  owned: OwnedProcess,
  onLifecycleEvent?: (event: RecipeHarnessLifecycleEvent) => void,
) {
  processes.push(owned);
  onLifecycleEvent?.({
    type: "process-acquired",
    name: owned.name,
    kind: owned.kind,
    pid: owned.child.pid,
  });
  return owned;
}

async function runOneShot(
  name: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  runDirectory: string,
  processes: OwnedProcess[],
  signal?: AbortSignal,
  onLifecycleEvent?: (event: RecipeHarnessLifecycleEvent) => void,
) {
  throwIfStartupCancelled(signal);
  const owned = registerOwnedProcess(
    processes,
    spawnOwned(name, args, environment, runDirectory, "one-shot"),
    onLifecycleEvent,
  );
  throwIfStartupCancelled(signal);
  try {
    const code = await waitForOneShotBounded(owned.child, name, signal);
    throwIfStartupCancelled(signal);
    if (code !== 0) throw new Error(`${name} a échoué avec le code ${code}. Voir ${owned.logPath}`);
  } catch (error) {
    try {
      await stopOwnedProcess(owned);
    } catch (cleanupError) {
      console.error(`[one-shot-cleanup:${name}] ${safeError(cleanupError)}`);
      if (error instanceof Error) {
        try {
          Object.defineProperty(error, "cleanupError", {
            configurable: true,
            enumerable: false,
            value: safeError(cleanupError),
          });
        } catch {
          // L’erreur initiale du sous-processus reste prioritaire.
        }
      }
    }
    throw error;
  }
}

async function waitForHttp(
  url: string,
  processRef: OwnedProcess,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    throwIfStartupCancelled(signal);
    if (processRef.spawnError) throw processRef.spawnError;
    if (hasSettled(processRef.child)) {
      throw new Error(
        `${processRef.name} s’est arrêté avant disponibilité ` +
        `(code ${processRef.child.exitCode}, signal ${processRef.child.signalCode ?? "aucun"}).`,
      );
    }
    try {
      const response = await fetchWithTimeout(url, 1_000, signal);
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      if (isRecipeStartupCancelled(error)) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }
    await abortableDelay(200, signal);
  }
  throw new Error(`${processRef.name} indisponible après ${timeoutMs} ms (${lastError}).`);
}

async function fetchWithTimeout(url: string, timeoutMs: number, signal?: AbortSignal) {
  throwIfStartupCancelled(signal);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (signal?.aborted) throw new RecipeStartupCancelledError();
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function abortableDelay(timeoutMs: number, signal?: AbortSignal) {
  throwIfStartupCancelled(signal);
  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolvePromise();
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new RecipeStartupCancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function stopAll(processes: OwnedProcess[]) {
  const failures: Error[] = [];
  for (const processRef of [...processes].reverse()) {
    try {
      await stopOwnedProcess(processRef);
    } catch (error) {
      failures.push(new Error(`${processRef.name}: ${safeError(error)}`));
    }
  }
  const stillOpen: number[] = [];
  for (const port of Object.values(RECIPE_PORTS)) {
    if (!(await canBind(port))) stillOpen.push(port);
  }
  if (stillOpen.length) failures.push(new Error(`Processus local encore à l’écoute sur : ${stillOpen.join(", ")}.`));
  if (failures.length) throw new AggregateError(failures, "Arrêt incomplet du harness de recette.");
}

async function stopAllWithDiagnostics(
  processes: OwnedProcess[],
  finalizeDiagnostics: () => Promise<DiagnosticJournalSnapshot>,
  canFinalizeDiagnostics: () => boolean,
) {
  const failures: unknown[] = [];
  if (canFinalizeDiagnostics()) {
    try {
      assertDiagnosticJournalComplete(await finalizeDiagnostics());
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await stopAll(processes);
  } catch (error) {
    failures.push(error);
  }
  throwCollectedFailures(failures, "Arrêt incomplet du harness de recette.");
}

export function stopOwnedProcess(processRef: OwnedProcess) {
  if (processRef.stopPromise) return processRef.stopPromise;
  processRef.stopPromise = (async () => {
    if (!processRef.child.pid) return;
    if (hasSettled(processRef.child)) {
      if (processRef.kind === "service" && !processRef.stopRequested) {
        throw new Error(
          `${processRef.name} s’est arrêté avant la demande d’arrêt ` +
          `(code ${processRef.child.exitCode}, signal ${processRef.child.signalCode ?? "aucun"}).`,
        );
      }
      return;
    }
    processRef.stopRequested = true;
    let gracefulFailure: unknown;
    if (processRef.gracefulStop) {
      try {
        await processRef.gracefulStop();
        if (await settledWithin(processRef.child, 5_000)) {
          if (processRef.child.exitCode !== 0 || processRef.child.signalCode !== null) {
            throw new Error(
              `${processRef.name} a signalé un arrêt en échec ` +
              `(code ${processRef.child.exitCode}, signal ${processRef.child.signalCode ?? "aucun"}).`,
            );
          }
          return;
        }
        gracefulFailure = new Error(`arrêt gracieux hors délai pour le PID ${processRef.child.pid}.`);
      } catch (error) {
        gracefulFailure = error;
      }
    }
    if (hasSettled(processRef.child)) {
      if (gracefulFailure !== undefined) throw gracefulFailure;
      return;
    }
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(processRef.child.pid), "/T", "/F"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
      if (!(await settledWithin(killer, 5_000))) {
        killer.kill();
        throw new Error(`taskkill n’a pas terminé dans le délai pour le PID ${processRef.child.pid}.`);
      }
    } else {
      processRef.child.kill("SIGINT");
      if (!(await settledWithin(processRef.child, 2_500))) processRef.child.kill("SIGKILL");
    }
    if (!(await settledWithin(processRef.child, 5_000))) {
      throw new Error(`le PID ${processRef.child.pid} ne s’est pas arrêté dans le délai.`);
    }
    if (gracefulFailure !== undefined) throw gracefulFailure;
  })();
  return processRef.stopPromise;
}

function waitForExit(child: ChildProcess) {
  if (hasSettled(child)) return Promise.resolve(child.exitCode);
  return new Promise<number | null>((resolvePromise) => child.once("exit", (code) => resolvePromise(code)));
}

async function settledWithin(child: ChildProcess, timeoutMs: number) {
  if (hasSettled(child)) return true;
  return Promise.race([
    waitForExit(child).then(() => true),
    new Promise<false>((resolvePromise) => setTimeout(() => resolvePromise(false), timeoutMs)),
  ]);
}

function waitForOneShot(child: ChildProcess) {
  if (hasSettled(child)) return Promise.resolve(child.exitCode);
  return new Promise<number | null>((resolvePromise, reject) => {
    const onExit = (code: number | null) => {
      child.off("error", onError);
      resolvePromise(code);
    };
    const onError = (error: Error) => {
      child.off("exit", onExit);
      reject(error);
    };
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function waitForOneShotBounded(
  child: ChildProcess,
  name: string,
  signal?: AbortSignal,
) {
  throwIfStartupCancelled(signal);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      waitForOneShot(child),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${name} n’a pas terminé dans le délai de ${ONE_SHOT_TIMEOUT_MS} ms.`)),
          ONE_SHOT_TIMEOUT_MS,
        );
      }),
      new Promise<never>((_resolve, reject) => {
        if (!signal) return;
        onAbort = () => reject(new RecipeStartupCancelledError());
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

function hasSettled(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

function throwIfStartupCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new RecipeStartupCancelledError();
}

function safeError(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function captureApiDiagnostics(processes: OwnedProcess[], runDirectory: string) {
  const api = processes.find((entry) => entry.name === "local-api");
  let snapshot: DiagnosticJournalSnapshot;
  if (!api || hasSettled(api.child)) {
    snapshot = incompleteDiagnosticJournalSnapshot("API_DIAGNOSTICS_UNAVAILABLE");
  } else {
    try {
      const response = await fetch(localUrl(RECIPE_PORTS.api, API_DIAGNOSTICS_PATH), {
        signal: AbortSignal.timeout(5_000),
      });
      const payload: unknown = await response.json();
      snapshot = isDiagnosticJournalSnapshot(payload)
        ? payload
        : incompleteDiagnosticJournalSnapshot("API_DIAGNOSTICS_INVALID");
      if ((response.status === 200) !== snapshot.complete) {
        snapshot = incompleteDiagnosticJournalSnapshot("API_DIAGNOSTICS_STATUS");
      }
    } catch (error) {
      console.error(`[api-diagnostics] contrôle local indisponible code=${diagnosticErrorCode(error)}`);
      snapshot = incompleteDiagnosticJournalSnapshot("API_DIAGNOSTICS_UNAVAILABLE");
    }
  }

  try {
    await writeFile(
      resolve(runDirectory, "api-diagnostics.json"),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    console.error(`[api-diagnostics] preuve de contrôle indisponible code=${diagnosticErrorCode(error)}`);
    return incompleteDiagnosticJournalSnapshot("API_DIAGNOSTICS_EVIDENCE");
  }
  return snapshot;
}

async function requestApiShutdown() {
  const response = await fetch(localUrl(RECIPE_PORTS.api, API_SHUTDOWN_PATH), {
    method: "POST",
    signal: AbortSignal.timeout(6_000),
  });
  const payload: unknown = await response.json();
  if (!isDiagnosticJournalSnapshot(payload)) {
    throw new Error("Réponse d’arrêt de l’API locale invalide.");
  }
  if ((response.status === 200) !== payload.complete) {
    throw new Error("Statut d’arrêt de l’API locale incohérent.");
  }
}

function throwCollectedFailures(failures: unknown[], message: string) {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}

async function writePartialStartDiagnostics(runDirectory: string, processes: OwnedProcess[]) {
  const emulatorLog = processes.find((entry) => entry.name === "firebase-emulators")?.logPath;
  let entries: string[] = [];
  if (emulatorLog) {
    const ansiSequence = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
    entries = (await readFile(emulatorLog, "utf8"))
      .replace(ansiSequence, "")
      .split(/\r?\n/)
      .filter((line) => /emulator|firestore|auth|shutdown|sigint|error|warn|exception/i.test(line))
      .map((line) => line
        .replace(/(https?:\/\/[^\s?]+)\?[^\s'"]+/g, "$1?[redacted]")
        .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
        .slice(0, 500))
      .slice(-100);
  }
  await writeFile(
    resolve(runDirectory, "emulator-diagnostics.json"),
    `${JSON.stringify({ source: "firebase-emulators.log", entries }, null, 2)}\n`,
    "utf8",
  );
}
