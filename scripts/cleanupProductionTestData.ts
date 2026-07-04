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

type OrderDocument = {
  customerId?: string;
  customerEmail?: string;
  customerName?: string;
};

type CustomerDocument = {
  email?: string;
  displayName?: string;
  phone?: string;
};

const collectionsToPurge = ["orders", "stockMovements"] as const;

function isExecutionMode() {
  return process.argv.includes("--yes");
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as Partial<T>;
}

function buildCleanProductPayload(product: Product, existing?: ProductDocument) {
  const existingStock = Number(existing?.stock);
  const stock = Number.isFinite(existingStock) ? Math.max(0, existingStock) : 0;

  return withoutUndefined({
    ...product,
    stock,
    isActive: stock > 0 && product.isActive,
    isFeatured: stock > 0 && product.isFeatured,
    lowStockThreshold: product.lowStockThreshold ?? 5,
    createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

function isObviousTestCustomer(customer: CustomerDocument) {
  const value = [
    customer.email,
    customer.displayName,
    customer.phone,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return [
    "test",
    "phase",
    "example.com",
    "token.invest13",
    "0600000000",
    "0606060606",
    "0611223344",
  ].some((marker) => value.includes(marker));
}

async function listCollectionIds(
  db: FirebaseFirestore.Firestore,
  collectionName: string,
) {
  const snapshot = await db.collection(collectionName).get();
  return snapshot.docs.map((doc) => doc.id);
}

async function deleteDocuments(
  db: FirebaseFirestore.Firestore,
  collectionName: string,
  documentIds: string[],
) {
  let deleted = 0;
  for (let index = 0; index < documentIds.length; index += 400) {
    const batch = db.batch();
    for (const documentId of documentIds.slice(index, index + 400)) {
      batch.delete(db.collection(collectionName).doc(documentId));
      deleted += 1;
    }
    await batch.commit();
  }
  return deleted;
}

async function main() {
  const shouldExecute = isExecutionMode();
  if (shouldExecute) requireConfirmationFlag("cleanup:test-data");

  const { db, projectId } = getRequiredAdminDb();
  const localProductIds = new Set(products.map((product) => product.id));

  if (localProductIds.size !== products.length) {
    throw new Error("Nettoyage refuse: IDs produits locaux dupliques.");
  }

  const productSnapshot = await db.collection("products").get();
  const productDocs = productSnapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as ProductDocument,
  }));
  const obsoleteProductIds = productDocs
    .filter((doc) => !localProductIds.has(doc.id))
    .map((doc) => doc.id);

  const orderSnapshot = await db.collection("orders").get();
  const orderDocs = orderSnapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as OrderDocument,
  }));
  const customerIdsFromOrders = new Set(
    orderDocs.map((doc) => doc.data.customerId).filter(Boolean) as string[],
  );

  const customerSnapshot = await db.collection("customers").get();
  const customerIdsToDelete = customerSnapshot.docs
    .filter(
      (doc) =>
        customerIdsFromOrders.has(doc.id) ||
        isObviousTestCustomer(doc.data() as CustomerDocument),
    )
    .map((doc) => doc.id);

  const collectionIds = Object.fromEntries(
    await Promise.all(
      collectionsToPurge.map(async (collectionName) => [
        collectionName,
        await listCollectionIds(db, collectionName),
      ]),
    ),
  ) as Record<(typeof collectionsToPurge)[number], string[]>;

  const planned = {
    mode: shouldExecute ? "execute" : "dry-run",
    projectId,
    ordersToDelete: collectionIds.orders.length,
    stockMovementsToDelete: collectionIds.stockMovements.length,
    customersToDelete: customerIdsToDelete.length,
    obsoleteProductsToDelete: obsoleteProductIds.length,
    localProductsToKeep: products.length,
    keptProductIds: products.map((product) => product.id),
    obsoleteProductIds,
  };

  console.log(JSON.stringify(planned, null, 2));

  if (!shouldExecute) {
    console.log("Aucune donnee modifiee. Relancer avec: npm run cleanup:test-data -- --yes");
    return;
  }

  const deletedOrders = await deleteDocuments(db, "orders", collectionIds.orders);
  const deletedStockMovements = await deleteDocuments(
    db,
    "stockMovements",
    collectionIds.stockMovements,
  );
  const deletedCustomers = await deleteDocuments(db, "customers", customerIdsToDelete);
  const deletedProducts = await deleteDocuments(db, "products", obsoleteProductIds);

  let updatedProducts = 0;
  for (const product of products) {
    const productRef = db.collection("products").doc(product.id);
    const snapshot = await productRef.get();
    const existing = snapshot.exists
      ? ({ id: snapshot.id, ...snapshot.data() } as ProductDocument)
      : undefined;

    await productRef.set(buildCleanProductPayload(product, existing), { merge: true });
    updatedProducts += 1;
  }

  const verificationProducts = await db.collection("products").get();
  const verificationOrders = await db.collection("orders").get();
  const verificationStockMovements = await db.collection("stockMovements").get();

  console.log(
    JSON.stringify(
      {
        deletedOrders,
        deletedStockMovements,
        deletedCustomers,
        deletedProducts,
        updatedProducts,
        remainingProducts: verificationProducts.size,
        remainingOrders: verificationOrders.size,
        remainingStockMovements: verificationStockMovements.size,
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
