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
import { deliveryZones } from "../src/data/deliveryZones.js";
import type { Product } from "../src/types/index.js";

type ProductDocument = Product & {
  createdAt?: unknown;
  updatedAt?: unknown;
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

    const db = getAdminDb();
    await assertAdminUser(db, idToken);

    const productResult = await seedProducts(db);
    const deliveryResult = await seedDeliveryZones(db);

    sendJson(response, {
      ok: true,
      products: productResult,
      deliveryZones: deliveryResult,
    });
  } catch (error) {
    console.error("seed-launch-data failed", error);
    const message =
      error instanceof Error ? error.message : "Seed lancement impossible.";
    sendJson(response, { error: message }, message === "Acces admin requis." ? 403 : 400);
  }
}

async function seedProducts(db: FirebaseFirestore.Firestore) {
  const localIds = new Set(products.map((product) => product.id));
  if (localIds.size !== products.length) {
    throw new Error("Seed refuse: IDs produits dupliques.");
  }

  let created = 0;
  let updated = 0;
  let preservedStock = 0;

  for (const product of products) {
    const productRef = db.collection("products").doc(product.id);
    const snapshot = await productRef.get();
    const existing = snapshot.exists
      ? ({ id: snapshot.id, ...snapshot.data() } as ProductDocument)
      : undefined;
    const existingStock = Number(existing?.stock);
    const stock = Number.isFinite(existingStock) ? existingStock : product.stock;

    await productRef.set(
      withoutUndefined({
        ...product,
        stock,
        lowStockThreshold: product.lowStockThreshold ?? 5,
        createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      { merge: true },
    );

    if (existing && Number.isFinite(existingStock)) preservedStock += 1;
    if (snapshot.exists) updated += 1;
    else created += 1;
  }

  const snapshot = await db.collection("products").get();
  const batch = db.batch();
  let deactivated = 0;
  snapshot.docs.forEach((entry) => {
    if (localIds.has(entry.id)) return;
    const data = entry.data();
    if (data.isActive === false && data.isFeatured === false) return;
    batch.set(
      entry.ref,
      {
        isActive: false,
        isFeatured: false,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    deactivated += 1;
  });
  if (deactivated) await batch.commit();

  return {
    upserted: products.length,
    created,
    updated,
    preservedStock,
    deactivated,
  };
}

async function seedDeliveryZones(db: FirebaseFirestore.Firestore) {
  let created = 0;
  let updated = 0;

  for (const zone of deliveryZones) {
    const zoneRef = db.collection("deliveryZones").doc(zone.id);
    const snapshot = await zoneRef.get();
    await zoneRef.set(
      {
        ...zone,
        createdAt: snapshot.exists
          ? snapshot.data()?.createdAt
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    if (snapshot.exists) updated += 1;
    else created += 1;
  }

  return {
    upserted: deliveryZones.length,
    created,
    updated,
  };
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
