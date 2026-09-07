import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  assertCagnotteEmulatorAvailable,
  CAGNOTTE_DEMO,
  createCagnotteTestEnvironment,
  validateCagnotteEmulatorTarget,
} from "./cagnotteEmulator.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const localHome = resolve(root, "node_modules/.cache/cagnotte/home");
await mkdir(localHome, { recursive: true });
const env = createCagnotteTestEnvironment(process.env, localHome);
const config = JSON.parse(await readFile(resolve(root, "firebase.cagnotte.local.json"), "utf8"));
const target = { projectId: config.cagnotteTest.projectId, ...config.emulators.firestore };
validateCagnotteEmulatorTarget(target);
if (config.firestore.rules !== "firestore.cagnotte.local.rules" || config.cagnotteTest.emulatorVersion !== "1.22.0") {
  throw new Error("Configuration locale inattendue.");
}

const allowedOptions = new Set([
  "--unit-only",
  "--reservations-only",
  "--regularization-only",
  "--orders-only",
  "--checkout-use-only",
  "--checkout-client-only",
  "--refunds-only",
  "--payment-links-only",
  "--server-security-only",
  "--admin-reviews-only",
  "--security-only",
  "--read-only",
]);
const options = process.argv.slice(2);
if (options.length > 1 || options.some((option) => !allowedOptions.has(option))) {
  throw new Error("Option de test transactionnel inattendue.");
}
const mode = options[0] ?? "ledger";

async function run(script: string, args: string[] = []) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--import", "./scripts/cagnotteNetworkGuard.ts", script, ...args],
    { cwd: root, env, windowsHide: true, stdio: "inherit" },
  );
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`Échec du contrôle local ${script}.`);
}

// Refuse an occupied port. Never stop or adopt a pre-existing process.
await new Promise<void>((accept, reject) => {
  const server = createServer();
  server.once("error", () => reject(new Error("Port dédié occupé : aucun processus existant arrêté.")));
  server.listen({ host: target.host, port: target.port, exclusive: true }, () =>
    server.close((error) => (error ? reject(error) : accept())),
  );
});

if (mode === "ledger" || mode === "--unit-only") {
  await run("scripts/testCagnotteLedger.ts", ["--unit"]);
}
if (mode === "--unit-only") process.exit(0);

const jar = resolve(root, "node_modules/.cache/cagnotte/cloud-firestore-emulator-v1.22.0.jar");
const digest = createHash("sha256").update(await readFile(jar)).digest("hex");
if (digest !== "9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c") {
  throw new Error("Émulateur 1.22.0 absent ou empreinte inattendue.");
}
const rulesPath = resolve(root, mode === "--security-only" || mode === "--server-security-only" ? "firestore.rules" : config.firestore.rules);
const rules = await readFile(rulesPath);
if (!rules.length) throw new Error(mode === "--security-only" ? "Fichier complet de règles absent/vide." : "Règles locales de test absentes ou vides.");
if (mode === "--security-only" || mode === "--server-security-only") {
  console.log(`Règles candidates : ${rulesPath}\nSHA-256 : ${createHash("sha256").update(rules).digest("hex")}`);
}

const log = createWriteStream(resolve(localHome, "firestore.log"), { flags: "a" });
const emulator = spawn(
  "java",
  [
    `-Duser.home=${localHome}`,
    "-Duser.language=en",
    "-Duser.country=US",
    "-jar",
    jar,
    "--host",
    target.host,
    "--port",
    String(target.port),
    "--project_id",
    target.projectId,
    "--single_project_mode",
    "true",
    "--single_project_mode_error",
    "true",
    "--rules",
    rulesPath,
  ],
  { cwd: localHome, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
emulator.stdout.pipe(log, { end: false });
emulator.stderr.pipe(log, { end: false });
const exited = once(emulator, "exit");
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (emulator.exitCode !== null) throw new Error("Émulateur arrêté avant disponibilité ; consulter le journal local.");
    try {
      await assertCagnotteEmulatorAvailable(CAGNOTTE_DEMO);
      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }
  if (!ready) throw new Error("Émulateur inaccessible, aucun test Firestore exécuté.");
  console.log(`Émulateur officiel 1.22.0 : ${target.projectId}, ${target.host}:${target.port}, PID ${emulator.pid}.`);
  if (mode === "ledger") await run("scripts/testCagnotteLedger.ts", ["--emulator"]);
  if (mode === "--reservations-only") await run("scripts/testCagnotteReservations.ts");
  if (mode === "--regularization-only") await run("scripts/testCagnotteRegularization.ts");
  if (mode === "--orders-only") await run("scripts/testCagnotteOrders.ts");
  if (mode === "--checkout-use-only") await run("scripts/testCagnotteCheckoutIntegration.ts");
  if (mode === "--checkout-client-only") await run("scripts/testCagnotteCheckoutClientContract.ts");
  if (mode === "--refunds-only") await run("scripts/testOrderRefunds.ts");
  if (mode === "--payment-links-only") {
    await run("scripts/testPaymentLinkReliability.ts");
    await run("scripts/testCagnottePaymentLinks.ts");
  }
  if (mode === "--server-security-only") await run("scripts/testCagnotteSecurity.ts");
  if (mode === "--admin-reviews-only") await run("scripts/testCagnotteAdminReviews.ts");
  if (mode === "--security-only") {
    await run("scripts/testCagnotteRules.ts");
    await run("scripts/testCagnotteSecurity.ts");
  }
  if (mode === "--read-only") await run("scripts/testCagnotteRead.ts");
} finally {
  // Stop only the direct Java child created by this runner.
  if (emulator.exitCode === null) emulator.kill();
  await exited;
  log.end();
  console.log("Processus émulateur créé par ces tests arrêté.");
}
