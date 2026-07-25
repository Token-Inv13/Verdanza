import { FieldValue } from "firebase-admin/firestore";
import {
  getRequiredAdminDb,
  requireConfirmationFlag,
} from "./_firebaseAdminScript.js";
import {
  formatProductInternalReference,
  parseProductInternalReference,
} from "../src/lib/productReferences.js";

const shouldWrite = process.argv.includes("--yes");
const commandName = "backfill:product-references";

async function main() {
  if (shouldWrite) requireConfirmationFlag(commandName);
  const { db, projectId } = getRequiredAdminDb();
  const snapshot = await db.collection("products").get();
  const products = snapshot.docs
    .map((entry) => ({
      id: entry.id,
      internalReference: String(entry.data().internalReference || "").trim(),
      name: String(entry.data().name || entry.id),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const existingRefs = new Map<string, string>();
  let maxReferenceNumber = 0;
  for (const product of products) {
    if (!product.internalReference) continue;
    if (existingRefs.has(product.internalReference)) {
      throw new Error(
        `Reference dupliquee ${product.internalReference}: ${existingRefs.get(product.internalReference)} et ${product.id}`,
      );
    }
    existingRefs.set(product.internalReference, product.id);
    maxReferenceNumber = Math.max(
      maxReferenceNumber,
      parseProductInternalReference(product.internalReference) || 0,
    );
  }

  const missing = products.filter((product) => !product.internalReference);
  const counterSnapshot = await db.collection("counters").doc("productReferences").get();
  const counterValue = Number(counterSnapshot.data()?.value || 0);
  const start = Math.max(counterValue, maxReferenceNumber);
  const planned = missing.map((product, index) => ({
    ...product,
    assignedReference: formatProductInternalReference(start + index + 1),
  }));

  console.log(`Projet Firebase: ${projectId}`);
  console.log(`Produits lus: ${products.length}`);
  console.log(`References existantes: ${existingRefs.size}`);
  console.log(`References a attribuer: ${planned.length}`);
  planned.forEach((product) => {
    console.log(`${product.id} | ${product.name} | ${product.assignedReference}`);
  });

  if (!shouldWrite) {
    console.log("Dry-run uniquement. Relancer avec --yes pour ecrire.");
    return;
  }

  await db.runTransaction(async (transaction) => {
    const liveCounterRef = db.collection("counters").doc("productReferences");
    const liveCounter = await transaction.get(liveCounterRef);
    let nextNumber = Math.max(Number(liveCounter.data()?.value || 0), maxReferenceNumber);
    const liveProducts = await Promise.all(
      missing.map(async (product) => {
        const ref = db.collection("products").doc(product.id);
        const snapshot = await transaction.get(ref);
        return { product, ref, snapshot };
      }),
    );

    for (const { ref, snapshot } of liveProducts) {
      const liveReference = String(snapshot.data()?.internalReference || "").trim();
      if (liveReference) continue;
      nextNumber += 1;
      transaction.set(
        ref,
        {
          internalReference: formatProductInternalReference(nextNumber),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    transaction.set(
      liveCounterRef,
      {
        value: nextNumber,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  console.log("Backfill termine.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
