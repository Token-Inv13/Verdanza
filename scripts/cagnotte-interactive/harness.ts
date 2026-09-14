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
  assertDiagnosticJournalComplete,
  diagnosticErrorCode,
  incompleteDiagnosticJournalSnapshot,
  isDiagnosticJournalSnapshot,
  type DiagnosticJournalSnapshot,
} from "./diagnosticJournal.js";

type OwnedProcess = { name: string; child: ChildProcess; logPath: string };
const AUTH_EMULATOR_READY_TIMEOUT_MS = 120_000;
const ONE_SHOT_TIMEOUT_MS = 60_000;

export type RecipeHarness = {
  runDirectory: string;
  environment: NodeJS.ProcessEnv;
  processes: OwnedProcess[];
  stop: () => Promise<void>;
  stopService: (name: string) => Promise<void>;
  finalizeDiagnostics: () => Promise<DiagnosticJournalSnapshot>;
  diagnosticsSnapshot: () => DiagnosticJournalSnapshot | undefined;
};

export async function startRecipeHarness(label: string): Promise<RecipeHarness> {
  const startedAt = new Date().toISOString();
  assertInteractivePrerequisites();
  const runDirectory = resolve(
    RECIPE_CACHE_ROOT,
    "runs",
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${label}`,
  );
  await mkdir(runDirectory, { recursive: true });
  await assertPortsAvailable();
  const environment = buildRecipeEnvironment(runDirectory);
  const processes: OwnedProcess[] = [];
  let finalizedDiagnostics: DiagnosticJournalSnapshot | undefined;
  let finalizationPromise: Promise<DiagnosticJournalSnapshot> | undefined;
  const finalizeDiagnostics = () => {
    if (finalizedDiagnostics) return Promise.resolve(finalizedDiagnostics);
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
    stop: async () => stopAllWithDiagnostics(processes, finalizeDiagnostics),
    stopService: async (name) => {
      const target = processes.find((entry) => entry.name === name);
      if (!target) return;
      const failures: unknown[] = [];
      if (name === "local-api") {
        try {
          assertDiagnosticJournalComplete(await finalizeDiagnostics());
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        await stopOwned(target);
      } catch (error) {
        failures.push(error);
      }
      throwCollectedFailures(failures, `Arrêt incomplet du service ${name}.`);
    },
    finalizeDiagnostics,
    diagnosticsSnapshot: () => finalizedDiagnostics,
  };
  try {
    processes.push(spawnOwned("firebase-emulators", [
      resolve(RECIPE_ROOT, "node_modules/firebase-tools/lib/bin/firebase.js"),
      "emulators:start",
      "--only", "auth,firestore",
      "--project", RECIPE_PROJECT_ID,
      "--config", resolve(RECIPE_ROOT, "firebase.cagnotte.interactive.json"),
    ], environment, runDirectory));
    await waitForHttp(localUrl(RECIPE_PORTS.firestore), processes[0], 60_000);
    await waitForHttp(
      localUrl(RECIPE_PORTS.auth, `/emulator/v1/projects/${RECIPE_PROJECT_ID}/accounts`),
      processes[0],
      AUTH_EMULATOR_READY_TIMEOUT_MS,
    );
    await runOneShot("seed", [
      "--import", "tsx",
      resolve(RECIPE_ROOT, "scripts/cagnotte-interactive/seed.ts"),
    ], environment, runDirectory);
    await runOneShot("warm-firestore-listen", [
      "--import", "tsx",
      resolve(RECIPE_ROOT, "scripts/cagnotte-interactive/warmFirestoreListen.ts"),
    ], environment, runDirectory);

    processes.push(spawnOwned("local-api", [
      "--import", "tsx",
      resolve(RECIPE_ROOT, "scripts/cagnotte-interactive/server.ts"),
    ], environment, runDirectory));
    await waitForHttp(localUrl(RECIPE_PORTS.api, "/__recette/health"), processes.at(-1)!, 30_000);
    processes.push(spawnOwned("vite-app", [
      resolve(RECIPE_ROOT, "node_modules/vite/bin/vite.js"),
      "--config", resolve(RECIPE_ROOT, "vite.cagnotte-interactive.config.ts"),
      "--host", RECIPE_HOST,
      "--port", String(RECIPE_PORTS.app),
      "--strictPort",
    ], environment, runDirectory));
    await waitForHttp(localUrl(RECIPE_PORTS.app, "/connexion"), processes.at(-1)!, 30_000);
    await writeFile(resolve(runDirectory, "processes.json"), `${JSON.stringify({
      projectId: RECIPE_PROJECT_ID,
      origin: localUrl(RECIPE_PORTS.app),
      ports: RECIPE_PORTS,
      processes: processes.map(({ name, child, logPath }) => ({ name, pid: child.pid, logPath })),
    }, null, 2)}\n`, "utf8");
    return harness;
  } catch (error) {
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
  ], harness.environment, harness.runDirectory);
}

async function assertPortsAvailable() {
  const occupied: number[] = [];
  for (const port of Object.values(RECIPE_PORTS)) {
    if (!(await canBind(port))) occupied.push(port);
  }
  if (occupied.length) {
    throw new Error(`Démarrage refusé : port(s) déjà occupé(s), aucun processus arrêté : ${occupied.join(", ")}.`);
  }
}

async function canBind(port: number) {
  return new Promise<boolean>((resolvePromise) => {
    const server = net.createServer();
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(value);
    };
    const timer = setTimeout(() => {
      server.close();
      finish(false);
    }, 2_000);
    server.once("error", () => finish(false));
    server.listen(port, RECIPE_HOST, () => server.close(() => finish(true)));
  });
}

function spawnOwned(name: string, args: string[], environment: NodeJS.ProcessEnv, runDirectory: string) {
  const logPath = resolve(runDirectory, `${name}.log`);
  const log = createWriteStream(logPath, { flags: "a" });
  const child = spawn(process.execPath, args, {
    cwd: RECIPE_ROOT,
    env: environment,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => { process.stdout.write(`[${name}] ${chunk}`); log.write(chunk); });
  child.stderr?.on("data", (chunk) => { process.stderr.write(`[${name}] ${chunk}`); log.write(chunk); });
  child.once("exit", () => log.end());
  return { name, child, logPath };
}

async function runOneShot(name: string, args: string[], environment: NodeJS.ProcessEnv, runDirectory: string) {
  const owned = spawnOwned(name, args, environment, runDirectory);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const code = await Promise.race([
      waitForOneShot(owned.child),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${name} n’a pas terminé dans le délai de ${ONE_SHOT_TIMEOUT_MS} ms.`)),
          ONE_SHOT_TIMEOUT_MS,
        );
      }),
    ]);
    if (code !== 0) throw new Error(`${name} a échoué avec le code ${code}. Voir ${owned.logPath}`);
  } catch (error) {
    try {
      await stopOwned(owned);
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
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForHttp(url: string, processRef: OwnedProcess, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (hasSettled(processRef.child)) {
      throw new Error(
        `${processRef.name} s’est arrêté avant disponibilité ` +
        `(code ${processRef.child.exitCode}, signal ${processRef.child.signalCode ?? "aucun"}).`,
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error(`${processRef.name} indisponible après ${timeoutMs} ms (${lastError}).`);
}

async function stopAll(processes: OwnedProcess[]) {
  const failures: Error[] = [];
  for (const processRef of [...processes].reverse()) {
    try {
      await stopOwned(processRef);
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
) {
  const failures: unknown[] = [];
  if (processes.some((entry) => entry.name === "local-api")) {
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

async function stopOwned(processRef: OwnedProcess) {
  if (!processRef.child.pid || hasSettled(processRef.child)) return;
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

function hasSettled(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
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
        signal: AbortSignal.timeout(3_000),
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
