import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import { resolve } from "node:path";
import type { Writable } from "node:stream";
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
  stopPromise?: Promise<OwnedProcessStopOutcome>;
  stopOutcome?: OwnedProcessStopOutcome;
  spawnError?: Error;
  gracefulStop?: () => Promise<void>;
  unixProcessGroupId?: number;
  ownsUnixProcessGroup?: boolean;
  ownsWindowsJobObject?: boolean;
  windowsPrimaryProcessId?: number;
  windowsJobReady?: boolean;
  windowsJobTreeStopped?: boolean;
  windowsJobSetupFailed?: boolean;
  logReport?: OwnedProcessLogReport;
  logFinalization?: Promise<void>;
  finalizeLog?: () => Promise<void>;
  childClosed?: boolean;
  stopGracePeriodMs?: number;
  stopForcePeriodMs?: number;
  recentStdout?: string;
  recentStderr?: string;
};

export type OwnedProcessLogIssue = {
  phase: "open" | "write" | "close" | "parent-output";
  code: string;
  auxiliary: true;
};

export type OwnedProcessLogReport = {
  auxiliary: true;
  status: "active" | "complete" | "incomplete";
  finalized: boolean;
  issues: OwnedProcessLogIssue[];
};

export type OwnedProcessStopOutcome = {
  mode: "already-stopped" | "graceful" | "forced";
  forced: boolean;
  fallbackReason?: string;
  childStopped: boolean;
  ownedTreeStopped: boolean;
  log: OwnedProcessLogReport;
};
const AUTH_EMULATOR_READY_TIMEOUT_MS = 120_000;
const ONE_SHOT_TIMEOUT_MS = 60_000;
const CHILD_STDIO_CLOSE_TIMEOUT_MS = 2_000;
const LOG_CLOSE_TIMEOUT_MS = 2_000;
const PROCESS_GRACEFUL_ACTION_TIMEOUT_MS = 6_500;
const PROCESS_GRACE_PERIOD_MS = 2_500;
const PROCESS_FORCE_PERIOD_MS = 5_000;
const MAX_LOG_ISSUES = 8;
const MAX_RECENT_PROCESS_OUTPUT = 16_384;
const WINDOWS_JOB_RUNNER = resolve(RECIPE_ROOT, "scripts/cagnotte-interactive/windowsJobRunner.ps1");

type ParentOutputReporter = (error: unknown) => void;

type SharedParentOutputState = {
  destination: Writable;
  failed: boolean;
  failure?: unknown;
  reporters: Set<ParentOutputReporter>;
  handleError: (error: unknown) => void;
};

const sharedParentOutputs = new WeakMap<Writable, SharedParentOutputState>();

