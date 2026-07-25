import assert from "node:assert/strict";
import {
  formatProductInternalReference,
  parseProductInternalReference,
  normalizeInternalReference,
} from "../src/lib/productReferences";

assert.equal(formatProductInternalReference(1), "VDZ-000001");
assert.equal(formatProductInternalReference(42), "VDZ-000042");
assert.equal(parseProductInternalReference("VDZ-000042"), 42);
assert.equal(parseProductInternalReference("bad-ref"), null);
assert.equal(normalizeInternalReference(" vdz-000007 "), "VDZ-000007");
assert.throws(() => formatProductInternalReference(0));

const existing = new Set<string>();
const assigned = [1, 2, 3].map(formatProductInternalReference);
assigned.forEach((reference) => {
  assert.equal(existing.has(reference), false);
  existing.add(reference);
});

console.log("Product reference tests passed.");
