import { FieldValue } from "firebase-admin/firestore";
import { assertAdminUser } from "./_server/adminAuth.js";
import { getAdminDb, getAdminStorageBucket } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import { renderInvoicePdf } from "./_server/invoicePdf.js";
import { getAdminAnalyticsReport } from "./_server/ga4DataApi.js";
import { sendInvoiceToCustomerEmail } from "./_server/email.js";
import { BRAND_DOCUMENT_LOGO } from "../src/lib/brandAssets.js";
import { normalizeSupplierPurchaseInput } from "../src/lib/accountingCosts.js";
import { buildCustomerInvoiceLines } from "../src/lib/customerInvoiceLines.js";
import {
  normalizeSupplierLabel,
  normalizeText,
} from "../src/lib/supplierInvoiceParsers.js";
import { reserveProductInternalReference } from "./_server/productReferences.js";
import {
  assertProductDeleteConfirmation,
  hasBlockingProductDependencies,
  productDependencyMessage,
  productStoragePathsForDeletion,
  type ProductCleanupCounts,
  type ProductDependencyCounts,
} from "./_server/productDeletion.js";
import {
  normalizeFixedPriceMode,
  serializeFixedPriceOptionsForMode,
  validateManualFixedPriceOptions,
} from "../src/lib/fixedPriceOptions.js";
import {
  syncProductPrimaryImage,
  validateProductImagesForProduct,
} from "../src/lib/productImages.js";
import {
  assertInvoiceSendable,
} from "../src/lib/invoiceSendPolicy.js";
import {
  executeGuardedInvoiceSend,
  finalizeAcceptedInvoiceSend,
} from "./_server/invoiceEmailSend.js";
import type {
  BillingSettings,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  Order,
  PaymentStatus,
  Product,
  SupplierProductAlias,
  SupplierPurchase,
} from "../src/types/index.js";

const invoiceStatuses: InvoiceStatus[] = [
  "draft",
  "validated",
  "sent",
  "paid",
  "cancelled",
  "credit_note_issued",
];
const paymentStatuses: PaymentStatus[] = ["to_confirm", "pending", "paid", "cancelled"];

