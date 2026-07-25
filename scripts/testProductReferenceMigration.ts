import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  expectedProductReferenceMigrations,
  PRODUCT_REFERENCE_MIGRATION_PROJECT_ID,
  runProductReferenceMigration,
} from "./migrateProductReferencesV2";
import {
  isProductInternalReference,
  PRODUCT_REFERENCE_CONFIRMATION,
} from "../src/lib/productReferences";

type FakeDocument = Record<string, unknown>;

function buildProductDocuments(overrides: Record<string, Partial<FakeDocument>> = {}) {
  const docs = new Map<string, FakeDocument>();
  for (const entry of expectedProductReferenceMigrations) {
    docs.set(entry.productId, {
      name: entry.productName,
      category: entry.category,
      internalReference: entry.oldReference || "",
      legacyInternalReferences: [],
      price: 1,
      stock: 1,
      slug: entry.productId,
    });
  }
  for (const [id, override] of Object.entries(overrides)) {
    const existing = docs.get(id);
    if (!existing) continue;
    docs.set(id, { ...existing, ...override });
  }
  return docs;
}

function fakeDb(
  products: Map<string, FakeDocument>,
  reservations = new Map<string, FakeDocument>(),
) {
  const writes: Array<{ collection: string; id: string; data: FakeDocument }> = [];
  const makeRef = (collectionName: string, id: string) => ({ collectionName, id });
  const snapshot = (collectionName: string, id: string) => {
    const source = collectionName === "products" ? products : reservations;
    const data = source.get(id);
    return {
      id,
      exists: Boolean(data),
      data: () => data,
    };
  };

  return {
    writes,
    collection(collectionName: string) {
      return {
        doc(id: string) {
          return {
            ...makeRef(collectionName, id),
            async get() {
              return snapshot(collectionName, id);
            },
          };
        },
        async get() {
          const source = collectionName === "products" ? products : reservations;
          return {
            docs: [...source.entries()].map(([id, data]) => ({
              id,
              data: () => data,
            })),
          };
        },
      };
    },
    async runTransaction(callback: (transaction: {
      get: (ref: { collectionName: string; id: string }) => Promise<ReturnType<typeof snapshot>>;
      set: (
        ref: { collectionName: string; id: string },
        data: FakeDocument,
        options?: { merge: boolean },
      ) => void;
    }) => Promise<void>) {
      const transaction = {
        async get(ref: { collectionName: string; id: string }) {
          return snapshot(ref.collectionName, ref.id);
        },
        set(
          ref: { collectionName: string; id: string },
          data: FakeDocument,
          options?: { merge: boolean },
        ) {
          writes.push({ collection: ref.collectionName, id: ref.id, data });
          const source = ref.collectionName === "products" ? products : reservations;
          source.set(ref.id, options?.merge ? { ...(source.get(ref.id) || {}), ...data } : data);
        },
      };
      await callback(transaction);
    },
  };
}