function acquireSharedParentOutput(
  destination: Writable,
  reportFailure: ParentOutputReporter,
) {
  let state = sharedParentOutputs.get(destination);
  if (!state) {
    const reporters = new Set<ParentOutputReporter>();
    state = {
      destination,
      failed: false,
      reporters,
      handleError: () => undefined,
    };
    state.handleError = (error: unknown) => {
      if (!state || state.failed) return;
      state.failed = true;
      state.failure = error;
      for (const reporter of [...state.reporters]) {
        try {
          reporter(error);
        } catch {
          // Un reporter auxiliaire ne doit jamais interrompre le drainage des pipes enfant.
        }
      }
    };
    destination.on("error", state.handleError);
    sharedParentOutputs.set(destination, state);
  }

  state.reporters.add(reportFailure);
  if (state.failed) reportFailure(state.failure);

  let pendingWrites = 0;
  let releaseRequested = false;
  let released = false;
  let releaseImmediate: ReturnType<typeof setImmediate> | undefined;
  const releaseNow = () => {
    releaseImmediate = undefined;
    if (released || !releaseRequested || pendingWrites > 0) return;
    released = true;
    state?.reporters.delete(reportFailure);
    if (state && state.reporters.size === 0) {
      destination.off("error", state.handleError);
      sharedParentOutputs.delete(destination);
    }
  };
  const scheduleRelease = () => {
    if (released || !releaseRequested || pendingWrites > 0 || releaseImmediate) return;
    releaseImmediate = setImmediate(releaseNow);
  };

  return {
    write(value: string) {
      if (released || state?.failed) return;
      pendingWrites += 1;
      let completed = false;
      const complete = (error?: Error | null) => {
        if (completed) return;
        completed = true;
        if (error) state?.handleError(error);
        pendingWrites -= 1;
        scheduleRelease();
      };
      try {
        destination.write(value, complete);
      } catch (error) {
        complete(error instanceof Error ? error : new Error(String(error)));
      }
    },
    release() {
      if (releaseRequested) return;
      releaseRequested = true;
      scheduleRelease();
    },
  };
}

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
          processes: processes.map(ownedProcessReliabilitySnapshot),
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
        ownedProcesses: processes.map(ownedProcessReliabilitySnapshot),
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
  signal?: AbortSignal,
) {
  await runOneShot(name, [
    "--import", "tsx",
    resolve(RECIPE_ROOT, script),
    ...args,
  ], harness.environment, harness.runDirectory, harness.processes, signal);
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

export type SpawnOwnedOptions = {
  createLogStream?: (logPath: string) => Writable;
  command?: string;
  parentStdoutStream?: Writable;
  parentStderrStream?: Writable;
  parentStdoutWrite?: (value: string) => void;
  parentStderrWrite?: (value: string) => void;
  diagnosticWrite?: (value: string) => void;
  childStdioCloseTimeoutMs?: number;
  logCloseTimeoutMs?: number;
  stopGracePeriodMs?: number;
  stopForcePeriodMs?: number;
  simulateWindowsJobSetupFailure?: boolean;
};

export function spawnOwned(
  name: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  runDirectory: string,
  kind: OwnedProcess["kind"],
  options: SpawnOwnedOptions = {},
): OwnedProcess {
  const logPath = resolve(runDirectory, `${name}.log`);
  const logReport: OwnedProcessLogReport = {
    auxiliary: true,
    status: "active",
    finalized: false,
    issues: [],
  };
  const reportedIssues = new Set<string>();
  let log: Writable | undefined;
  let logOpened = false;
  let logFailed = false;
  let logFinalizationStarted = false;
  let logFinalizationPromise: Promise<void> | undefined;
  let resolveLogCompletion: () => void = () => undefined;
  const logCompletion = new Promise<void>((resolvePromise) => {
    resolveLogCompletion = () => resolvePromise();
  });
  const diagnosticWrite = options.diagnosticWrite ?? ((value: string) => {
    try {
      console.error(value);
    } catch {
      // Le secours de dernier niveau ne doit jamais concurrencer le nettoyage.
    }
  });
  const recordLogIssue = (
    phase: OwnedProcessLogIssue["phase"],
    error: unknown,
    emitDiagnostic = true,
  ) => {
    const code = safeDiagnosticCode(error);
    const key = `${phase}:${code}`;
    logReport.status = "incomplete";
    if (!reportedIssues.has(key) && logReport.issues.length < MAX_LOG_ISSUES) {
      reportedIssues.add(key);
      logReport.issues.push({ phase, code, auxiliary: true });
      if (emitDiagnostic) {
        try {
          diagnosticWrite(`[owned-process:${safeProcessName(name)}] diagnostic auxiliaire incomplet phase=${phase} code=${code}`);
        } catch {
          // Le chemin de secours est distinct du fichier défaillant et reste non récursif.
        }
      }
    }
  };
  const handleLogError = (error: unknown) => {
    const phase: OwnedProcessLogIssue["phase"] = logFinalizationStarted
      ? "close"
      : logOpened ? "write" : "open";
    logFailed = true;
    recordLogIssue(phase, error);
    try {
      if (log && !log.destroyed) log.destroy();
    } catch (destroyError) {
      recordLogIssue("close", destroyError);
    }
  };
  try {
    log = options.createLogStream?.(logPath) ?? createWriteStream(logPath, { flags: "a" });
    log.once("open", () => { logOpened = true; });
    log.once("ready", () => { logOpened = true; });
    log.on("error", handleLogError);
  } catch (error) {
    logFailed = true;
    recordLogIssue("open", error);
  }
  const writeLog = (value: string | Buffer) => {
    if (!log || logFailed || logFinalizationStarted) return;
    try {
      log.write(value);
    } catch (error) {
      handleLogError(error);
    }
  };
  const safeParentWrite = (
    writer: ((value: string) => void) | undefined,
    value: string,
  ) => {
    try {
      writer?.(value);
      return true;
    } catch (error) {
      recordLogIssue("parent-output", error);
      return false;
    }
  };
  const parentStdoutStream = options.parentStdoutStream
    ?? (options.parentStdoutWrite ? undefined : process.stdout);
  const parentStderrStream = options.parentStderrStream
    ?? (options.parentStderrWrite ? undefined : process.stderr);
  const stdoutLease = parentStdoutStream
    ? acquireSharedParentOutput(parentStdoutStream, (error) => {
        recordLogIssue(
          "parent-output",
          error,
          options.diagnosticWrite !== undefined || parentStdoutStream !== process.stderr,
        );
      })
    : undefined;
  const stderrLease = parentStderrStream
    ? acquireSharedParentOutput(parentStderrStream, (error) => {
        recordLogIssue(
          "parent-output",
          error,
          options.diagnosticWrite !== undefined || parentStderrStream !== process.stderr,
        );
      })
    : undefined;
  let parentOutputsReleased = false;
  let parentStdoutWriterFailed = false;
  let parentStderrWriterFailed = false;
  const releaseParentOutputs = () => {
    if (parentOutputsReleased) return;
    parentOutputsReleased = true;
    stdoutLease?.release();
    stderrLease?.release();
  };
  const finalizeLog = () => {
    if (logFinalizationPromise) return logFinalizationPromise;
    logFinalizationStarted = true;
    logFinalizationPromise = (async () => {
      if (!log || log.destroyed) return;
      await new Promise<void>((resolvePromise) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          log?.off("close", onClose);
          resolvePromise();
        };
        const onClose = () => finish();
        const timer = setTimeout(() => {
          recordLogIssue("close", { code: "LOG_CLOSE_TIMEOUT" });
          try {
            if (log && !log.destroyed) log.destroy();
          } catch (error) {
            recordLogIssue("close", error);
          }
          finish();
        }, options.logCloseTimeoutMs ?? LOG_CLOSE_TIMEOUT_MS);
        log.once("close", onClose);
        try {
          log.end();
          if (log.destroyed) queueMicrotask(finish);
        } catch (error) {
          handleLogError(error);
          finish();
        }
      });
    })().finally(() => {
      logReport.finalized = true;
      if (logReport.issues.length === 0) logReport.status = "complete";
      resolveLogCompletion();
    });
    return logFinalizationPromise;
  };
  const detached = process.platform !== "win32";
  const targetCommand = options.command ?? process.execPath;
  const windowsJobObject = process.platform === "win32";
  const launchCommand = windowsJobObject
    ? windowsPowerShellExecutable(environment)
    : targetCommand;
  const launchArgs = windowsJobObject
    ? [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-File", WINDOWS_JOB_RUNNER,
        "-Payload", Buffer.from(JSON.stringify({
          command: targetCommand,
          arguments: args,
          currentDirectory: RECIPE_ROOT,
          simulateSetupFailure: options.simulateWindowsJobSetupFailure === true,
        }), "utf8").toString("base64"),
      ]
    : args;
  let child: ChildProcess;
  try {
    child = spawn(launchCommand, launchArgs, {
      cwd: RECIPE_ROOT,
      env: environment,
      shell: false,
      detached,
      windowsHide: true,
      stdio: [windowsJobObject ? "pipe" : "ignore", "pipe", "pipe"],
    });
  } catch (error) {
    releaseParentOutputs();
    void finalizeLog();
    throw error;
  }
  const owned: OwnedProcess = {
    name,
    kind,
    child,
    logPath,
    stopRequested: false,
    ...(detached && child.pid
      ? { unixProcessGroupId: child.pid, ownsUnixProcessGroup: true }
      : {}),
    ...(windowsJobObject ? {
      ownsWindowsJobObject: true,
      windowsJobReady: false,
      windowsJobTreeStopped: false,
      windowsJobSetupFailed: false,
    } : {}),
    logReport,
    logFinalization: logCompletion,
    finalizeLog,
    childClosed: false,
    stopGracePeriodMs: options.stopGracePeriodMs,
    stopForcePeriodMs: options.stopForcePeriodMs,
    recentStdout: "",
    recentStderr: "",
  };
  let stdioCloseTimer: ReturnType<typeof setTimeout> | undefined;
  let windowsProtocolOutput = "";
  const observeWindowsJobProtocol = (chunk: unknown) => {
    if (!owned.ownsWindowsJobObject) return;
    windowsProtocolOutput = `${windowsProtocolOutput}${String(chunk)}`.slice(-4_096);
    const primaryMatch = windowsProtocolOutput.match(/VERDANZA_WINDOWS_JOB_READY primary=(\d+)/);
    if (primaryMatch) {
      owned.windowsJobReady = true;
      owned.windowsPrimaryProcessId = Number(primaryMatch[1]);
    }
    if (windowsProtocolOutput.includes("VERDANZA_WINDOWS_JOB_TREE_STOPPED")) {
      owned.windowsJobTreeStopped = true;
    }
    if (windowsProtocolOutput.includes("VERDANZA_WINDOWS_JOB_ERROR")) {
      owned.windowsJobSetupFailed = true;
    }
  };
  const scheduleBoundedLogFinalization = () => {
    if (stdioCloseTimer || owned.childClosed) return;
    stdioCloseTimer = setTimeout(() => {
      recordLogIssue("close", { code: "CHILD_STDIO_CLOSE_TIMEOUT" });
      void finalizeLog();
    }, options.childStdioCloseTimeoutMs ?? CHILD_STDIO_CLOSE_TIMEOUT_MS);
  };
  child.stdout?.on("data", (chunk) => {
    owned.recentStdout = `${owned.recentStdout ?? ""}${String(chunk)}`.slice(-MAX_RECENT_PROCESS_OUTPUT);
    observeWindowsJobProtocol(chunk);
    const value = `[${name}] ${String(chunk)}`;
    if (stdoutLease) stdoutLease.write(value);
    else if (!parentStdoutWriterFailed) {
      parentStdoutWriterFailed = !safeParentWrite(options.parentStdoutWrite, value);
    }
    writeLog(chunk as Buffer);
  });
  child.stderr?.on("data", (chunk) => {
    owned.recentStderr = `${owned.recentStderr ?? ""}${String(chunk)}`.slice(-MAX_RECENT_PROCESS_OUTPUT);
    observeWindowsJobProtocol(chunk);
    const value = `[${name}] ${String(chunk)}`;
    if (stderrLease) stderrLease.write(value);
    else if (!parentStderrWriterFailed) {
      parentStderrWriterFailed = !safeParentWrite(options.parentStderrWrite, value);
    }
    writeLog(chunk as Buffer);
  });
  child.once("error", (error) => {
    owned.spawnError = error;
    writeLog(`[spawn-error] code=${safeDiagnosticCode(error)}\n`);
    scheduleBoundedLogFinalization();
  });
  child.once("exit", scheduleBoundedLogFinalization);
  child.once("close", () => {
    owned.childClosed = true;
    if (stdioCloseTimer) clearTimeout(stdioCloseTimer);
    releaseParentOutputs();
    void finalizeLog();
  });
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
    await waitForOwnedProcessLog(owned);
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

