import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import type {
  FirebaseAdminIdentityProof,
  FirebaseAdminInitializerDependencies,
} from "../api/_server/firebaseAdmin.js";

type StorageDeleteOptions = { ignoreNotFound: true };
type StorageFile = { delete(options: StorageDeleteOptions): Promise<void> };
type StorageBucket = { file(path: string): StorageFile };
type StorageApi = { bucket(...args: unknown[]): StorageBucket };

async function deleteFiles(getStorageApi: () => StorageApi, paths: string[]) {
  const bucket = getStorageApi().bucket();
  const failed: string[] = [];
  let deleted = 0;
  for (const path of paths) {
    try {
      await bucket.file(path).delete({ ignoreNotFound: true });
      deleted += 1;
    } catch {
      failed.push(path);
    }
  }
  return { deleted, failed };
}

type MockAdminUser = { uid: string; email: string };
type MockAdminAuth = {
  getUserByEmail(email: string): Promise<MockAdminUser>;
  createUser(input: { email: string; disabled: false }): Promise<MockAdminUser>;
  updateUser(uid: string, input: { password: string; disabled: false }): Promise<MockAdminUser>;
};

async function exerciseAuthAdmin(getAuthApi: () => MockAdminAuth, email: string, password?: string) {
  const auth = getAuthApi();
  let user = await auth.getUserByEmail(email).catch((error: unknown) => {
    const code = typeof error === "object" && error && "code" in error ? error.code : "";
    if (code === "auth/user-not-found") return null;
    throw error;
  });
  if (!user) {
    user = await auth.createUser({ email, disabled: false });
  } else if (password) {
    user = await auth.updateUser(user.uid, { password, disabled: false });
  }
  return user;
}

const firebaseAdminSource = readFileSync(resolve("api/_server/firebaseAdmin.ts"), "utf8");
const invoicesSource = readFileSync(resolve("api/invoices.ts"), "utf8");
const bootstrapAuthSource = readFileSync(resolve("scripts/bootstrapAdminAuth.ts"), "utf8");

