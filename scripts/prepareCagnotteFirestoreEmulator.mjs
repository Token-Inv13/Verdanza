import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = "1.22.0";
const expectedSha256 = "9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c";
const downloadUrl = `https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v${version}.jar`;
const root = fileURLToPath(new URL("../", import.meta.url));
const cacheArgument = process.argv.slice(2);

if (cacheArgument.length > 1 || (cacheArgument[0] && !cacheArgument[0].startsWith("--cache-dir="))) {
  throw new Error("Usage: node scripts/prepareCagnotteFirestoreEmulator.mjs [--cache-dir=<dossier>]");
}

const requestedCacheDir = cacheArgument[0]?.slice("--cache-dir=".length);
if (cacheArgument[0] && !requestedCacheDir) throw new Error("Le dossier de cache ne peut pas être vide.");
const cacheDir = requestedCacheDir ? resolve(requestedCacheDir) : resolve(root, "node_modules/.cache/cagnotte");
const target = resolve(cacheDir, `cloud-firestore-emulator-v${version}.jar`);
const temporary = `${target}.download-${process.pid}`;

try {
  const existing = await readFile(target);
  assertDigest(existing, "L’émulateur présent possède une empreinte inattendue.");
  console.log(`Émulateur Firestore ${version} déjà valide : ${target}`);
  process.exit(0);
} catch (error) {
  if (!isMissing(error)) throw error;
}

await mkdir(dirname(target), { recursive: true });
await rm(temporary, { force: true });
try {
  const response = await fetch(downloadUrl, { redirect: "follow" });
  if (!response.ok) throw new Error(`Téléchargement émulateur refusé : HTTP ${response.status}.`);
  if (new URL(response.url).protocol !== "https:") throw new Error("Le téléchargement émulateur a quitté HTTPS.");
  const bytes = Buffer.from(await response.arrayBuffer());
  assertDigest(bytes, "L’émulateur téléchargé possède une empreinte inattendue.");
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, target);
  console.log(`Émulateur Firestore ${version} préparé et vérifié : ${target}`);
} finally {
  await rm(temporary, { force: true });
}

function assertDigest(bytes, message) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSha256) throw new Error(`${message} SHA-256 reçu : ${actual}`);
}

function isMissing(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
