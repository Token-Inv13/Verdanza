import { FieldValue } from "firebase-admin/firestore";
import {
  computeWeightedSupplierCosts,
  normalizeSupplierPurchaseInput,
  type AccountingSupplierPurchaseLike,
} from "../src/lib/accountingCosts.js";
import type { Product, SupplierPurchase } from "../src/types/index.js";
import {
  getRequiredAdminDb,
  requireConfirmationFlag,
} from "./_firebaseAdminScript.js";

type ProductDoc = Product & { id: string };

const targetInvoices = ["GRO16640", "GRO16958"] as const;

const productResolutions = {
  "Harlequin [Sous-serre]": "flower-harlequin-greenhouse",
  "Petites Tetes OG Kush [Sous-serre]": "flower-petites-tetes-og-kush",
  "Cookie Kush [Interieur]": "flower-cookie-kush-indoor",
  "Golden Static": "resin-golden-static",
  "Supreme Purple CBD": "resin-supreme-purple-cbd",
  "Le Beldia CBN + CBD": "resin-le-beldia-cbn-cbd",
  "Blue Dream": "flower-blue-dream-cbd",
  "Mandarine": "flower-mandarine-cbd",
  "Mango Haze": "flower-mango-haze-cbd",
  "Supreme 50 % CBD 0 % THC": "resin-supreme-purple-cbd",
  "Creamy Piatella": "resin-creamy-piatella-cbd",
  "Amnesia": "flower-amnesia-cbd-hydroponique",
} as const;

function isExecutionMode() {
  return process.argv.includes("--yes");
}

function buildPurchases(productById: Map<string, ProductDoc>) {
  return [
    normalizeSupplierPurchaseInput({
      id: "le-grossiste-cbd-gro16640",
      supplierName: "Le Grossiste CBD",
      invoiceNumber: "GRO16640",
      invoiceDate: "2026-07-03",
      globalDiscountExVat: 0,
      shippingExVat: 0,
      vatRate: 20,
      costBase: "HT",
      status: "validated",
      lines: [
        line("Harlequin [Sous-serre]", 25, 25, productById),
        line("Petites Tetes OG Kush [Sous-serre]", 25, 25, productById),
        line("Cookie Kush [Interieur]", 25, 37.5, productById),
        line("Golden Static", 25, 47.5, productById),
        line("Supreme Purple CBD", 25, 40, productById),
      ],
    }),
    normalizeSupplierPurchaseInput({
      id: "le-grossiste-cbd-gro16958",
      supplierName: "Le Grossiste CBD",
      invoiceNumber: "GRO16958",
      invoiceDate: "2026-07-22",
      globalDiscountExVat: 148.95,
      shippingExVat: 0,
      vatRate: 20,
      costBase: "HT",
      status: "validated",
      lines: [
        line("Golden Static", 25, 47.5, productById),
        line("Le Beldia CBN + CBD", 25, 47.5, productById),
        line("Blue Dream", 25, 70, productById),
        line("Mandarine", 25, 82.25, productById),
        line("Mango Haze", 25, 82.25, productById),
        line("Supreme 50 % CBD 0 % THC", 25, 44.75, productById),
        line("Creamy Piatella", 25, 40, productById),
        line("Amnesia", 25, 82.25, productById),
      ],
    }),
  ] as SupplierPurchase[];
}

function line(
  supplierLabel: keyof typeof productResolutions,
  quantityGrams: number,
  grossAmountExVat: number,
  productById: Map<string, ProductDoc>,
) {
  const productId = productResolutions[supplierLabel];
  const product = productById.get(productId);
  if (!product) {
    throw new Error(`Produit introuvable pour ${supplierLabel}: ${productId}`);
  }
  return {
    id: supplierLabel
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    productId,
    productName: product.name,
    quantityGrams,
    grossAmountExVat,
    vatRate: 20,
    lineDiscountAmount: 0,
  };
}

function validatePurchases(purchases: SupplierPurchase[]) {
  const [gro16640, gro16958] = purchases;
  assertPurchase(gro16640, {
    invoiceNumber: "GRO16640",
    quantityGrams: 125,
    paidLinesGrossAmountExVat: 175,
    globalDiscountExVat: 0,
    totalExVat: 175,
    vatAmount: 35,
    totalIncVat: 210,
    lines: 5,
  });
  assertPurchase(gro16958, {
    invoiceNumber: "GRO16958",
    quantityGrams: 200,
    paidLinesGrossAmountExVat: 496.5,
    globalDiscountExVat: 148.95,
    totalExVat: 347.55,
    vatAmount: 69.51,
    totalIncVat: 417.06,
    lines: 8,
  });
}

function assertPurchase(
  purchase: SupplierPurchase,
  expected: {
    invoiceNumber: string;
    quantityGrams: number;
    paidLinesGrossAmountExVat: number;
    globalDiscountExVat: number;
    totalExVat: number;
    vatAmount: number;
    totalIncVat: number;
    lines: number;
  },
) {
  if (purchase.invoiceNumber !== expected.invoiceNumber) throw new Error("Numero facture invalide.");
  if (purchase.status !== "validated") throw new Error(`${purchase.invoiceNumber}: statut invalide.`);
  if (purchase.lines.length !== expected.lines) throw new Error(`${purchase.invoiceNumber}: nombre de lignes invalide.`);
  if (sumQuantity(purchase) !== expected.quantityGrams) throw new Error(`${purchase.invoiceNumber}: quantite invalide.`);
  for (const key of [
    "paidLinesGrossAmountExVat",
    "globalDiscountExVat",
    "totalExVat",
    "vatAmount",
    "totalIncVat",
  ] as const) {
    if (Number(purchase[key]) !== expected[key]) {
      throw new Error(`${purchase.invoiceNumber}: ${key} attendu ${expected[key]}, obtenu ${purchase[key]}.`);
    }
  }
  const uniqueProductIds = new Set(purchase.lines.map((entry) => entry.productId));
  if (uniqueProductIds.size !== purchase.lines.length) {
    throw new Error(`${purchase.invoiceNumber}: produit duplique dans les lignes.`);
  }
}