export function stopOwnedProcess(processRef: OwnedProcess): Promise<OwnedProcessStopOutcome> {
  if (processRef.stopPromise) return processRef.stopPromise;
  processRef.stopPromise = (async () => {
    const pid = processRef.child.pid;
    let preservedFailure: unknown;
    if (hasSettled(processRef.child) && processRef.kind === "service" && !processRef.stopRequested) {
      preservedFailure = new Error(
        `${processRef.name} s’est arrêté avant la demande d’arrêt ` +
        `(code ${processRef.child.exitCode}, signal ${processRef.child.signalCode ?? "aucun"}).`,
      );
    }
    processRef.stopRequested = true;
    const complete = async (
      mode: OwnedProcessStopOutcome["mode"],
      fallbackReason?: string,
      cleanupFailure?: unknown,
    ) => {
      if (!ownedProcessTreeStopped(processRef)) await processRef.finalizeLog?.();
      await waitForOwnedProcessLog(processRef);
      const outcome: OwnedProcessStopOutcome = {
        mode,
        forced: mode === "forced",
        ...(fallbackReason ? { fallbackReason } : {}),
        childStopped: hasSettled(processRef.child),
        ownedTreeStopped: ownedProcessTreeStopped(processRef),
        log: ownedProcessLogSnapshot(processRef),
      };
      processRef.stopOutcome = outcome;
      if (preservedFailure !== undefined) {
        attachSecondaryStopFailure(preservedFailure, cleanupFailure);
        throw preservedFailure;
      }
      if (cleanupFailure !== undefined) throw cleanupFailure;
      return outcome;
    };
    if (!pid) return complete("already-stopped");
    if (process.platform === "win32" && !processRef.ownsWindowsJobObject) {
      return complete(
        "already-stopped",
        undefined,
        new Error(`arrêt de l’arbre Windows non prouvé pour ${processRef.name} : Job Object absent.`),
      );
    }
    if (ownedProcessTreeStopped(processRef)) return complete("already-stopped");
    if (process.platform === "win32" && hasSettled(processRef.child)) {
      if (await ownedProcessTreeStoppedWithin(
        processRef,
        processRef.stopForcePeriodMs ?? PROCESS_FORCE_PERIOD_MS,
      )) {
        return complete("already-stopped");
      }
      return complete(
        "already-stopped",
        undefined,
        new Error(`fermeture du Job Object Windows non prouvée pour ${processRef.name}.`),
      );
    }

    let gracefulFailure: unknown;
    if (processRef.gracefulStop && !hasSettled(processRef.child)) {
      try {
        await promiseWithin(
          processRef.gracefulStop(),
          PROCESS_GRACEFUL_ACTION_TIMEOUT_MS,
          `demande d’arrêt gracieux hors délai pour le PID ${pid}.`,
        );
        if (await ownedProcessTreeStoppedWithin(
          processRef,
          processRef.stopGracePeriodMs ?? PROCESS_FORCE_PERIOD_MS,
        )) {
          if (processRef.child.exitCode !== 0 || processRef.child.signalCode !== null) {
            preservedFailure = new Error(
              `${processRef.name} a signalé un arrêt en échec ` +
              `(code ${processRef.child.exitCode}, signal ${processRef.child.signalCode ?? "aucun"}).`,
            );
          }
          return complete("graceful");
        }
        gracefulFailure = new Error(`arrêt gracieux hors délai pour le PID ${pid}.`);
      } catch (error) {
        gracefulFailure = error;
      }
    }
    if (ownedProcessTreeStopped(processRef)) {
      if (gracefulFailure !== undefined) preservedFailure ??= gracefulFailure;
      return complete("graceful");
    }

    let fallbackReason: string | undefined;
    let cleanupFailure: unknown;
    if (process.platform === "win32") {
      fallbackReason = gracefulFailure === undefined
        ? "arrêt du Job Object Windows requis"
        : safeDiagnosticReason(gracefulFailure);
      try {
        await requestWindowsJobStop(processRef);
        if (!(await ownedProcessTreeStoppedWithin(
          processRef,
          processRef.stopGracePeriodMs ?? PROCESS_GRACE_PERIOD_MS,
        ))) {
          if (hasSettled(processRef.child)) {
            throw new Error(`superviseur Windows terminé sans fermeture prouvée du Job Object ${processRef.name}.`);
          }
          fallbackReason = `${fallbackReason} | superviseur Windows hors délai, fermeture par handle`;
          if (!processRef.child.kill("SIGKILL")) {
            throw new Error(`impossible d’arrêter le superviseur Windows possédé ${processRef.name}.`);
          }
        }
      } catch (error) {
        cleanupFailure = error;
      }
    } else {
      let interruptFailure: unknown;
      try {
        signalOwnedUnixProcessTree(processRef, "SIGINT");
      } catch (error) {
        interruptFailure = error;
      }
      if (interruptFailure === undefined && await ownedProcessTreeStoppedWithin(
        processRef,
        processRef.stopGracePeriodMs ?? PROCESS_GRACE_PERIOD_MS,
      )) {
        if (gracefulFailure !== undefined) preservedFailure ??= gracefulFailure;
        return complete("graceful");
      }
      const interruptReason = interruptFailure ?? new Error(`arrêt SIGINT hors délai pour le groupe possédé ${processRef.unixProcessGroupId ?? pid}.`);
      fallbackReason = [gracefulFailure, interruptReason]
        .filter((entry) => entry !== undefined)
        .map(safeDiagnosticReason)
        .join(" | ");
      try {
        signalOwnedUnixProcessTree(processRef, "SIGKILL");
      } catch (error) {
        cleanupFailure = error;
      }
    }

    if (cleanupFailure === undefined && !(await ownedProcessTreeStoppedWithin(
      processRef,
      processRef.stopForcePeriodMs ?? PROCESS_FORCE_PERIOD_MS,
    ))) {
      cleanupFailure = new Error(
        `l’arbre possédé du PID ${pid} ne s’est pas arrêté dans le délai.`,
      );
    }
    if (gracefulFailure !== undefined) preservedFailure ??= gracefulFailure;
    return complete("forced", fallbackReason, cleanupFailure);
  })();
  return processRef.stopPromise;
}

