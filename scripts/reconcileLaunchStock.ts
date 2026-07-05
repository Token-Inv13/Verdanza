import { FieldValue } from "firebase-admin/firestore";
import type { Order, Product } from "../src/types/index.js";
import {
  getRequiredAdminDb,
  requireConfirmationFlag,
} from "./_firebaseAdminScript.js";

const TARGET_ACTIVE_PRODUCT_STOCK = 25;

type ProductDocument = Product & {
  createdAt?: unknown;
  updatedAt?: unknown;
};

type CancelledOrderDocument = Order & {
  stockReconciledAt?: string;
};

function shouldExecute() {
  return process.argv.includes("--yes");
}

async function main() {
  const execute = shouldExecute();
  if (execute) requireConfirmationFlag("reconcile:launch-stock");

  const { db, projectId } = getRequiredAdminDb();
  const now = new Date().toISOString();

  const productSnapshot = await db
    .collection("products")
    .where("isActive", "==", true)
    .get();
  const activeProducts = productSnapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as ProductDocument,
  }));

  const cancelledOrdersSnapshot = await db
    .collection("orders")
    .where("orderStatus", "==", "cancelled")
    .get();
  const cancelledOrders = cancelledOrdersSnapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as CancelledOrderDocument,
  }));

  const productCorrections = activeProducts.map((product) => {
    const currentStock = Number(product.data.stock || 0);
    return {
      id: product.id,
      name: product.data.name,
      currentStock,
      targetStock: TARGET_ACTIVE_PRODUCT_STOCK,
      delta: TARGET_ACTIVE_PRODUCT_STOCK - currentStock,
    };
  });

  const cancelledOrdersToMark = cancelledOrders.filter(
    (order) => !order.data.stockRestoredAt || !order.data.cancelledAt,
  );
  const linkedInvoicesToCancel = cancelledOrders
    .map((order) => order.data.invoiceId)
    .filter(Boolean) as string[];

  console.log(
    JSON.stringify(
      {
        mode: execute ? "execute" : "dry-run",
        projectId,
        activeProducts: activeProducts.length,
        targetStockPerActiveProduct: TARGET_ACTIVE_PRODUCT_STOCK,
        targetTotalStock: activeProducts.length * TARGET_ACTIVE_PRODUCT_STOCK,
        productCorrections,
        cancelledOrders: cancelledOrders.length,
        cancelledOrdersToMark: cancelledOrdersToMark.length,
        linkedInvoicesToCancel: linkedInvoicesToCancel.length,
      },
      null,
      2,
    ),
  );

  if (!execute) {
    console.log(
      "Aucune donnee modifiee. Relancer avec: npm run reconcile:launch-stock -- --yes",
    );
    return;
  }

  const batch = db.batch();
  for (const correction of productCorrections) {
    const productRef = db.collection("products").doc(correction.id);
    batch.set(
      productRef,
      {
        stock: TARGET_ACTIVE_PRODUCT_STOCK,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (correction.delta !== 0) {
      batch.set(db.collection("stockMovements").doc(), {
        productId: correction.id,
        productName: correction.name,
        type: "correction",
        quantity: correction.delta,
        note: "Correction lancement: stock physique confirme a 25 g.",
        createdAt: FieldValue.serverTimestamp(),
        createdBy: "reconcile:launch-stock",
      });
    }
  }

  for (const order of cancelledOrdersToMark) {
    batch.set(
      db.collection("orders").doc(order.id),
      {
        paymentStatus: "cancelled",
        cancelledAt: order.data.cancelledAt || now,
        stockRestoredAt: order.data.stockRestoredAt || now,
        stockReconciledAt: now,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  for (const invoiceId of linkedInvoicesToCancel) {
    batch.set(
      db.collection("invoices").doc(invoiceId),
      {
        status: "cancelled",
        updatedAt: now,
      },
      { merge: true },
    );
  }

  await batch.commit();

  const verificationSnapshot = await db
    .collection("products")
    .where("isActive", "==", true)
    .get();
  const verifiedProducts = verificationSnapshot.docs.map((doc) => ({
    id: doc.id,
    name: (doc.data() as ProductDocument).name,
    stock: Number((doc.data() as ProductDocument).stock || 0),
  }));
  const verifiedTotalStock = verifiedProducts.reduce(
    (sum, product) => sum + product.stock,
    0,
  );

  console.log(
    JSON.stringify(
      {
        updatedProducts: productCorrections.length,
        stockMovementsCreated: productCorrections.filter(
          (correction) => correction.delta !== 0,
        ).length,
        markedCancelledOrders: cancelledOrdersToMark.length,
        cancelledInvoicesTouched: linkedInvoicesToCancel.length,
        verifiedProducts,
        verifiedTotalStock,
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