async function withTempPlan<T>(callback: (planPath: string) => Promise<T>) {
  const dir = await mkdtemp(path.join(tmpdir(), "verdanza-product-reference-test-"));
  try {
    return await callback(path.join(dir, "plan.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await withTempPlan(async (planPath) => {
  const db = fakeDb(buildProductDocuments());
  const result = await runProductReferenceMigration({
    db: db as never,
    projectId: PRODUCT_REFERENCE_MIGRATION_PROJECT_ID,
    apply: false,
    planPath,
  });

  assert.equal(result.summary.toUpdate, 15);
  assert.equal(result.summary.alreadyCompliant, 0);
  assert.equal(result.summary.missing, 0);
  assert.equal(result.summary.blocked, 0);
  assert.equal(result.summary.written, 0);
  assert.equal(db.writes.length, 0);

  const references = new Set(result.entries.map((entry) => entry.newReference));
  assert.equal(references.size, 15);
  assert.equal(result.entries.some((entry) => entry.newReference === "VDZ-000015"), false);
  for (const entry of result.entries) {
    assert.equal(isProductInternalReference(entry.newReference), true);
    if (entry.oldReference) {
      assert.equal(entry.legacyInternalReferencesAfter.includes(entry.oldReference), true);
    } else {
      assert.deepEqual(entry.legacyInternalReferencesAfter, []);
      assert.match(entry.newReference, /^VDZ-RES-/);
    }
  }

  const second = await runProductReferenceMigration({
    db: db as never,
    projectId: PRODUCT_REFERENCE_MIGRATION_PROJECT_ID,
    apply: false,
    planPath,
  });
  assert.deepEqual(
    second.entries.map((entry) => entry.newReference),
    result.entries.map((entry) => entry.newReference),
  );

  await assert.rejects(
    () =>
      runProductReferenceMigration({
        db: db as never,
        projectId: "wrong-project",
        apply: false,
        planPath,
      }),
    /Projet Firebase refuse/,
  );

  await assert.rejects(
    () =>
      runProductReferenceMigration({
        db: db as never,
        projectId: PRODUCT_REFERENCE_MIGRATION_PROJECT_ID,
        apply: true,
        confirm: "bad",
        planPath,
      }),
    /Ecriture refusee/,
  );

  const applyResult = await runProductReferenceMigration({
    db: db as never,
    projectId: PRODUCT_REFERENCE_MIGRATION_PROJECT_ID,
    apply: true,
    confirm: PRODUCT_REFERENCE_CONFIRMATION,
    planPath,
  });
  assert.equal(applyResult.summary.written, 15);
  assert.equal(db.writes.filter((write) => write.collection === "productReferences").length, 15);
  assert.equal(db.writes.filter((write) => write.collection === "products").length, 15);

  const compliant = await runProductReferenceMigration({
    db: db as never,
    projectId: PRODUCT_REFERENCE_MIGRATION_PROJECT_ID,
    apply: false,
    planPath,
  });
  assert.equal(compliant.summary.toUpdate, 0);
  assert.equal(compliant.summary.alreadyCompliant, 15);
});

await withTempPlan(async (planPath) => {
  const products = buildProductDocuments({
    "flower-amnesia-cbd-hydroponique": { internalReference: "VDZ-000999" },
  });
  const result = await runProductReferenceMigration({
    db: fakeDb(products) as never,
    projectId: PRODUCT_REFERENCE_MIGRATION_PROJECT_ID,
    apply: false,
    planPath,
  });
  assert.equal(result.summary.blocked, 1);
  assert.match(result.entries[0].reasons.join(" "), /Ancienne reference inattendue/);
});

await withTempPlan(async (planPath) => {
  const products = buildProductDocuments();
  products.delete("resin-supreme-50-cbd");
  await assert.rejects(
    () =>
      runProductReferenceMigration({
        db: fakeDb(products) as never,
        projectId: PRODUCT_REFERENCE_MIGRATION_PROJECT_ID,
        apply: false,
        planPath,
      }),
    /Inventaire produits refuse/,
  );
});

await withTempPlan(async (planPath) => {
  const products = buildProductDocuments();
  const db = fakeDb(products);
  const result = await runProductReferenceMigration({
    db: db as never,
    projectId: PRODUCT_REFERENCE_MIGRATION_PROJECT_ID,
    apply: false,
    planPath,
  });
  const conflicting = new Map<string, FakeDocument>([
    [result.entries[0].newReference, { productId: "other-product" }],
  ]);
  const blocked = await runProductReferenceMigration({
    db: fakeDb(products, conflicting) as never,
    projectId: PRODUCT_REFERENCE_MIGRATION_PROJECT_ID,
    apply: false,
    planPath,
  });
  assert.equal(blocked.summary.blocked, 1);
  assert.match(blocked.entries[0].reasons.join(" "), /Reservation en conflit/);
});

console.log("Product reference migration tests passed.");