export async function waitForOwnedProcessLog(processRef: OwnedProcess) {
  if (processRef.logFinalization) await processRef.logFinalization;
}

export function ownedProcessReliabilitySnapshot(processRef: OwnedProcess) {
  return {
    name: processRef.name,
    kind: processRef.kind,
    pid: processRef.child.pid,
    exitCode: processRef.child.exitCode,
    signalCode: processRef.child.signalCode,
    logPath: processRef.logPath,
    unixProcessGroupId: processRef.unixProcessGroupId ?? null,
    ownsUnixProcessGroup: processRef.ownsUnixProcessGroup === true,
    ownsWindowsJobObject: processRef.ownsWindowsJobObject === true,
    windowsPrimaryProcessId: processRef.windowsPrimaryProcessId ?? null,
    windowsJobReady: processRef.windowsJobReady === true,
    windowsJobTreeStopped: processRef.windowsJobTreeStopped === true,
    windowsJobSetupFailed: processRef.windowsJobSetupFailed === true,
    log: ownedProcessLogSnapshot(processRef),
    stop: processRef.stopOutcome ?? null,
  };
}

function ownedProcessLogSnapshot(processRef: OwnedProcess): OwnedProcessLogReport {
  return processRef.logReport
    ? { ...processRef.logReport, issues: processRef.logReport.issues.map((issue) => ({ ...issue })) }
    : { auxiliary: true, status: "complete", finalized: true, issues: [] };
}

