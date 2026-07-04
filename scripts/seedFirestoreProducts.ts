import { FieldValue } from "firebase-admin/firestore";
import { products } from "../src/data/products.js";
import type { Product } from "../src/types/index.js";
import {
  getRequiredAdminDb,
  requireConfirmationFlag,
} from "./_firebaseAdminScript.js";

type ProductDocument = Product & {
  createdAt?: unknown;
  updatedAt?: unknown;
};

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as Partial<T>;
}

function buildProductPayload(product: Product, existing?: ProductDocument) {
  const existingStock = Number(existing?.stock);
  const stock = Number.isFinite(existingStock) ? existingStock : product.stock;

  return withoutUndefined({
    ...product,
    stock,
    lowStockThreshold: product.lowStockThreshold ?? 5,
    createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function setDoc(
  reference: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData,
  options: FirebaseFirestore.SetOptions,
) {
  await reference.set(data, options);
}

async function main() {
  requireConfirmationFlag("seed:products");

  const { db, projectId } = getRequiredAdminDb();
  const uniqueIds = new Set(products.map((product) => product.id));

  if (uniqueIds.size !== products.length) {
    throw new Error("Seed refuse: IDs produits dupliques dans src/data/products.ts.");
  }

  console.log(`Projet Firebase cible: ${projectId}`);
  console.log(`Produits a seeder: ${products.length}`);

  let created = 0;
  let updated = 0;
  let preservedStock = 0;
  let deactivatedMissing = 0;

  for (const product of products) {
    const productRef = db.collection("products").doc(product.id);
    const snapshot = await productRef.get();
    const existing = snapshot.exists
      ? ({ id: snapshot.id, ...snapshot.data() } as ProductDocument)
      : undefined;

    const payload = buildProductPayload(product, existing);
    if (existing && Number.isFinite(Number(existing.stock))) preservedStock += 1;

    await setDoc(productRef, payload, { merge: true });
    if (snapshot.exists) updated += 1;
    else created += 1;
  }

  const allProductsSnapshot = await db.collection("products").get();
  const batch = db.batch();
  for (const entry of allProductsSnapshot.docs) {
    if (uniqueIds.has(entry.id)) continue;
    const data = entry.data() as Partial<ProductDocument>;
    if (data.isActive === false && data.isFeatured === false) continue;
    batch.set(
      entry.ref,
      {
        isActive: false,
        isFeatured: false,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    deactivatedMissing += 1;
  }
  if (deactivatedMissing) await batch.commit();

  const verification = await Promise.all(
    products.map(async (product) => {
      const snapshot = await db.collection("products").doc(product.id).get();
      const data = snapshot.data() as ProductDocument | undefined;
      return {
        id: product.id,
        exists: snapshot.exists,
        slug: data?.slug,
        isActive: data?.isActive,
        stock: data?.stock,
      };
    }),
  );

  const invalid = verification.filter(
    (entry) =>
      !entry.exists ||
      !entry.slug ||
      entry.isActive !== true ||
      !Number.isFinite(Number(entry.stock)),
  );

  if (invalid.length) {
    console.error("Verification produits echouee:", invalid);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        created,
        updated,
        preservedStock,
        deactivatedMissing,
        verifiedActiveProducts: verification.length,
        productIds: verification.map((entry) => entry.id),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
