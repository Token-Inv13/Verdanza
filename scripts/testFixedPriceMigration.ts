import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertNoUndefinedDeep,
  resolveFixedPriceOptions,
  serializeFixedPriceOptionsForFirestore,
  serializeFixedPriceOptionsForMode,
} from "../src/lib/fixedPriceOptions.js";
import type { FixedPriceOption, Product } from "../src/types/index.js";
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
  assertNoUndefinedDeep(analysis.payload);
});

test("all 13 configurations are commercially valid", () => {
  assert.equal(fixedPriceFormatMigrations.length, 13);
  for (const migration of fixedPriceFormatMigrations) {
    assert.deepEqual(validateProposedConfiguration(migration), [], migration.id);
  }
});

test("manual option without label omits label and undefined values", () => {
  const input = [
    { id: "fixed-30-8g", totalPrice: 30, quantityGrams: 8, isActive: true, sortOrder: 1, source: "manual" },
  ];
  const [serialized] = serializeFixedPriceOptionsForFirestore(input);
  assert.ok(serialized);
  assert.equal(Object.prototype.hasOwnProperty.call(serialized, "label"), false);
  assertNoUndefinedDeep(serialized);
});

test("valid label is preserved and empty label is omitted", () => {
  const serialized = serializeFixedPriceOptionsForFirestore([
    { id: "fixed-label", label: "  Duo  ", totalPrice: 30, quantityGrams: 8, isActive: true, sortOrder: 1, source: "manual" },
    { id: "fixed-empty-label", label: "   ", totalPrice: 40, quantityGrams: 11, isActive: true, sortOrder: 2, source: "manual" },
  ]);
  assert.equal(serialized[0]?.label, "Duo");
  assert.equal(Object.prototype.hasOwnProperty.call(serialized[1], "label"), false);
  assertNoUndefinedDeep(serialized);
});

test("multiple options and automatic options serialize without undefined", () => {
  const automaticProduct = product({
    fixedPriceMode: "automatic",
    fixedPriceOptions: undefined,
    price: 6,
  });
  const automaticOptions = resolveFixedPriceOptions(automaticProduct);
  assert.ok(automaticOptions.length > 0);
  const serializedAutomatic = serializeFixedPriceOptionsForFirestore(automaticOptions);
  assert.ok(serializedAutomatic.some((option) => option.source === "automatic"));
  assertNoUndefinedDeep(serializedAutomatic);
});

test("Supreme Purple is disabled with an empty payload option list", () => {
  const migration = fixedPriceFormatMigrations.find((entry) => entry.id === "resin-supreme-purple-cbd");
  assert.ok(migration);
  assert.equal(migration.fixedPriceMode, "disabled");
  assert.deepEqual(buildFixedPriceMigrationPayload(migration).fixedPriceOptions, []);
  assert.deepEqual(serializeFixedPriceOptionsForMode("disabled", migration.fixedPriceOptions), []);
});

test("admin manual save uses the shared Firestore serialization", () => {
  const manualOptions: FixedPriceOption[] = [
    { id: "admin-30-8g", label: undefined, totalPrice: 30, quantityGrams: 8, isActive: true, sortOrder: 1, source: "manual" },
  ];
  const adminPayload = {
    fixedPriceMode: "manual" as const,
    fixedPriceOptions: serializeFixedPriceOptionsForMode("manual", manualOptions),
  };
  assert.deepEqual(adminPayload.fixedPriceOptions, serializeFixedPriceOptionsForFirestore(manualOptions));
  assert.equal(Object.prototype.hasOwnProperty.call(adminPayload.fixedPriceOptions[0], "label"), false);
  assertNoUndefinedDeep(adminPayload);
});

test("recursive assertion reports the exact undefined path", () => {
  assert.throws(
    () => assertNoUndefinedDeep({ fixedPriceOptions: [{ label: undefined }] }),
    /payload\.fixedPriceOptions\.0\.label/,
  );
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

test("apply with legacy documents prepares 13 sanitized update payloads", async () => {
  const writes: string[] = [];
  const result = await runFixedPriceMigration({
    db: fakeDb(allDocuments("legacy"), writes),
    projectId: FIXED_PRICE_MIGRATION_PROJECT_ID,
    apply: true,
    confirm: FIXED_PRICE_MIGRATION_CONFIRMATION,
    backupDir,
  });
  assert.equal(result.summary.toUpdate, fixedPriceFormatMigrations.length);
  assert.equal(result.summary.written, fixedPriceFormatMigrations.length);
  assert.equal(writes.length, fixedPriceFormatMigrations.length);
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

test("serialization is idempotent and does not mutate source objects", () => {
  const source: FixedPriceOption[] = [
    { id: "copy-30-8g", label: "Format", totalPrice: 30, quantityGrams: 8, isActive: true, sortOrder: 1, source: "manual" },
  ];
  const sourceBefore = structuredClone(source);
  const first = serializeFixedPriceOptionsForFirestore(source);
  const second = serializeFixedPriceOptionsForFirestore(first);
  assert.deepEqual(first, second);
  assert.deepEqual(source, sourceBefore);
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
            assertNoUndefinedDeep(payload);
            writes.push(id);
            docs[id] = { ...(docs[id] || {}), ...payload };
          },
        }),
      };
    },
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "resin-fixed",
    slug: "resin-fixed",
    name: "Resine fixe",
    category: "resins",
    price: 6,
    shortDescription: "",
    longDescription: "",
    image: "",
    cbdRate: "",
    cbgRate: "",
    thcRate: "",
    origin: "",
    cultureType: "Autre",
    aromas: [],
    tags: [],
    stock: 100,
    lowStockThreshold: 0,
    isActive: true,
    isFeatured: false,
    seoTitle: "",
    seoDescription: "",
    ...overrides,
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
