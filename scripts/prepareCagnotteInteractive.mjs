import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const firebasePackagePath = resolve(root, "node_modules/firebase-tools/package.json");
const firestoreJar = resolve(root, "node_modules/.cache/cagnotte/cloud-firestore-emulator-v1.22.0.jar");
const expectedJarSha256 = "9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c";

const firebasePackage = JSON.parse(readFileSync(firebasePackagePath, "utf8"));
if (firebasePackage.version !== "15.28.1") {
  throw new Error(`firebase-tools 15.28.1 requis, version trouvée : ${firebasePackage.version || "absente"}.`);
}

run(process.execPath, [resolve(root, "scripts/prepareCagnotteFirestoreEmulator.mjs")]);
const jarDigest = createHash("sha256").update(await readFile(firestoreJar)).digest("hex");
if (jarDigest !== expectedJarSha256) throw new Error(`Empreinte Firestore Emulator inattendue : ${jarDigest}.`);

const java = spawnSync("java", ["-version"], { encoding: "utf8", shell: false, windowsHide: true });
if (java.status !== 0 || !/version "(?:21|2[2-9]|[3-9]\d)\./.test(`${java.stdout}\n${java.stderr}`)) {
  throw new Error("Java 21 ou supérieur est requis pour Firestore Emulator.");
}

if (!existsSync(chromium.executablePath())) {
  console.log("Chromium Playwright absent : préparation depuis la distribution officielle Playwright.");
  run(process.execPath, [resolve(root, "node_modules/playwright/cli.js"), "install", "chromium"]);
}
if (!existsSync(chromium.executablePath())) throw new Error("Chromium Playwright reste indisponible après préparation.");

console.log(`Préparation interactive terminée : firebase-tools ${firebasePackage.version} (npm officiel), Firestore Emulator 1.22.0 (${jarDigest}), Java compatible et Chromium Playwright présent.`);
console.log("Aucun émulateur ni serveur applicatif n’a été démarré.");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false, windowsHide: true });
  if (result.status !== 0) throw new Error(`Préparation interrompue (${command}, code ${result.status}).`);
}
