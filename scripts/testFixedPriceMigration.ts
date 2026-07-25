import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FIXED_PRICE_MIGRATION_CONFIRMATION,
  FIXED_PRICE_MIGRATION_PROJECT_ID,
  analyzeFixedPriceMigrationDocument,
  buildFixedPriceMigrationPayload,
  fixedPriceFormatMigrations,
  runFixedPriceMigration,
  validateProposedConfiguration,
} from "./migrateFixedPriceFormats.js";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [];
let backupDir = "";

function test(name: string, run: TestCase["run"]) {
  tests.push({ name, run });
}

test("dry-run reads documents and never writes", async () => {
  const writes: string[] = [];
  const result = await runFixedPriceMigration({
    db: fakeDb(allDocuments("legacy"), writes),
    projectId: FIXED_PRICE_MIGRATION_PROJECT_ID,
    apply: false,
    backupDir,
    now: new Date("2026-07-25T10:00:00.000Z"),
  });
  assert.equal(result.summary.written, 0);
  assert.equal(writes.length, 0);
  assert.equal(result.summary.toUpdate, fixedPriceFormatMigrations.length);
});

test("bad projectId is rejected before reading or writing", async () => {
  let readCount = 0;
  await assert.rejects(
    () =>
      runFixedPriceMigration({
        db: {
          collection: () => ({
            doc: () => ({
              get: async () => {
                readCount += 1;
                return { exists: false, id: "x", data: () => undefined };
              },
            }),
          }),
        },
        projectId: "wrong-project",
        apply: false,
        backupDir,
      }),
    /Projet Firebase refuse/,
  );
  assert.equal(readCount, 0);
});

test("missing document is classified and blocks apply", async () => {
  const first = fixedPriceFormatMigrations[0];
  const analysis = analyzeFixedPriceMigrationDocument(first, {
    id: first.id,
    exists: false,
  });
  assert.equal(analysis.status, "missing");
  assert.equal(analysis.payload, null);

  await assert.rejects(
    () =>
      runFixedPriceMigration({
        db: fakeDb({ ...allDocuments("legacy"), [first.id]: undefined }, []),
        projectId: FIXED_PRICE_MIGRATION_PROJECT_ID,
        apply: true,
        confirm: FIXED_PRICE_MIGRATION_CONFIRMATION,
        backupDir,
      }),
    /absent\(s\) ou bloque\(s\)/,
  );
});

test("unexpected price blocks migration", () => {
  const first = fixedPriceFormatMigrations[0];
  const analysis = analyzeFixedPriceMigrationDocument(first, {
    id: first.id,
    exists: true,
    data: { price: first.expectedPrice + 1, category: first.expectedCategory },
  });
  assert.equal(analysis.status, "blocked");
  assert.match(analysis.reasons.join(" "), /Prix inattendu/);
});

test("unexpected category blocks migration", () => {
  const first = fixedPriceFormatMigrations[0];
  const analysis = analyzeFixedPriceMigrationDocument(first, {
    id: first.id,
    exists: true,
    data: { price: first.expectedPrice, category: "flowers" },
  });
  assert.equal(analysis.status, "blocked");
  assert.match(analysis.reasons.join(" "), /Categorie inattendue/);
});

test("already compliant document is idempotent", () => {
  const first = fixedPriceFormatMigrations[0];
  const payload = buildFixedPriceMigrationPayload(first);
  const analysis = analyzeFixedPriceMigrationDocument(first, {
    id: first.id,
    exists: true,
    data: {
      price: first.expectedPrice,
      category: first.expectedCategory,
      ...payload,
    },
  });
  assert.equal(analysis.status, "already_compliant");
  assert.equal(analysis.payload, null);
});