function ownedProcessTreeStopped(processRef: OwnedProcess) {
  const childStopped = hasSettled(processRef.child);
  if (process.platform === "win32") {
    return processRef.ownsWindowsJobObject === true
      && processRef.windowsJobReady === true
      && processRef.childClosed === true;
  }
  if (!processRef.ownsUnixProcessGroup || !processRef.unixProcessGroupId) return childStopped;
  return childStopped && !unixProcessGroupAlive(processRef.unixProcessGroupId);
}

async function ownedProcessTreeStoppedWithin(processRef: OwnedProcess, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ownedProcessTreeStopped(processRef)) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  return ownedProcessTreeStopped(processRef);
}

function unixProcessGroupAlive(processGroupId: number) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return !isProcessNotFound(error);
  }
}

function signalOwnedUnixProcessTree(processRef: OwnedProcess, signal: NodeJS.Signals) {
  const processGroupId = processRef.unixProcessGroupId;
  if (processRef.ownsUnixProcessGroup && processGroupId) {
    if (processGroupId <= 0 || processGroupId === process.pid) {
      throw new Error("Refus de signaler un groupe Unix qui n’est pas isolé du harness.");
    }
    try {
      process.kill(-processGroupId, signal);
      return;
    } catch (error) {
      if (isProcessNotFound(error)) return;
      throw error;
    }
  }
  if (!hasSettled(processRef.child)) processRef.child.kill(signal);
}

