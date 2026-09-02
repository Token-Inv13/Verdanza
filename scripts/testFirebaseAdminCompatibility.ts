import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";

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
assert.match(invoicesSource, /bucket\.file\(path\)\.delete\(\{ ignoreNotFound: true \}\)/);
assert.match(invoicesSource, /catch \{\s*failed\.push\(path\);/);
assert.match(bootstrapAuthSource, /const auth = getAuth\(\);/);
assert.match(bootstrapAuthSource, /auth\.getUserByEmail\(email\)/);
assert.match(bootstrapAuthSource, /auth\.createUser\(/);
assert.match(bootstrapAuthSource, /auth\.updateUser\(/);

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

console.info("Firebase Admin Storage and Auth compatibility tests passed without network calls.");