const fallbackBillingSettings: BillingSettings = {
  id: "billing",
  tradeName: "Verdanza",
  displayName: "Token APP",
  legalName: "",
  legalForm: "",
  siren: "843 072 968",
  siret: "843 072 968 00012",
  vatMode: "not_configured",
  vatNumber: "",
  vatMention: "",
  address: "",
  phone: "07 80 81 41 37",
  email: "contact@verdanza.fr",
  paymentTerms: "Règlement à confirmer directement avec le client.",
  legalMentions: "",
  logoUrl: BRAND_DOCUMENT_LOGO,
  isManuallyValidated: false,
  validationWarning:
    "Les informations légales de facturation ne sont pas encore validées. Vérifiez la raison sociale, le SIRET, l'adresse, le régime TVA et les mentions obligatoires avant émission officielle.",
};

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  const method = request.method || "GET";
  if (!["GET", "POST"].includes(method)) {
    sendJson(response, { error: "Methode non autorisee." }, 405);
    return;
  }

  try {
    const db = getAdminDb();
    const idToken = bearerToken(request) || parseAuthToken(request.body);
    if (!idToken) {
      sendJson(response, { error: "Token admin requis." }, 401);
      return;
    }
    const adminUser = await assertAdminUser(db, idToken);

    if (method === "GET") {
      const query = new URL(request.url || "/", "https://verdanza.local").searchParams;
      const action = query.get("action") || "";
      if (action === "productCosts") {
        const snapshot = await db.collection("productCosts").get();
        sendJson(response, {
          costs: snapshot.docs.map((entry) => {
            const data = entry.data();
            return {
              productId: entry.id,
              purchasePricePerGram: optionalNonNegativeNumber(data.purchasePricePerGram),
              updatedAt: data.updatedAt,
              updatedBy: data.updatedBy,
            };
          }),
        });
        return;
      }
      if (action === "supplierPurchases") {
        const snapshot = await db.collection("supplierPurchases").orderBy("invoiceDate", "desc").get();
        sendJson(response, {
          purchases: snapshot.docs.map((entry) => {
            const data = entry.data();
            return normalizeSupplierPurchaseForResponse({
              id: entry.id,
              ...data,
            });
          }),
        });
        return;
      }
      if (action === "analytics") {
        const preset = query.get("preset") || "30d";
        const analytics = await getAdminAnalyticsReport({
          preset: preset === "7d" || preset === "90d" || preset === "custom" ? preset : "30d",
          startDate: query.get("startDate") || undefined,
          endDate: query.get("endDate") || undefined,
          compare: query.get("compare") === "1",
        });
        sendJson(response, analytics);
        return;
      }
      if (action !== "pdf") {
        sendJson(response, { error: "Action invalide." }, 400);
        return;
      }
      const invoiceId = query.get("invoiceId") || "";
      const invoice = await getInvoice(db, invoiceId);
      const settings = await getBillingSettings(db);
      const pdf = await renderInvoicePdf(invoice, settings);
      response.statusCode = 200;
      response.setHeader("content-type", "application/pdf");
      response.setHeader(
        "content-disposition",
        `attachment; filename="${invoice.invoiceNumber}.pdf"`,
      );
      response.end(Buffer.from(pdf));
      return;
    }

    if (assertMethod(request, response, "POST")) return;
    const body = parseJsonObject(request.body);

    if (body.action === "createFromOrder") {
      const result = await createInvoiceFromOrder(db, String(body.orderId || ""));
      sendJson(response, result);
      return;
    }

    if (body.action === "createManual") {
      const result = await createManualInvoice(db, body.manualInvoice);
      sendJson(response, result);
      return;
    }

    if (body.action === "updateStatus") {
      const status = body.status as InvoiceStatus;
      if (!invoiceStatuses.includes(status)) throw new Error("Statut facture invalide.");
      const now = new Date().toISOString();
      const update: Record<string, unknown> = {
        status,
        updatedAt: now,
      };
      if (status === "validated") update.validatedAt = now;
      if (status === "paid") update.paymentStatus = "paid";
      await db.collection("invoices").doc(String(body.invoiceId || "")).update(update);
      sendJson(response, { ok: true });
      return;
    }

    if (body.action === "sendEmail") {
      const invoice = await getInvoice(db, String(body.invoiceId || ""));
      const linkedOrder = await getLinkedOrder(db, invoice);
      assertInvoiceSendable(invoice, linkedOrder);
      if (!invoice.customerEmail) throw new Error("Email client absent.");
      const settings = await getBillingSettings(db);
      const pdf = await renderInvoicePdf(invoice, settings);
      await executeGuardedInvoiceSend({
        invoice,
        linkedOrder,
        send: () => sendInvoiceToCustomerEmail(invoice, settings, Buffer.from(pdf)),
        finalize: () => finalizeAcceptedInvoiceSend({
          db,
          invoiceId: invoice.id,
          sentTo: invoice.customerEmail || "",
        }),
      });
      sendJson(response, { ok: true });
      return;
    }

    if (body.action === "saveProductCost") {
      const productId = String(body.productId || "").trim();
      if (!productId) throw new Error("Produit requis.");
      const purchasePricePerGram = optionalNonNegativeNumber(body.purchasePricePerGram);
      await db.collection("productCosts").doc(productId).set(
        {
          productId,
          purchasePricePerGram: purchasePricePerGram ?? null,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: adminUser.email || adminUser.uid,
        },
        { merge: true },
      );
      sendJson(response, { ok: true, productId, purchasePricePerGram });
      return;
    }

    if (body.action === "upsertProductAdmin") {
      const result = await upsertProductAdmin(db, body.product);
      sendJson(response, result);
      return;
    }

    if (body.action === "deleteProductAdmin") {
      const result = await deleteProductAdmin(db, body, adminUser);
      sendJson(response, result);
      return;
    }

    if (body.action === "saveSupplierProductAlias") {
      const result = await saveSupplierProductAlias(db, body.alias, adminUser);
      sendJson(response, result);
      return;
    }

    if (body.action === "saveSupplierPurchase") {
      const result = await saveSupplierPurchase(db, body.purchase, adminUser);
      sendJson(response, result);
      return;
    }

    if (body.action === "deleteSupplierPurchase") {
      await deleteSupplierPurchase(db, String(body.purchaseId || ""));
      sendJson(response, { ok: true });
      return;
    }

    if (body.action === "cancelSupplierPurchase") {
      await cancelSupplierPurchase(db, String(body.purchaseId || ""), adminUser);
      sendJson(response, { ok: true });
      return;
    }

    sendJson(response, { error: "Action facture inconnue." }, 400);
  } catch (error) {
    console.error("invoices failed", error);
    const details = error as {
      statusCode?: number;
      code?: string;
      dependencies?: ProductDependencyCounts;
    };
    sendJson(
      response,
      {
        error: error instanceof Error ? error.message : "Operation facture impossible.",
        ...(details.code ? { code: details.code } : {}),
        ...(details.dependencies ? { dependencies: details.dependencies, blocked: true } : {}),
      },
      details.statusCode || 400,
    );
  }
}