test("legacy document needing migration gets targeted payload only", () => {
  const first = fixedPriceFormatMigrations[0];
  const analysis = analyzeFixedPriceMigrationDocument(first, {
    id: first.id,
    exists: true,
    data: {
      price: first.expectedPrice,
      category: first.expectedCategory,
      name: "Preserved",
      stock: 22,
    },
  });
  assert.equal(analysis.status, "to_update");
  assert.deepEqual(Object.keys(analysis.payload || {}).sort(), [
    "fixedPriceMode",
    "fixedPriceOptions",
  ]);
});

test("all 13 configurations are commercially valid", () => {
  assert.equal(fixedPriceFormatMigrations.length, 13);
  for (const migration of fixedPriceFormatMigrations) {
    assert.deepEqual(validateProposedConfiguration(migration), [], migration.id);
  }
});

test("Supreme Purple is disabled with an empty payload option list", () => {
  const migration = fixedPriceFormatMigrations.find((entry) => entry.id === "resin-supreme-purple-cbd");
  assert.ok(migration);
  assert.equal(migration.fixedPriceMode, "disabled");
  assert.deepEqual(buildFixedPriceMigrationPayload(migration).fixedPriceOptions, []);
});

test("apply requires explicit confirmation", async () => {
  await assert.rejects(
    () =>
      runFixedPriceMigration({
        db: fakeDb(allDocuments("legacy"), []),
        projectId: FIXED_PRICE_MIGRATION_PROJECT_ID,
        apply: true,
        backupDir,
      }),
    /Ecriture refusee sans --confirm/,
  );
});

test("apply writes only documents needing migration", async () => {
  const writes: string[] = [];
  const result = await runFixedPriceMigration({
    db: fakeDb(allDocuments("compliant"), writes),
    projectId: FIXED_PRICE_MIGRATION_PROJECT_ID,
    apply: true,
    confirm: FIXED_PRICE_MIGRATION_CONFIRMATION,
    backupDir,
  });
  assert.equal(result.summary.toUpdate, 0);
  assert.equal(writes.length, 0);

  const mixed = allDocuments("compliant");
  const first = fixedPriceFormatMigrations[0];
  mixed[first.id] = { price: first.expectedPrice, category: first.expectedCategory };
  const mixedWrites: string[] = [];
  const mixedResult = await runFixedPriceMigration({
    db: fakeDb(mixed, mixedWrites),
    projectId: FIXED_PRICE_MIGRATION_PROJECT_ID,
    apply: true,
    confirm: FIXED_PRICE_MIGRATION_CONFIRMATION,
    backupDir,
  });
  assert.equal(mixedResult.summary.toUpdate, 1);
  assert.deepEqual(mixedWrites, [first.id]);
});

function allDocuments(mode: "legacy" | "compliant") {
  const docs: Record<string, Record<string, unknown> | undefined> = {};
  for (const migration of fixedPriceFormatMigrations) {
    docs[migration.id] = {
      price: migration.expectedPrice,
      category: migration.expectedCategory,
      ...(mode === "compliant" ? buildFixedPriceMigrationPayload(migration) : {}),
    };
  }
  return docs;
}

function fakeDb(docs: Record<string, Record<string, unknown> | undefined>, writes: string[]) {
  return {
    collection: (collectionName: string) => {
      assert.equal(collectionName, "products");
      return {
        doc: (id: string) => ({
          get: async () => {
            const data = docs[id];
            return {
              exists: Boolean(data),
              id,
              data: () => data,
            };
          },
          update: async (payload: { fixedPriceMode: unknown; fixedPriceOptions: unknown }) => {
            assert.deepEqual(Object.keys(payload).sort(), [
              "fixedPriceMode",
              "fixedPriceOptions",
            ]);
            writes.push(id);
            docs[id] = { ...(docs[id] || {}), ...payload };
          },
        }),
      };
    },
  };
}

backupDir = await mkdtemp(path.join(tmpdir(), "verdanza-fixed-price-migration-"));
try {
  for (const entry of tests) {
    await entry.run();
    console.log(`OK ${entry.name}`);
  }
  console.log(`Fixed price migration tests passed: ${tests.length}`);
} finally {
  await rm(backupDir, { recursive: true, force: true });
}
