import { randomInt } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  createProductInternalReference,
  PRODUCT_REFERENCE_RANDOM_ALPHABET,
  PRODUCT_REFERENCE_RANDOM_LENGTH,
  productReferenceCategoryCode,
} from "../../src/lib/productReferences.js";

export function generateProductReferenceRandomCode(
  randomIndex: (maxExclusive: number) => number = randomInt,
) {
  let code = "";
  for (let index = 0; index < PRODUCT_REFERENCE_RANDOM_LENGTH; index += 1) {
    code += PRODUCT_REFERENCE_RANDOM_ALPHABET[randomIndex(PRODUCT_REFERENCE_RANDOM_ALPHABET.length)];
  }
  return code;
}

export async function reserveProductInternalReference({
  db,
  transaction,
  productId,
  category,
  maxAttempts = 12,
  randomCodeFactory = generateProductReferenceRandomCode,
}: {
  db: Firestore;
  transaction: Transaction;
  productId: string;
  category: unknown;
  maxAttempts?: number;
  randomCodeFactory?: () => string;
}) {
  const categoryCode = productReferenceCategoryCode(category);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const reference = createProductInternalReference(category, randomCodeFactory());
    const reservationRef = db.collection("productReferences").doc(reference);
    const reservationSnapshot = await transaction.get(reservationRef);
    if (reservationSnapshot.exists) continue;

    transaction.set(reservationRef, {
      reference,
      productId,
      categoryCode,
      createdAt: FieldValue.serverTimestamp(),
    });
    return reference;
  }

  throw new Error(
    `Generation reference produit impossible apres ${maxAttempts} tentative(s).`,
  );
}
