import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { FieldValue } from "firebase-admin/firestore";
import { products } from "../src/data/products.js";
import { getRequiredAdminDb } from "./_firebaseAdminScript.js";

const projectIdExpected = "verdanza-1f621";
const confirmation = "verdanza-shop-four-products-20261010";
const productIds = [
  "flower-skittlez-plus",
  "resin-black-afghan",
  "resin-ice-o-lator",
  "resin-mousseux-skywalker",
] as const;
const allowedIds = new Set<string>(productIds);

function fingerprint(documents: FirebaseFirestore.QueryDocumentSnapshot[]) {
  const entries = documents
    .filter((document) => !allowedIds.has(document.id))
    .map((document) => [document.id, document.data()] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (apply && !process.argv.includes(`--confirm=${confirmation}`)) {
    throw new Error(`Application refusée : ajouter --confirm=${confirmation}.`);
  }

  const { db, projectId } = getRequiredAdminDb();
  assert.equal(projectId, projectIdExpected, "Projet Firebase inattendu : aucune écriture autorisée");

  const selected = productIds.map((id) => {
    const product = products.find((entry) => entry.id === id);
    assert.ok(product, `${id} absent de la source catalogue`);
    assert.equal(product.isActive, true, `${id} doit être actif`);
    assert.equal(product.fixedPriceMode, "disabled");
    assert.deepEqual(product.fixedPriceOptions, []);
    assert.ok(product.tags.includes("thcx"));
    assert.equal(product.cbdRate, "Non communiqué");
    assert.equal(product.cbgRate, "Non communiqué");
    assert.equal(product.thcRate, "Non communiqué");
    assert.equal(product.moleculeLabel, "THCX");
    assert.equal(product.cbnRate, undefined);
    return product;
  });
  assert.equal(selected.length, 4);
  assert.equal(new Set(selected.map((product) => product.slug)).size, 4);

  const collection = db.collection("products");
  const before = await collection.get();
  const beforeOtherHash = fingerprint(before.docs);
  const beforeById = new Map(before.docs.map((document) => [document.id, document]));
  const plan = selected.map((product) => {
    const existing = beforeById.get(product.id)?.data();
    const changedFields = existing
      ? Object.entries(product).filter(([key, value]) => !isDeepStrictEqual(existing[key], value)).map(([key]) => key)
      : Object.keys(product);
    return {
      id: product.id,
      action: existing ? (changedFields.length ? "update" : "noop") : "create",
      name: product.name,
      slug: product.slug,
      price: product.price,
      stock: product.stock,
      isActive: product.isActive,
      fixedPriceMode: product.fixedPriceMode,
      fixedPriceOptions: product.fixedPriceOptions,
      changedFields,
    };
  });

  console.log(JSON.stringify({
    mode: apply ? "APPLY" : "DRY_RUN",
    projectId,
    totalProductsBefore: before.size,
    otherProductDocuments: before.docs.filter((document) => !allowedIds.has(document.id)).length,
    otherProductWritesPlanned: 0,
    otherProductsSha256Before: beforeOtherHash,
    plan,
  }, null, 2));

  if (!apply) return;
  const batch = db.batch();
  for (const product of selected) {
    const item = plan.find((entry) => entry.id === product.id);
    if (item?.action === "noop") continue;
    const existing = beforeById.get(product.id)?.data();
    batch.set(collection.doc(product.id), {
      ...product,
      createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  if (plan.some((entry) => entry.action !== "noop")) await batch.commit();

  const after = await collection.get();
  const afterOtherHash = fingerprint(after.docs);
  assert.equal(afterOtherHash, beforeOtherHash, "Un document tiers a changé pendant l'opération");
  for (const product of selected) {
    const actual = after.docs.find((document) => document.id === product.id)?.data();
    assert.ok(actual, `${product.id} absent après l'upsert`);
    for (const [key, value] of Object.entries(product)) {
      assert.ok(isDeepStrictEqual(actual[key], value), `${product.id}.${key} diffère de la source validée`);
    }
  }
  console.log(JSON.stringify({
    result: "PASS",
    verifiedProductIds: productIds,
    otherProductDocuments: after.docs.filter((document) => !allowedIds.has(document.id)).length,
    otherProductsSha256Before: beforeOtherHash,
    otherProductsSha256After: afterOtherHash,
    otherProductChanges: 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