function windowsPowerShellExecutable(environment: NodeJS.ProcessEnv) {
  const windowsRoot = environment.SystemRoot ?? process.env.SystemRoot;
  if (!windowsRoot) {
    throw new Error("SystemRoot absent : impossible d’établir le Job Object Windows.");
  }
  return resolve(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

async function requestWindowsJobStop(processRef: OwnedProcess) {
  if (!processRef.ownsWindowsJobObject) {
    throw new Error(`Appartenance Job Object Windows absente pour ${processRef.name}.`);
  }
  const input = processRef.child.stdin;
  if (!input || input.destroyed || !input.writable) {
    throw new Error(`Canal de contrôle du Job Object Windows indisponible pour ${processRef.name}.`);
  }
  await new Promise<void>((resolvePromise, reject) => {
    input.end("STOP\n", (error?: Error | null) => {
      if (error) reject(error);
      else resolvePromise();
    });
  });
}

function attachSecondaryStopFailure(primaryFailure: unknown, secondaryFailure: unknown) {
  if (!(primaryFailure instanceof Error) || secondaryFailure === undefined) return;
  try {
    Object.defineProperty(primaryFailure, "cleanupError", {
      configurable: true,
      enumerable: false,
      value: safeDiagnosticReason(secondaryFailure),
    });
  } catch {
    // L’erreur antérieure reste l’erreur rendue au lanceur.
  }
}

async function promiseWithin<Value>(promise: Promise<Value>, timeoutMs: number, timeoutMessage: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isProcessNotFound(error: unknown) {
  return Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === "ESRCH";
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

function safeDiagnosticCode(error: unknown) {
  const candidate = Boolean(error) && typeof error === "object"
    ? (error as { code?: unknown }).code
    : undefined;
  const raw = String(candidate ?? (error instanceof Error ? error.name : "UNKNOWN"));
  const sanitized = raw.toUpperCase().replace(/[^A-Z0-9_-]/g, "_").slice(0, 64);
  return sanitized || "UNKNOWN";
}

function safeDiagnosticReason(error: unknown) {
  return safeError(error)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9._~-]+/g, "[jwt-redacted]")
    .replace(/(https?:\/\/[^\s?]+)\?[^\s'"]+/g, "$1?[redacted]")
    .slice(0, 500);
}

function safeProcessName(name: string) {
  return name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "unknown";
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
  let sourceReadErrorCode: string | undefined;
  if (emulatorLog) {
    try {
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
    } catch (error) {
      sourceReadErrorCode = safeDiagnosticCode(error);
      try {
        console.error(`[harness-diagnostics] log auxiliaire indisponible code=${sourceReadErrorCode}`);
      } catch {
        // La preuve structurée ci-dessous conserve déjà ce défaut auxiliaire.
      }
    }
  }
  await writeFile(
    resolve(runDirectory, "emulator-diagnostics.json"),
    `${JSON.stringify({
      source: "firebase-emulators.log",
      entries,
      ...(sourceReadErrorCode ? { sourceReadErrorCode } : {}),
      ownedProcesses: processes.map(ownedProcessReliabilitySnapshot),
    }, null, 2)}\n`,
    "utf8",
  );
}