function sumQuantity(purchase: AccountingSupplierPurchaseLike) {
  return (purchase.lines || []).reduce((sum, entry) => sum + Number(entry.quantityGrams || 0), 0);
}

function summaryForPurchase(purchase: SupplierPurchase) {
  return {
    id: purchase.id,
    invoiceNumber: purchase.invoiceNumber,
    invoiceDate: purchase.invoiceDate,
    status: purchase.status,
    paidQuantityGrams: sumQuantity(purchase),
    paidLines: purchase.lines.length,
    paidLinesGrossAmountExVat: purchase.paidLinesGrossAmountExVat,
    globalDiscountExVat: purchase.globalDiscountExVat,
    shippingExVat: purchase.shippingExVat,
    totalExVat: purchase.totalExVat,
    vatAmount: purchase.vatAmount,
    totalIncVat: purchase.totalIncVat,
    lines: purchase.lines.map((entry) => ({
      productId: entry.productId,
      productName: entry.productName,
      quantityGrams: entry.quantityGrams,
      grossAmountExVat: entry.grossAmountExVat,
      allocatedGlobalDiscount: entry.allocatedGlobalDiscount,
      netCostAmount: entry.netCostAmount,
      effectiveCostPerGram: entry.effectiveCostPerGram,
    })),
  };
}

function withoutUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefinedDeep);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry) => entry[1] !== undefined)
      .map(([key, entryValue]) => [key, withoutUndefinedDeep(entryValue)]),
  );
}

async function main() {
  const shouldExecute = isExecutionMode();
  if (shouldExecute) requireConfirmationFlag("seed:supplier-purchases");

  const { db, projectId } = getRequiredAdminDb();
  const [productSnapshot, existingPurchasesSnapshot] = await Promise.all([
    db.collection("products").get(),
    db.collection("supplierPurchases").get(),
  ]);
  const products = productSnapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() }) as ProductDoc,
  );
  const productById = new Map(products.map((product) => [product.id, product]));
  const existingPurchases = existingPurchasesSnapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() }) as SupplierPurchase,
  );
  const duplicateInvoices = existingPurchases
    .filter((purchase) => targetInvoices.includes(purchase.invoiceNumber as (typeof targetInvoices)[number]))
    .map((purchase) => ({ id: purchase.id, invoiceNumber: purchase.invoiceNumber }));

  if (duplicateInvoices.length) {
    console.log(JSON.stringify({ mode: shouldExecute ? "execute" : "dry-run", projectId, duplicateInvoices }, null, 2));
    console.log("Aucun achat fournisseur cree: facture deja presente.");
    return;
  }

  const purchases = buildPurchases(productById);
  validatePurchases(purchases);

  const planned = {
    mode: shouldExecute ? "execute" : "dry-run",
    projectId,
    writeScope: purchases.map((purchase) => `supplierPurchases/${purchase.id}`),
    untouchedCollections: [
      "products",
      "productCosts",
      "orders",
      "stockMovements",
      "invoices",
      "customers",
    ],
    productMatches: Object.entries(productResolutions).map(([supplierLabel, productId]) => ({
      supplierLabel,
      productId,
      productName: productById.get(productId)?.name,
      slug: productById.get(productId)?.slug,
      isActive: productById.get(productId)?.isActive,
    })),
    purchases: purchases.map(summaryForPurchase),
  };

  console.log(JSON.stringify(planned, null, 2));

  if (!shouldExecute) {
    console.log("Aucune donnee modifiee. Relancer avec: npm run seed:supplier-purchases -- --yes");
    return;
  }

  const now = new Date().toISOString();
  const batch = db.batch();
  for (const purchase of purchases) {
    const ref = db.collection("supplierPurchases").doc(purchase.id);
    batch.set(ref, withoutUndefinedDeep({
      ...purchase,
      createdAt: now,
      updatedAt: now,
      validatedAt: now,
      createdBy: "script:seedSupplierPurchases",
      updatedBy: "script:seedSupplierPurchases",
      importedAt: FieldValue.serverTimestamp(),
    }) as FirebaseFirestore.DocumentData);
  }
  await batch.commit();

  const verificationSnapshot = await db.collection("supplierPurchases").get();
  const verificationPurchases = verificationSnapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() }) as SupplierPurchase,
  );
  const seededPurchases = verificationPurchases.filter((purchase) =>
    targetInvoices.includes(purchase.invoiceNumber as (typeof targetInvoices)[number]),
  );
  const weightedCosts = computeWeightedSupplierCosts(verificationPurchases);

  console.log(
    JSON.stringify(
      {
        projectId,
        writtenDocuments: seededPurchases.map(summaryForPurchase),
        targetInvoicesFoundAfterWrite: seededPurchases.length,
        weightedCosts: [...weightedCosts.costByProductId.values()].map((cost) => ({
          productId: cost.productId,
          productName: productById.get(cost.productId)?.name || cost.productId,
          totalQuantityGrams: cost.totalQuantityGrams,
          totalCost: cost.totalCost,
          weightedCostPerGram: cost.weightedCostPerGram,
          displayCostPerGram: cost.weightedCostPerGram.toFixed(2),
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("seed:supplier-purchases failed", error);
  process.exit(1);
});
