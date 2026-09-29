import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = "demo-verdanza-admin-storage";
const require = createRequire(import.meta.url);
if (process.argv[2] === "--execute") {
  // Firebase Tools sends optional IDE notifications even without Data Connect.
  // This fixture has no IDE integration; keep the strict network guard intact.
  const webhook = require("firebase-tools/lib/dataconnect/webhook") as { sendVSCodeMessage: () => Promise<unknown> };
  webhook.sendVSCodeMessage = async () => undefined;
  const firebase = require("firebase-tools") as { emulators: { exec: (command: string, options: object) => Promise<unknown> } };
  await firebase.emulators.exec(
    "node --import tsx --import ./scripts/adminStorageNetworkGuard.ts scripts/testAdminStorageRules.ts",
    { project, config: "firebase.admin-storage.local.json", only: "firestore,storage", nonInteractive: true },
  );
} else {
  assert.equal(process.argv.length, 2, "Storage test runner accepts no custom targets");
  for (const port of [18087, 18088, 14417, 14517]) {
    await new Promise<void>((accept, reject) => {
      const server = createServer(); server.once("error", reject);
      server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close((error) => error ? reject(error) : accept()));
    });
  }
  const cache = join(process.env.USERPROFILE || "", ".cache/firebase/emulators");
  assert.ok(process.env.USERPROFILE, "Local emulator cache root missing");
  const info = require("firebase-tools/lib/emulator/downloadableEmulatorInfo.json") as Record<string, {
    downloadPathRelativeToCacheDir: string; expectedChecksumSHA256: string;
  }>;
  for (const name of ["firestore", "storage"]) {
    const bytes = await readFile(join(cache, info[name].downloadPathRelativeToCacheDir));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), info[name].expectedChecksumSHA256,
      `${name}: official cached emulator checksum mismatch; no implicit download`);
  }
  const isolatedConfig = resolve(root, "node_modules/.cache/admin-storage/config");
  await mkdir(isolatedConfig, { recursive: true });
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "JAVA_HOME"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, {
    CI: "true", XDG_CONFIG_HOME: isolatedConfig, NODE_OPTIONS: "",
    FIREBASE_EMULATORS_PATH: cache, GCLOUD_PROJECT: project,
    MARKETING_AI_ENABLED: "false", OPENAI_API_KEY: "",
  });
  const child = spawn(process.execPath, ["--import", "tsx", "--import", "./scripts/adminStorageNetworkGuard.ts",
    fileURLToPath(import.meta.url), "--execute"], { cwd: root, env, stdio: "inherit", windowsHide: true });
  child.once("error", (error) => { throw error; });
  const code = await new Promise<number>((accept) => child.once("exit", (value) => accept(value ?? 1)));
  process.exitCode = code;
}