assert.match(firebaseAdminSource, /return getStorage\(\)\.bucket\(\);/);
assert.doesNotMatch(firebaseAdminSource, /firebase-admin\/auth/);
assert.doesNotMatch(firebaseAdminSource, /\bgetAuth\s*\(/);
assert.match(invoicesSource, /bucket\.file\(path\)\.delete\(\{ ignoreNotFound: true \}\)/);
assert.match(invoicesSource, /catch \{\s*failed\.push\(path\);/);
assert.match(bootstrapAuthSource, /const auth = getAuth\(\);/);
assert.match(bootstrapAuthSource, /auth\.getUserByEmail\(email\)/);
assert.match(bootstrapAuthSource, /auth\.createUser\(/);
assert.match(bootstrapAuthSource, /auth\.updateUser\(/);

const appsBeforeServerModuleImport = getApps().map((entry) => entry.name);
const importLogs: unknown[][] = [];
const originalConsoleInfo = console.info;
let firebaseAdminModule: typeof import("../api/_server/firebaseAdmin.js");
try {
  console.info = (...args: unknown[]) => { importLogs.push(args); };
  firebaseAdminModule = await import("../api/_server/firebaseAdmin.js");
} finally {
  console.info = originalConsoleInfo;
}
assert.deepEqual(getApps().map((entry) => entry.name), appsBeforeServerModuleImport);
assert.deepEqual(importLogs, []);

const {
  FirebaseAdminCredentialConfigurationError,
  initializeFirebaseAdminApp,
} = firebaseAdminModule;

type SyntheticServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};
type SyntheticCredential = {
  kind: "cert" | "application_default";
  serviceAccount?: SyntheticServiceAccount;
};
type SyntheticApp = { name: string };

function initializerHarness(initialApps: SyntheticApp[] = [], onLog?: () => void) {
  const apps = [...initialApps];
  const certInputs: SyntheticServiceAccount[] = [];
  const credentials: SyntheticCredential[] = [];
  const initializeInputs: Array<{ credential: SyntheticCredential; storageBucket?: string }> = [];
  const logs: Array<{
    event: FirebaseAdminIdentityProof["event"];
    payload: FirebaseAdminIdentityProof;
  }> = [];
  let applicationDefaultCalls = 0;
  let logAttempts = 0;

  const dependencies: FirebaseAdminInitializerDependencies<SyntheticApp, SyntheticCredential> = {
    getApps: () => apps,
    cert(serviceAccount) {
      certInputs.push(serviceAccount);
      const credential: SyntheticCredential = { kind: "cert", serviceAccount };
      credentials.push(credential);
      return credential;
    },
    applicationDefault() {
      applicationDefaultCalls += 1;
      const credential: SyntheticCredential = { kind: "application_default" };
      credentials.push(credential);
      return credential;
    },
    initializeApp(options) {
      initializeInputs.push(options);
      const app = { name: `synthetic-${initializeInputs.length}` };
      apps.splice(0, apps.length, app);
      return app;
    },
    log(event, payload) {
      logAttempts += 1;
      if (onLog) onLog();
      logs.push({ event, payload });
    },
  };

  return {
    apps,
    certInputs,
    credentials,
    dependencies,
    emittedApps: new WeakSet<object>(),
    initializeInputs,
    logs,
    get applicationDefaultCalls() { return applicationDefaultCalls; },
    get logAttempts() { return logAttempts; },
  };
}

const privateKeySentinel = "PRIVATE_KEY_SENTINEL_DO_NOT_LOG";
const encodedServiceAccount = Buffer.from(JSON.stringify({
  project_id: "synthetic-base64-project",
  client_email: "base64-service@synthetic.invalid",
  private_key: privateKeySentinel,
})).toString("base64");

{
  const harness = initializerHarness();
  const environment = {
    FIREBASE_SERVICE_ACCOUNT_BASE64: encodedServiceAccount,
    FIREBASE_PROJECT_ID: "synthetic-fields-project",
    FIREBASE_CLIENT_EMAIL: "fields-service@synthetic.invalid",
    FIREBASE_PRIVATE_KEY: "ignored-private-key",
    FIREBASE_STORAGE_BUCKET: "synthetic-bucket.invalid",
    VERCEL_DEPLOYMENT_ID: "dpl_synthetic_identity",
    VERCEL_URL: "ignored-synthetic.vercel.app",
    VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  };
  const app = initializeFirebaseAdminApp(environment, harness.dependencies, harness.emittedApps);
  assert.equal(app.name, "synthetic-1");
  assert.equal(harness.certInputs.length, 1);
  assert.equal(harness.certInputs[0].projectId, "synthetic-base64-project");
  assert.equal(harness.applicationDefaultCalls, 0);
  assert.strictEqual(harness.initializeInputs[0].credential, harness.credentials[0]);
  assert.equal(harness.initializeInputs[0].storageBucket, "synthetic-bucket.invalid");
  assert.deepEqual(harness.logs, [{
    event: "firebase_admin_identity_configured",
    payload: {
      event: "firebase_admin_identity_configured",
      credentialMethod: "service_account_base64",
      projectId: "synthetic-base64-project",
      clientEmail: "base64-service@synthetic.invalid",
      deploymentReference: "dpl_synthetic_identity",
      commit: "a".repeat(40),
    },
  }]);
  assert.deepEqual(Object.keys(harness.logs[0].payload).sort(), [
    "clientEmail",
    "commit",
    "credentialMethod",
    "deploymentReference",
    "event",
    "projectId",
  ]);
  assert.equal(JSON.stringify(harness.logs).includes(privateKeySentinel), false);

  assert.strictEqual(
    initializeFirebaseAdminApp(environment, harness.dependencies, harness.emittedApps),
    app,
  );
  assert.equal(harness.initializeInputs.length, 1);
  assert.equal(harness.logs.length, 1);
}

{
  const harness = initializerHarness();
  initializeFirebaseAdminApp({
    FIREBASE_PROJECT_ID: "synthetic-fields-project",
    FIREBASE_CLIENT_EMAIL: "fields-service@synthetic.invalid",
    FIREBASE_PRIVATE_KEY: "line-one\\nline-two",
  }, harness.dependencies, harness.emittedApps);
  assert.equal(harness.certInputs[0].privateKey, "line-one\nline-two");
  assert.equal(harness.logs[0].payload.credentialMethod, "service_account_fields");
  assert.equal(harness.logs[0].payload.projectId, "synthetic-fields-project");
  assert.equal(harness.logs[0].payload.clientEmail, "fields-service@synthetic.invalid");
}

{
  const harness = initializerHarness();
  initializeFirebaseAdminApp({}, harness.dependencies, harness.emittedApps);
  assert.equal(harness.certInputs.length, 0);
  assert.equal(harness.applicationDefaultCalls, 1);
  assert.deepEqual(harness.logs[0].payload, {
    event: "firebase_admin_identity_configured",
    credentialMethod: "application_default_unresolved",
    projectId: null,
    clientEmail: null,
    deploymentReference: null,
    commit: null,
  });
}

{
  const existingApp = { name: "preexisting" };
  const harness = initializerHarness([existingApp]);
  assert.strictEqual(
    initializeFirebaseAdminApp({}, harness.dependencies, harness.emittedApps),
    existingApp,
  );
  assert.equal(harness.certInputs.length, 0);
  assert.equal(harness.applicationDefaultCalls, 0);
  assert.equal(harness.initializeInputs.length, 0);
  assert.equal(harness.logs[0].payload.credentialMethod, "preexisting_app_unresolved");
  assert.equal(harness.logs[0].payload.projectId, null);
  assert.equal(harness.logs[0].payload.clientEmail, null);
  initializeFirebaseAdminApp({}, harness.dependencies, harness.emittedApps);
  assert.equal(harness.logs.length, 1);
}

{
  const malformed = Buffer.from(
    `{"project_id":"synthetic","private_key":"${privateKeySentinel}"`,
  ).toString("base64");
  const harness = initializerHarness();
  let captured: unknown;
  try {
    initializeFirebaseAdminApp(
      { FIREBASE_SERVICE_ACCOUNT_BASE64: malformed },
      harness.dependencies,
      harness.emittedApps,
    );
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof FirebaseAdminCredentialConfigurationError);
  assert.equal(captured.code, "firebase_admin_credential_invalid");
  assert.equal(String(captured).includes(privateKeySentinel), false);
  assert.equal(JSON.stringify(captured).includes(privateKeySentinel), false);
  assert.equal(harness.initializeInputs.length, 0);
  assert.equal(harness.logs.length, 0);
}

{
  const harness = initializerHarness([], () => { throw new Error("synthetic log failure"); });
  const app = initializeFirebaseAdminApp({}, harness.dependencies, harness.emittedApps);
  assert.equal(app.name, "synthetic-1");
  assert.equal(harness.initializeInputs.length, 1);
  assert.equal(harness.logAttempts, 1);
  initializeFirebaseAdminApp({}, harness.dependencies, harness.emittedApps);
  assert.equal(harness.logAttempts, 1);
}

const frontendSources = collectTypeScriptSources(resolve("src"));
assert.equal(frontendSources.includes("firebase_admin_identity_configured"), false);
assert.equal(frontendSources.includes("api/_server/firebaseAdmin"), false);

const app = initializeApp(
  { projectId: "verdanza-firebase-admin-compatibility", storageBucket: "verdanza-test.invalid" },
  "firebase-admin-compatibility",
);
try {
  const realAuth = getAuth(app);
  assert.equal(typeof realAuth.getUserByEmail, "function");
  assert.equal(typeof realAuth.createUser, "function");
  assert.equal(typeof realAuth.updateUser, "function");

  const realBucket = getStorage(app).bucket();
  assert.equal(realBucket.name, "verdanza-test.invalid");
  assert.equal(typeof realBucket.file, "function");
  assert.equal(typeof realBucket.file("products/test/image.webp").delete, "function");
} finally {
  await deleteApp(app);
}

const storageCalls: Array<{ operation: string; value?: unknown }> = [];
const storageResult = await deleteFiles(
  () => ({
    bucket(...args: unknown[]) {
      storageCalls.push({ operation: "bucket", value: args });
      return {
        file(path: string) {
          storageCalls.push({ operation: "file", value: path });
          return {
            async delete(options: StorageDeleteOptions) {
              storageCalls.push({ operation: "delete", value: { path, options } });
              if (path.endsWith("failed.webp")) throw new Error("synthetic storage failure");
            },
          };
        },
      };
    },
  }),
  ["products/test/ok.webp", "products/test/failed.webp"],
);
assert.deepEqual(storageResult, { deleted: 1, failed: ["products/test/failed.webp"] });
assert.deepEqual(storageCalls, [
  { operation: "bucket", value: [] },
  { operation: "file", value: "products/test/ok.webp" },
  {
    operation: "delete",
    value: { path: "products/test/ok.webp", options: { ignoreNotFound: true } },
  },
  { operation: "file", value: "products/test/failed.webp" },
  {
    operation: "delete",
    value: { path: "products/test/failed.webp", options: { ignoreNotFound: true } },
  },
]);

const authCalls: string[] = [];
const missingUserError = Object.assign(new Error("synthetic missing user"), {
  code: "auth/user-not-found",
});
const created = await exerciseAuthAdmin(
  () => ({
    async getUserByEmail(email) {
      authCalls.push(`getUserByEmail:${email}`);
      throw missingUserError;
    },
    async createUser({ email }) {
      authCalls.push(`createUser:${email}`);
      return { uid: "created-user", email };
    },
    async updateUser(uid) {
      authCalls.push(`updateUser:${uid}`);
      return { uid, email: "admin@example.test" };
    },
  }),
  "admin@example.test",
);
assert.equal(created.uid, "created-user");

const updated = await exerciseAuthAdmin(
  () => ({
    async getUserByEmail(email) {
      authCalls.push(`getUserByEmail:${email}`);
      return { uid: "existing-user", email };
    },
    async createUser({ email }) {
      authCalls.push(`createUser:${email}`);
      return { uid: "unexpected-user", email };
    },
    async updateUser(uid) {
      authCalls.push(`updateUser:${uid}`);
      return { uid, email: "admin@example.test" };
    },
  }),
  "admin@example.test",
  "synthetic-password",
);
assert.equal(updated.uid, "existing-user");
assert.deepEqual(authCalls, [
  "getUserByEmail:admin@example.test",
  "createUser:admin@example.test",
  "getUserByEmail:admin@example.test",
  "updateUser:existing-user",
]);

console.info("Firebase Admin identity, Storage and Auth compatibility tests passed without network calls.");

function collectTypeScriptSources(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectTypeScriptSources(path);
      return /\.[cm]?[jt]sx?$/.test(entry.name) ? readFileSync(path, "utf8") : "";
    })
    .join("\n");
}
