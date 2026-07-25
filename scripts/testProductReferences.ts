import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createProductInternalReference,
  formatProductInternalReference,
  isLegacyProductInternalReference,
  isProductInternalReference,
  normalizeInternalReference,
  normalizeLegacyInternalReferences,
  parseProductInternalReference,
  parseProductReference,
  productReferenceCategoryCode,
  PRODUCT_REFERENCE_RANDOM_ALPHABET,
  PRODUCT_REFERENCE_REGEX,
  withLegacyInternalReference,
} from "../src/lib/productReferences";
import {
  generateProductReferenceRandomCode,
  reserveProductInternalReference,
} from "../api/_server/productReferences";

assert.equal(formatProductInternalReference(1), "VDZ-000001");
assert.equal(formatProductInternalReference(42), "VDZ-000042");
assert.equal(parseProductInternalReference("VDZ-000042"), 42);
assert.equal(parseProductInternalReference("bad-ref"), null);
assert.equal(normalizeInternalReference(" vdz-res-km7qf2 "), "VDZ-RES-KM7QF2");
assert.throws(() => formatProductInternalReference(0));

assert.equal(productReferenceCategoryCode("flowers"), "FLR");
assert.equal(productReferenceCategoryCode("resins"), "RES");
assert.equal(productReferenceCategoryCode("oils"), "HUI");
assert.equal(productReferenceCategoryCode("packs"), "PCK");
assert.equal(productReferenceCategoryCode("unknown"), "AUT");

assert.equal(createProductInternalReference("flowers", "H8N4WX"), "VDZ-FLR-H8N4WX");
assert.equal(createProductInternalReference("resins", "KM7QF2"), "VDZ-RES-KM7QF2");
assert.equal(createProductInternalReference("oils", "R6TP9K"), "VDZ-HUI-R6TP9K");
assert.equal(createProductInternalReference("packs", "X4TW7M"), "VDZ-PCK-X4TW7M");
assert.equal(createProductInternalReference("other", "ABCDEF"), "VDZ-AUT-ABCDEF");
assert.throws(() => createProductInternalReference("flowers", "ABCDEF0"));
assert.throws(() => createProductInternalReference("flowers", "ABCDEI"));
assert.throws(() => createProductInternalReference("flowers", "ABCDEO"));
assert.throws(() => createProductInternalReference("flowers", "ABCDE1"));

for (const reference of [
  "VDZ-RES-KM7QF2",
  "VDZ-FLR-H8N4WX",
  "VDZ-HUI-R6TP9K",
  "VDZ-PCK-X4TW7M",
  "VDZ-AUT-ABCDEF",
]) {
  assert.match(reference, PRODUCT_REFERENCE_REGEX);
  assert.equal(isProductInternalReference(reference), true);
}
assert.equal(isProductInternalReference("VDZ-000015"), false);
assert.equal(isLegacyProductInternalReference("VDZ-000014"), true);
assert.deepEqual(parseProductReference("VDZ-RES-KM7QF2"), {
  categoryCode: "RES",
  randomCode: "KM7QF2",
});

const generated = generateProductReferenceRandomCode(() => 0);
assert.equal(generated, "AAAAAA");
assert.equal(generated.length, 6);
for (const character of generated) {
  assert.equal(PRODUCT_REFERENCE_RANDOM_ALPHABET.includes(character), true);
}
const serverSource = readFileSync("api/_server/productReferences.ts", "utf8");
assert.match(serverSource, /from "node:crypto"/);
assert.match(serverSource, /randomInt/);

const reservations = new Set<string>(["VDZ-RES-AAAAAA"]);
const writes: Array<{ id: string; data: Record<string, unknown> }> = [];
const db = {
  collection: (name: string) => ({
    doc: (id: string) => ({ id, path: `${name}/${id}` }),
  }),
};
const transaction = {
  async get(ref: { id: string }) {
    return { exists: reservations.has(ref.id), data: () => ({ productId: "other" }) };
  },
  set(ref: { id: string }, data: Record<string, unknown>) {
    writes.push({ id: ref.id, data });
    reservations.add(ref.id);
  },
};
const sequence = ["AAAAAA", "BBBBBB"];
const reserved = await reserveProductInternalReference({
  db: db as never,
  transaction: transaction as never,
  productId: "resin-test",
  category: "resins",
  randomCodeFactory: () => sequence.shift() || "CCCCCC",
});
assert.equal(reserved, "VDZ-RES-BBBBBB");
assert.equal(writes.length, 1);
assert.equal(writes[0].id, "VDZ-RES-BBBBBB");
assert.equal(writes[0].data.productId, "resin-test");
assert.equal(writes[0].data.categoryCode, "RES");

await assert.rejects(
  () =>
    reserveProductInternalReference({
      db: db as never,
      transaction: transaction as never,
      productId: "resin-test",
      category: "resins",
      maxAttempts: 1,
      randomCodeFactory: () => "AAAAAA",
    }),
  /Generation reference produit impossible/,
);

assert.deepEqual(
  normalizeLegacyInternalReferences([" vdz-000001 ", "VDZ-000001", "bad", "VDZ-000002"]),
  ["VDZ-000001", "VDZ-000002"],
);
assert.deepEqual(withLegacyInternalReference(["VDZ-000001"], "VDZ-000001"), ["VDZ-000001"]);
assert.deepEqual(withLegacyInternalReference(["VDZ-000001"], "VDZ-000003"), [
  "VDZ-000001",
  "VDZ-000003",
]);

const apiSource = readFileSync("api/invoices.ts", "utf8");
assert.match(apiSource, /delete \(payload as Record<string, unknown>\)\.internalReference/);
assert.match(apiSource, /delete \(payload as Record<string, unknown>\)\.legacyInternalReferences/);
assert.match(apiSource, /reserveProductInternalReference/);
assert.doesNotMatch(apiSource, /counters"\)\.doc\("productReferences"\)/);
assert.match(apiSource, /if \(!snapshot\.exists\) \{\s+update\.createdAt/s);

const serviceSource = readFileSync("src/services/productsService.ts", "utf8");
assert.match(serviceSource, /Session admin requise/);
assert.doesNotMatch(serviceSource, /setDoc\(productRef/);

console.log("Product reference tests passed.");
