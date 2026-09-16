import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  RECIPE_CACHE_ROOT,
  RECIPE_PORTS,
  RECIPE_PROJECT_ID,
  RECIPE_ROOT,
} from "./constants.js";
import { buildRecipeEnvironment, validateRecipeEnvironment } from "./environment.js";
import { assertInteractivePrerequisites } from "./prerequisites.js";

assertInteractivePrerequisites();
const normalFeatures = await source("src/config/cagnotteFeatures.ts");
const normalProgram = await source("api/_server/cagnotteProgram.ts");
const normalReservations = await source("api/_server/cagnotteReservations.ts");
const normalRefunds = await source("api/_server/orderRefunds.ts");
assert.match(normalProgram, /CAGNOTTE_SERVER_PROGRAM[^=]*= null;/);
assert.match(normalReservations, /CAGNOTTE_RESERVATION_PROGRAM[^=]*= null;/);
assert.match(normalFeatures, /CAGNOTTE_READ_DISPLAY_ENABLED[^=]*= false(?: as const)?;/);
assert.match(normalFeatures, /CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED[^=]*= false(?: as const)?;/);
assert.match(normalFeatures, /CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED[^=]*= false(?: as const)?;/);
assert.match(await source("api/_server/cagnotteRead.ts"), /CAGNOTTE_READ_SERVER_ENABLED[^=]*= false(?: as const)?;/);
assert.match(normalRefunds, /ORDER_REFUNDS_ENABLED[^=]*= false(?: as const)?;/);

const viteNormal = await source("vite.config.ts");
const viteRecipe = await source("vite.cagnotte-interactive.config.ts");
assert.doesNotMatch(viteNormal, /cagnotte-interactive|demo-verdanza-cagnotte|19099|18086/);
for (const marker of ["src/lib/firebase", "src/lib/firebaseAuth", "src/config/cagnotteFeatures", "addressAutocompleteService", "googleTagManager"]) {
  assert.ok(viteRecipe.includes(marker), `adaptateur local absent : ${marker}`);
}
assert.match(viteRecipe, /envDir: emptyEnvDir/);
assert.doesNotMatch(viteRecipe, /loadEnv|dotenv|VitePWA/);

const runDirectory = resolve(RECIPE_CACHE_ROOT, "isolation-check");
await rm(runDirectory, { recursive: true, force: true });
const environment = buildRecipeEnvironment(runDirectory);
assert.equal(environment.GCLOUD_PROJECT, RECIPE_PROJECT_ID);
assert.equal(environment.FIRESTORE_EMULATOR_HOST, `127.0.0.1:${RECIPE_PORTS.firestore}`);
assert.equal(environment.FIREBASE_AUTH_EMULATOR_HOST, `127.0.0.1:${RECIPE_PORTS.auth}`);
for (const forbidden of ["FIREBASE_SERVICE_ACCOUNT_BASE64", "FIREBASE_PRIVATE_KEY", "FIREBASE_TOKEN", "GOOGLE_APPLICATION_CREDENTIALS", "VERCEL_TOKEN"]) {
  assert.equal(environment[forbidden], undefined, `${forbidden} ne doit pas être transmis`);
}
assert.throws(() => validateRecipeEnvironment({ ...environment, GCLOUD_PROJECT: "verdanza-1f621" }), /ISOLATION/);
assert.throws(() => validateRecipeEnvironment({ ...environment, FIREBASE_AUTH_EMULATOR_HOST: "identitytoolkit.googleapis.com" }), /ISOLATION/);

const networkProbe = spawn(process.execPath, ["-e", "fetch('https://example.com').then(()=>process.exit(9)).catch(e=>{console.log(e.code||e.message);process.exit(0)})"], {
  cwd: RECIPE_ROOT,
  env: environment,
  shell: false,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let probeOutput = "";
networkProbe.stdout?.on("data", (chunk) => { probeOutput += chunk; });
networkProbe.stderr?.on("data", (chunk) => { probeOutput += chunk; });
const probeCode = await new Promise<number | null>((resolvePromise) => networkProbe.once("exit", resolvePromise));
assert.equal(probeCode, 0);
assert.match(probeOutput, /ISOLATION_NETWORK_BLOCKED/);
const blocks = await readFile(resolve(runDirectory, "server-network-blocks.jsonl"), "utf8");
assert.match(blocks, /"host":"example\.com"/);
assert.match(blocks, /"blocked":true/);

console.log("Isolation interactive vérifiée : sept gardes normales fermées, adaptateurs réservés à Vite recette, environnement sans credential, projet/ports exacts et sortie réseau effectivement bloquée.");

function source(relativePath: string) {
  return readFile(resolve(RECIPE_ROOT, relativePath), "utf8");
}
