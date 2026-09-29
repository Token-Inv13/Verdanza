import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(process.argv.length, 2, "Emulator preparation accepts no custom targets");
const require = createRequire(import.meta.url);
const info = require("firebase-tools/lib/emulator/downloadableEmulatorInfo.json");
const root = fileURLToPath(new URL("../", import.meta.url));
const cache = join(homedir(), ".cache/firebase/emulators");

// Explicit public runtime preparation only; tests never download an emulator.
for (const name of ["firestore", "storage"]) {
  const runtime = info[name];
  const target = join(cache, runtime.downloadPathRelativeToCacheDir);
  const digest = (bytes) => assert.equal(createHash("sha256").update(bytes).digest("hex"), runtime.expectedChecksumSHA256, `${name}: official emulator checksum mismatch`);
  try {
    digest(await readFile(target));
    console.log(`PASS ${name}: official cached runtime verified`);
    continue;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let bytes;
  if (name === "firestore") {
    try { bytes = await readFile(join(root, "node_modules/.cache/cagnotte", runtime.downloadPathRelativeToCacheDir)); digest(bytes); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (!bytes) {
    const url = new URL(runtime.remoteUrl);
    assert.equal(url.origin, "https://storage.googleapis.com");
    assert.ok(url.pathname.startsWith("/firebase-preview-drop/emulator/"));
    const response = await fetch(url, { redirect: "error" });
    assert.ok(response.ok, `${name}: download refused (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
    digest(bytes);
  }
  await mkdir(cache, { recursive: true });
  const temporary = `${target}.download-${process.pid}`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
  console.log(`PASS ${name}: official runtime prepared with SHA-256 verification`);
}