async function getLinkedOrder(
  db: FirebaseFirestore.Firestore,
  invoice: Invoice,
) {
  if (!invoice.orderId) return undefined;
  const snapshot = await db.collection("orders").doc(invoice.orderId).get();
  return snapshot.exists
    ? ({ id: snapshot.id, ...snapshot.data() } as Order)
    : null;
}

async function createInvoiceFromOrder(db: FirebaseFirestore.Firestore, orderId: string) {
  if (!orderId) throw new Error("orderId requis.");
  const existing = await db.collection("invoices").where("orderId", "==", orderId).limit(1).get();
  if (!existing.empty) {
    const invoice = existing.docs[0];
    return { invoiceId: invoice.id, invoiceNumber: invoice.data().invoiceNumber as string };
  }
  const orderSnapshot = await db.collection("orders").doc(orderId).get();
  if (!orderSnapshot.exists) throw new Error("Commande introuvable.");
  const order = { id: orderSnapshot.id, ...orderSnapshot.data() } as Order;
  const invoiceNumber = await nextInvoiceNumber(db);
  const now = new Date().toISOString();
  const lines = buildCustomerInvoiceLines(order);
  const invoiceRef = db.collection("invoices").doc();
  const invoice: Invoice = {
    id: invoiceRef.id,
    invoiceNumber,
    orderId: order.id,
    origin: "order",
    status: "draft",
    customerName: order.customerName || order.customerEmail || "Client",
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    customerAddress: order.deliveryAddress,
    lines,
    subtotal: Number(order.subtotal || 0),
    deliveryFee: Number(order.deliveryFee || 0),
    discountAmount: Number(order.discountAmount || 0),
    appliedPromotions: order.appliedPromotions || [],
    total: Number(order.total || 0),
    paymentMethod: order.paymentInstructions || "Règlement à confirmer",
    paymentStatus: order.paymentStatus || "to_confirm",
    internalNote: "",
    createdAt: now,
    updatedAt: now,
  };
  await invoiceRef.set(invoice);
  await db.collection("orders").doc(order.id).update({
    invoiceId: invoice.id,
    invoiceNumber,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { invoiceId: invoice.id, invoiceNumber };
}

async function createManualInvoice(db: FirebaseFirestore.Firestore, raw: unknown) {
  const input = parseManualInvoice(raw);
  const invoiceNumber = await nextInvoiceNumber(db);
  const now = new Date().toISOString();
  const subtotal = roundMoney(input.lines.reduce((sum, line) => sum + line.total, 0));
  const total = roundMoney(subtotal + input.deliveryFee - input.discountAmount);
  const invoiceRef = db.collection("invoices").doc();
  const invoice: Invoice = {
    id: invoiceRef.id,
    invoiceNumber,
    origin: "manual",
    status: "draft",
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    lines: input.lines,
    subtotal,
    deliveryFee: input.deliveryFee,
    discountAmount: input.discountAmount,
    total,
    paymentMethod: input.paymentMethod,
    paymentStatus: input.paymentStatus,
    internalNote: input.internalNote,
    createdAt: now,
    updatedAt: now,
  };
  await invoiceRef.set(invoice);
  return { invoiceId: invoice.id, invoiceNumber };
}

async function nextInvoiceNumber(db: FirebaseFirestore.Firestore) {
  const year = new Date().getFullYear();
  const counterRef = db.collection("counters").doc(`invoices-${year}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(counterRef);
    const current = Number(snapshot.data()?.value || 0);
    const next = current + 1;
    transaction.set(counterRef, {
      value: next,
      year,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return `VER-${year}-${String(next).padStart(4, "0")}`;
  });
}

async function getInvoice(db: FirebaseFirestore.Firestore, invoiceId: string) {
  if (!invoiceId) throw new Error("invoiceId requis.");
  const snapshot = await db.collection("invoices").doc(invoiceId).get();
  if (!snapshot.exists) throw new Error("Facture introuvable.");
  return { id: snapshot.id, ...snapshot.data() } as Invoice;
}

async function getBillingSettings(db: FirebaseFirestore.Firestore) {
  const snapshot = await db.collection("settings").doc("billing").get();
  return {
    ...fallbackBillingSettings,
    ...(snapshot.exists ? snapshot.data() : {}),
    id: "billing",
  } as BillingSettings;
}

async function saveSupplierPurchase(
  db: FirebaseFirestore.Firestore,
  rawPurchase: unknown,
  adminUser: { email?: string | null; uid: string },
) {
  if (!rawPurchase || typeof rawPurchase !== "object") {
    throw new Error("Achat fournisseur invalide.");
  }
  const input = rawPurchase as Partial<SupplierPurchase>;
  const existingRef = input.id ? db.collection("supplierPurchases").doc(String(input.id)) : null;
  const existingSnapshot = existingRef ? await existingRef.get() : null;
  const existing = existingSnapshot?.exists
    ? ({ id: existingSnapshot.id, ...existingSnapshot.data() } as SupplierPurchase)
    : null;
  if (existing?.status === "validated") {
    throw new Error("Achat fournisseur valide non modifiable. Annulez-le pour le neutraliser.");
  }
  if (existing?.status === "cancelled") {
    throw new Error("Achat fournisseur annule non modifiable.");
  }
  const normalized = normalizeSupplierPurchaseInput({
    ...input,
    createdAt: existing?.createdAt,
    createdBy: existing?.createdBy,
    validatedAt: existing?.validatedAt,
  }) as SupplierPurchase;
  if (!normalized.supplierName) throw new Error("Fournisseur requis.");
  if (!normalized.invoiceNumber) throw new Error("Numero de facture fournisseur requis.");
  if (!normalized.invoiceDate) throw new Error("Date de facture fournisseur requise.");
  if (normalized.status === "cancelled") throw new Error("Utilisez l'action d'annulation dediee.");
  if (normalized.status === "validated") {
    const allProductsConfirmed = normalized.lines.every((line) => Boolean(line.productId));
    if (!allProductsConfirmed) {
      throw new Error("Validation refusee: chaque ligne fournisseur doit etre liee a un produit.");
    }
  }

  const now = new Date().toISOString();
  const ref = existingRef || db.collection("supplierPurchases").doc();
  const isValidation = normalized.status === "validated";
  const payload: SupplierPurchase = {
    ...normalized,
    id: ref.id,
    status: normalized.status,
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || adminUser.email || adminUser.uid,
    updatedAt: now,
    updatedBy: adminUser.email || adminUser.uid,
    validatedAt: isValidation ? existing?.validatedAt || now : normalized.validatedAt,
    sourceFileSha256: normalized.sourceFileSha256 || existing?.sourceFileSha256,
    importedFromPdfAt: normalized.importedFromPdfAt || existing?.importedFromPdfAt,
  };
  await ref.set(payload, { merge: true });
  return { ok: true, purchaseId: ref.id };
}

async function upsertProductAdmin(db: FirebaseFirestore.Firestore, rawProduct: unknown) {
  if (!rawProduct || typeof rawProduct !== "object") throw new Error("Produit invalide.");
  const input = rawProduct as Partial<Product>;
  const id = String(input.id || input.slug || "").trim();
  if (!id) throw new Error("Identifiant produit requis.");
  const ref = db.collection("products").doc(id);
  const payload = syncProductPrimaryImage({ ...input });
  payload.fixedPriceMode = normalizeFixedPriceMode(input.fixedPriceMode, input.category);
  payload.fixedPriceOptions = serializeFixedPriceOptionsForMode(
    payload.fixedPriceMode,
    input.fixedPriceOptions,
  );
  const manualIssues = validateManualFixedPriceOptions({
    id,
    ...(payload as Omit<Product, "id">),
  } as Product);
  const blockingManualIssue = manualIssues.find((issue) => issue.severity === "error");
  if (blockingManualIssue) {
    throw new Error(`Formats prix fixe invalides : ${blockingManualIssue.message}`);
  }
  const imageValidation = validateProductImagesForProduct(id, payload.images || []);
  if (!imageValidation.ok) {
    throw new Error(`Images produit invalides : ${imageValidation.errors[0]}`);
  }
  delete (payload as Record<string, unknown>).id;
  delete (payload as Record<string, unknown>).internalReference;
  delete (payload as Record<string, unknown>).legacyInternalReferences;

  const productId = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existingReference = snapshot.data()?.internalReference;
    const update: Record<string, unknown> = {
      ...payload,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!snapshot.exists || !existingReference) {
      update.internalReference = await reserveProductInternalReference({
        db,
        transaction,
        productId: id,
        category: snapshot.exists ? snapshot.data()?.category || input.category : input.category,
      });
    }
    if (!snapshot.exists) {
      update.createdAt = FieldValue.serverTimestamp();
    }
    transaction.set(ref, update, { merge: true });
    return id;
  });

  return { ok: true, productId };
}

async function deleteProductAdmin(
  db: FirebaseFirestore.Firestore,
  body: Record<string, unknown>,
  adminUser: { email?: string | null; uid: string },
) {
  const productId = String(body.productId || "").trim();
  if (!productId) throw new Error("Produit requis.");
  const productRef = db.collection("products").doc(productId);
  const productSnapshot = await productRef.get();
  if (!productSnapshot.exists) throw new Error("Produit introuvable.");
  const product = { id: productSnapshot.id, ...productSnapshot.data() } as Product;
  assertProductDeleteConfirmation(product, String(body.confirmationReference || ""));

  const dependencies = await findProductDependencies(db, productId);
  if (hasBlockingProductDependencies(dependencies)) {
    const error = productDependencyMessage(dependencies);
    const blocked = new Error(error);
    Object.assign(blocked, { statusCode: 409, dependencies });
    throw blocked;
  }

  const cleanup = await buildProductCleanup(db, product);
  const storagePaths = productStoragePathsForDeletion(product);
  const batch = db.batch();
  cleanup.favoriteRefs.forEach((ref) => batch.delete(ref));
  cleanup.supplierProductAliasRefs.forEach((ref) => batch.delete(ref));
  batch.delete(db.collection("productCosts").doc(productId));
  cleanup.couponUpdates.forEach(({ ref, productIds }) => {
    batch.set(ref, { productIds, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  if (product.internalReference) {
    batch.set(
      db.collection("productReferences").doc(product.internalReference),
      {
        productId,
        deletedAt: FieldValue.serverTimestamp(),
        deletedBy: adminUser.email || adminUser.uid,
      },
      { merge: true },
    );
  }
  batch.delete(productRef);
  await batch.commit();

  const storage = await deleteProductStorageFiles(storagePaths);

  return {
    ok: true,
    deletedProductId: productId,
    dependencies,
    cleaned: cleanup.counts,
    storage,
  };
}

async function findProductDependencies(
  db: FirebaseFirestore.Firestore,
  productId: string,
): Promise<ProductDependencyCounts> {
  const [orders, invoices, supplierPurchases, stockMovements, productReviews] =
    await Promise.all([
      countDocsWithProductInArray(db, "orders", productId, "items"),
      countDocsWithProductInArray(db, "invoices", productId, "lines"),
      countDocsWithProductInArray(db, "supplierPurchases", productId, "lines"),
      countQuery(db.collection("stockMovements").where("productId", "==", productId)),
      countQuery(db.collection("productReviews").where("productId", "==", productId)),
    ]);
  return { orders, invoices, supplierPurchases, stockMovements, productReviews };
}

async function buildProductCleanup(db: FirebaseFirestore.Firestore, product: Product) {
  const productId = product.id;
  const [favoritesSnapshot, aliasSnapshot, costSnapshot, couponSnapshot] = await Promise.all([
    db.collection("favorites").where("productId", "==", productId).get(),
    db.collection("supplierProductAliases").where("productId", "==", productId).get(),
    db.collection("productCosts").doc(productId).get(),
    db.collection("coupons").where("productIds", "array-contains", productId).get(),
  ]);

  const couponUpdates = couponSnapshot.docs
    .map((entry) => {
      const productIds = Array.isArray(entry.data().productIds)
        ? entry.data().productIds.filter((entryProductId: unknown) => entryProductId !== productId)
        : [];
      return { ref: entry.ref, productIds };
    });

  const counts: ProductCleanupCounts = {
    favorites: favoritesSnapshot.size,
    productCosts: costSnapshot.exists ? 1 : 0,
    supplierProductAliases: aliasSnapshot.size,
    coupons: couponUpdates.length,
    productReferenceReservations: product.internalReference ? 1 : 0,
  };

  return {
    favoriteRefs: favoritesSnapshot.docs.map((entry) => entry.ref),
    supplierProductAliasRefs: aliasSnapshot.docs.map((entry) => entry.ref),
    couponUpdates,
    counts,
  };
}

async function deleteProductStorageFiles(paths: string[]) {
  if (!paths.length) return { deleted: 0, failed: [] as string[] };
  const bucket = getAdminStorageBucket();
  const failed: string[] = [];
  let deleted = 0;
  for (const path of paths) {
    try {
      await bucket.file(path).delete({ ignoreNotFound: true });
      deleted += 1;
    } catch {
      failed.push(path);
    }
  }
  return { deleted, failed };
}

async function countDocsWithProductInArray(
  db: FirebaseFirestore.Firestore,
  collectionName: string,
  productId: string,
  arrayField: string,
) {
  const snapshot = await db.collection(collectionName).get();
  return snapshot.docs.filter((entry) => {
    const rows = entry.data()[arrayField];
    if (!Array.isArray(rows)) return false;
    return rows.some((row) => row && typeof row === "object" && row.productId === productId);
  }).length;
}

async function countQuery(query: FirebaseFirestore.Query) {
  const snapshot = await query.get();
  return snapshot.size;
}

async function saveSupplierProductAlias(
  db: FirebaseFirestore.Firestore,
  rawAlias: unknown,
  adminUser: { email?: string | null; uid: string },
) {
  if (!rawAlias || typeof rawAlias !== "object") throw new Error("Alias fournisseur invalide.");
  const input = rawAlias as Partial<SupplierProductAlias>;
  const supplierName = String(input.supplierName || "").trim();
  const originalLabel = String(input.originalLabel || "").trim();
  const productId = String(input.productId || "").trim();
  if (!supplierName || !originalLabel || !productId) {
    throw new Error("Fournisseur, libelle et produit requis pour memoriser l'alias.");
  }
  const productSnapshot = await db.collection("products").doc(productId).get();
  if (!productSnapshot.exists) throw new Error("Produit introuvable pour cet alias.");
  const product = { id: productSnapshot.id, ...productSnapshot.data() } as Product;
  const id = `${slugifyForId(supplierName)}-${slugifyForId(originalLabel)}`.slice(0, 180);
  const now = new Date().toISOString();
  await db.collection("supplierProductAliases").doc(id).set(
    {
      id,
      supplierName,
      normalizedSupplierName: normalizeText(supplierName),
      originalLabel,
      normalizedOriginalLabel: normalizeSupplierLabel(originalLabel),
      productId,
      productInternalReference: product.internalReference || "",
      productName: product.name || "",
      updatedAt: now,
      updatedBy: adminUser.email || adminUser.uid,
      createdAt: input.createdAt || now,
      createdBy: input.createdBy || adminUser.email || adminUser.uid,
    },
    { merge: true },
  );
  return { ok: true, aliasId: id };
}

async function deleteSupplierPurchase(db: FirebaseFirestore.Firestore, purchaseId: string) {
  if (!purchaseId) throw new Error("Achat fournisseur requis.");
  const ref = db.collection("supplierPurchases").doc(purchaseId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new Error("Achat fournisseur introuvable.");
  const purchase = { id: snapshot.id, ...snapshot.data() } as SupplierPurchase;
  if (purchase.status === "validated") {
    throw new Error("Un achat fournisseur valide doit etre annule et conserve.");
  }
  await ref.delete();
}

async function cancelSupplierPurchase(
  db: FirebaseFirestore.Firestore,
  purchaseId: string,
  adminUser: { email?: string | null; uid: string },
) {
  if (!purchaseId) throw new Error("Achat fournisseur requis.");
  const ref = db.collection("supplierPurchases").doc(purchaseId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new Error("Achat fournisseur introuvable.");
  const purchase = { id: snapshot.id, ...snapshot.data() } as SupplierPurchase;
  if (purchase.status !== "validated") {
    throw new Error("Seul un achat fournisseur valide peut etre annule.");
  }
  await ref.set(
    {
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      cancelledBy: adminUser.email || adminUser.uid,
      updatedAt: new Date().toISOString(),
      updatedBy: adminUser.email || adminUser.uid,
    },
    { merge: true },
  );
}

function normalizeSupplierPurchaseForResponse(purchase: Partial<SupplierPurchase>) {
  return {
    ...purchase,
    id: String(purchase.id || ""),
    supplierName: String(purchase.supplierName || ""),
    invoiceNumber: String(purchase.invoiceNumber || ""),
    invoiceDate: String(purchase.invoiceDate || ""),
    internalReference: String(purchase.internalReference || ""),
    status: purchase.status || "draft",
    costBase: purchase.costBase || "HT",
    paidLinesGrossAmountExVat: Number(purchase.paidLinesGrossAmountExVat || 0),
    globalDiscountExVat: Number(purchase.globalDiscountExVat || 0),
    shippingExVat: Number(purchase.shippingExVat || 0),
    vatRate: Number(purchase.vatRate || 0),
    vatAmount: Number(purchase.vatAmount || 0),
    totalExVat: Number(purchase.totalExVat || 0),
    totalIncVat: Number(purchase.totalIncVat || 0),
    lines: purchase.lines || [],
    createdAt: parseTimestamp(purchase.createdAt),
    updatedAt: parseTimestamp(purchase.updatedAt),
    validatedAt: parseTimestamp(purchase.validatedAt),
    sourceFileSha256: purchase.sourceFileSha256 || "",
    importedFromPdfAt: parseTimestamp(purchase.importedFromPdfAt),
    cancelledAt: parseTimestamp(purchase.cancelledAt),
    cancelledBy: purchase.cancelledBy || "",
    createdBy: purchase.createdBy || "",
    updatedBy: purchase.updatedBy || "",
  };
}

function parseManualInvoice(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Facture manuelle invalide.");
  const input = value as {
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    lines?: InvoiceLine[];
    deliveryFee?: number;
    discountAmount?: number;
    paymentMethod?: string;
    paymentStatus?: PaymentStatus;
    internalNote?: string;
  };
  if (!input.customerName) throw new Error("Client requis.");
  const lines = (input.lines || []).filter((line) => line.label && line.quantity > 0);
  if (!lines.length) throw new Error("Au moins une ligne facture est requise.");
  const normalizedLines = lines.map((line, index) => ({
    id: line.id || `line-${index + 1}`,
    label: line.label,
    quantity: Number(line.quantity || 0),
    unitPrice: Number(line.unitPrice || 0),
    total: roundMoney(Number(line.quantity || 0) * Number(line.unitPrice || 0)),
  }));
  const paymentStatus = input.paymentStatus || "to_confirm";
  if (!paymentStatuses.includes(paymentStatus)) throw new Error("Statut règlement invalide.");
  return {
    customerName: input.customerName,
    customerEmail: input.customerEmail || "",
    customerPhone: input.customerPhone || "",
    lines: normalizedLines,
    deliveryFee: Number(input.deliveryFee || 0),
    discountAmount: Number(input.discountAmount || 0),
    paymentMethod: input.paymentMethod || "Règlement à confirmer",
    paymentStatus,
    internalNote: input.internalNote || "",
  };
}

function slugifyForId(value: string) {
  return normalizeText(value).replace(/\s+/g, "-").slice(0, 96) || "alias";
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("Payload invalide.");
  return body as Record<string, unknown>;
}

function parseAuthToken(value: unknown) {
  try {
    const body = parseJsonObject(value);
    return typeof body.authToken === "string" ? body.authToken : "";
  } catch {
    return "";
  }
}

function bearerToken(request: VercelRequestLike) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function optionalNonNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Prix d'achat invalide.");
  }
  return parsed;
}

function parseTimestamp(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const candidate = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof candidate.toDate === "function") return candidate.toDate().toISOString();
    const seconds = candidate.seconds ?? candidate._seconds;
    if (typeof seconds === "number") return new Date(seconds * 1000).toISOString();
  }
  return "";
}
