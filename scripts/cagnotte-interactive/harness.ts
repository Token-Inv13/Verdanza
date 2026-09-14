import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
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

type OwnedProcess = { name: string; child: ChildProcess; logPath: string };

export type RecipeHarness = {
  runDirectory: string;
  environment: NodeJS.ProcessEnv;
  processes: OwnedProcess[];
  stop: () => Promise<void>;
  stopService: (name: string) => Promise<void>;
};

export async function startRecipeHarness(label: string): Promise<RecipeHarness> {
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
  const harness: RecipeHarness = {
    runDirectory,
    environment,
    processes,
    stop: async () => stopAll(processes),
    stopService: async (name) => {
      const target = processes.find((entry) => entry.name === name);
      if (target) await stopOwned(target);
    },
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
      30_000,
    );

    await runOneShot("seed", [
      "--import", "tsx",
      resolve(RECIPE_ROOT, "scripts/cagnotte-interactive/seed.ts"),
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
    await harness.stop();
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
    server.once("error", () => resolvePromise(false));
    server.listen(port, RECIPE_HOST, () => server.close(() => resolvePromise(true)));
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
  const code = await waitForExit(owned.child);
  if (code !== 0) throw new Error(`${name} a échoué avec le code ${code}. Voir ${owned.logPath}`);
}

async function waitForHttp(url: string, processRef: OwnedProcess, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (processRef.child.exitCode !== null) {
      throw new Error(`${processRef.name} s’est arrêté avant disponibilité (code ${processRef.child.exitCode}).`);
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
  for (const processRef of [...processes].reverse()) await stopOwned(processRef);
  const stillOpen: number[] = [];
  for (const port of Object.values(RECIPE_PORTS)) {
    if (!(await canBind(port))) stillOpen.push(port);
  }
  if (stillOpen.length) throw new Error(`Processus local encore à l’écoute sur : ${stillOpen.join(", ")}.`);
}

async function stopOwned(processRef: OwnedProcess) {
  if (!processRef.child.pid || processRef.child.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(processRef.child.pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    await waitForExit(killer);
  } else {
    processRef.child.kill("SIGINT");
    if (!(await settledWithin(processRef.child, 2_500))) processRef.child.kill("SIGKILL");
  }
  await settledWithin(processRef.child, 5_000);
}

function waitForExit(child: ChildProcess) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise<number | null>((resolvePromise) => child.once("exit", (code) => resolvePromise(code)));
}

async function settledWithin(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null) return true;
  return Promise.race([
    waitForExit(child).then(() => true),
    new Promise<false>((resolvePromise) => setTimeout(() => resolvePromise(false), timeoutMs)),
  ]);
}
