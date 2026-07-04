import { FieldValue } from "firebase-admin/firestore";
import { assertAdminUser } from "./_server/adminAuth.js";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import { products } from "../src/data/products.js";
import type { Product } from "../src/types/index.js";

const confirmationPhrase = "DELETE_TEST_DATA";
const purgeCollections = ["orders", "stockMovements"] as const;

type CleanupBody = {
  confirm?: string;
};

type ProductDocument = Product & {
  createdAt?: unknown;
  updatedAt?: unknown;
};

type OrderDocument = {
  customerId?: string;
};

type CustomerDocument = {
  email?: string;
  displayName?: string;
  phone?: string;
};

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "POST")) return;

  try {
    const idToken = bearerToken(request);
    if (!idToken) {
      sendJson(response, { error: "Token admin requis." }, 401);
      return;
    }

    const body = (request.body ?? {}) as CleanupBody;
    if (body.confirm !== confirmationPhrase) {
      sendJson(response, { error: "Confirmation nettoyage requise." }, 400);
      return;
    }

    const db = getAdminDb();
    await assertAdminUser(db, idToken);

    const localProductIds = new Set(products.map((product) => product.id));
    if (localProductIds.size !== products.length) {
      throw new Error("Nettoyage refuse: IDs produits locaux dupliques.");
    }

    const productSnapshot = await db.collection("products").get();
    const obsoleteProductIds = productSnapshot.docs
      .filter((doc) => !localProductIds.has(doc.id))
      .map((doc) => doc.id);

    const orderSnapshot = await db.collection("orders").get();
    const customerIdsFromOrders = new Set(
      orderSnapshot.docs
        .map((doc) => (doc.data() as OrderDocument).customerId)
        .filter(Boolean) as string[],
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
        purgeCollections.map(async (collectionName) => [
          collectionName,
          await listCollectionIds(db, collectionName),
        ]),
      ),
    ) as Record<(typeof purgeCollections)[number], string[]>;

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

    const [remainingProducts, remainingOrders, remainingStockMovements] =
      await Promise.all([
        db.collection("products").get(),
        db.collection("orders").get(),
        db.collection("stockMovements").get(),
      ]);

    sendJson(response, {
      ok: true,
      deletedOrders,
      deletedStockMovements,
      deletedCustomers,
      deletedProducts,
      updatedProducts,
      remainingProducts: remainingProducts.size,
      remainingOrders: remainingOrders.size,
      remainingStockMovements: remainingStockMovements.size,
    });
  } catch (error) {
    console.error("cleanup-test-data failed", error);
    const message =
      error instanceof Error ? error.message : "Nettoyage donnees test impossible.";
    sendJson(response, { error: message }, message === "Acces admin requis." ? 403 : 400);
  }
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

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as Partial<T>;
}

function bearerToken(request: VercelRequestLike) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length);
}
