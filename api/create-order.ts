import { FieldValue } from "firebase-admin/firestore";
import crypto from "node:crypto";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import {
  orderPayload,
  parseCheckoutBody,
  paymentInstructionsFor,
  priceCheckout,
  type CheckoutRequestBody,
  type PricedCheckout,
} from "./_server/checkout.js";
import { verifyFirebaseIdToken } from "./_server/adminAuth.js";
import {
  sendAdminManualOrderEmail,
  sendManualOrderConfirmationEmail,
} from "./_server/email.js";
import { sendOrderCreationAlerts } from "./_server/orderAlerts.js";
import {
  CheckoutRequestConflictError,
  checkoutPayloadFingerprint,
  checkoutRequestDocument,
  checkoutRequestsCollection,
  claimOrderSideEffectTask,
  findCheckoutRequest,
  notificationSummary,
  orderSideEffectsCollection,
  orderSideEffectsDocument,
  persistOrderSideEffectResult,
  runEmailSideEffect,
  validateCheckoutRequestId,
} from "./_server/orderSideEffects.js";
import { buildCustomerInvoiceLines } from "../src/lib/customerInvoiceLines.js";
import {
  fixedPriceEffectiveUnitPrice,
  fixedPriceLineTotal,
  resolveFixedPriceOptions,
} from "../src/lib/fixedPriceOptions.js";
import type { Invoice, Order, Product } from "../src/types/index.js";

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "POST")) return;

  try {
    const requestBody =
      typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const body = parseCheckoutBody(requestBody);
    const checkoutRequestId = validateCheckoutRequestId(body.checkoutRequestId);
    body.checkoutRequestId = checkoutRequestId;
    const payloadFingerprint = checkoutPayloadFingerprint(body);
    const db = getAdminDb();
    const existingRequest = await findCheckoutRequest(
      db,
      checkoutRequestId,
      payloadFingerprint,
    );
    if (existingRequest) {
      await sendExistingOrderResponse(db, response, existingRequest.orderId);
      return;
    }

    let priced: PricedCheckout;
    try {
      priced = await priceCheckout(db, body);
    } catch (error) {
      const requestCreatedDuringPricing = await findCheckoutRequest(
        db,
        checkoutRequestId,
        payloadFingerprint,
      );
      if (requestCreatedDuringPricing) {
        await sendExistingOrderResponse(db, response, requestCreatedDuringPricing.orderId);
        return;
      }
      throw error;
    }
    const verifiedCustomer = body.authToken
      ? await verifyFirebaseIdToken(body.authToken)
      : null;
    const analyticsRevocationToken = body.analyticsContext?.clientId
      ? crypto.randomBytes(32).toString("base64url")
      : undefined;
    const analyticsRevocationTokenHash = analyticsRevocationToken
      ? hashToken(analyticsRevocationToken)
      : undefined;

    const creation = await commitCheckoutOrder({
      db,
      body,
      priced,
      customerId: verifiedCustomer?.uid,
      analyticsRevocationTokenHash,
      checkoutRequestId,
      payloadFingerprint,
    });
    if (!creation.created) {
      await sendExistingOrderResponse(db, response, creation.orderId);
      return;
    }

    const sideEffects = await processOrderSideEffectsBestEffort(db, creation.orderId);

    sendJson(response, {
      orderId: creation.orderId,
      total: priced.total,
      paymentInstructions: paymentInstructionsFor(),
      analyticsRevocationToken,
      notifications: {
        status: notificationSummary(sideEffects.client, sideEffects.admin),
      },
    });
  } catch (error) {
    console.error("create-order failed", error);
    const message = error instanceof Error ? error.message : "";
    const stockOrProductError =
      message.includes("Stock insuffisant") ||
      message.includes("Produit indisponible") ||
      message.includes("Produit inactif") ||
      message.includes("produit n'est plus disponible") ||
      message.includes("Format prix fixe") ||
      message.includes("Quantite produit invalide");
    const safeBusinessError = stockOrProductError
      ? "Stock insuffisant ou produit indisponible. Veuillez ajuster votre panier avant de valider."
      : message.includes("minimum de commande") ||
      message.includes("Code promo") ||
      message.includes("code promo") ||
      message.includes("Promotion automatique") ||
      message.includes("livraison postale")
      ? message
      : "Impossible de valider la commande pour le moment. Veuillez réessayer ou contacter Verdanza par email à contact@verdanza.fr.";
    const isConflict = error instanceof CheckoutRequestConflictError;
    const invalidRequestId = message === "checkout_request_id_invalid";
    sendJson(
      response,
      {
        error: isConflict
          ? "Cette tentative ne correspond plus au panier initial. Verifiez vos commandes avant de recommencer."
          : invalidRequestId
            ? "Tentative de commande invalide. Rechargez la page avant de reessayer."
            : safeBusinessError,
      },
      isConflict ? 409 : 400,
    );
  }
}

export async function commitCheckoutOrder(input: {
  db: FirebaseFirestore.Firestore;
  body: CheckoutRequestBody;
  priced: PricedCheckout;
  checkoutRequestId: string;
  payloadFingerprint: string;
  customerId?: string;
  analyticsRevocationTokenHash?: string;
  orderId?: string;
}) {
  const {
    db,
    body,
    priced,
    checkoutRequestId,
    payloadFingerprint,
    customerId,
    analyticsRevocationTokenHash,
  } = input;
  const normalizedRequestId = validateCheckoutRequestId(checkoutRequestId);
  const orderRef = input.orderId
    ? db.collection("orders").doc(input.orderId)
    : db.collection("orders").doc();
  const requestRef = db.collection(checkoutRequestsCollection).doc(normalizedRequestId);
  const sideEffectsRef = db.collection(orderSideEffectsCollection).doc(orderRef.id);

  return db.runTransaction(async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (requestSnapshot.exists) {
      const existing = requestSnapshot.data() || {};
      if (existing.payloadFingerprint !== payloadFingerprint || !existing.orderId) {
        throw new CheckoutRequestConflictError();
      }
      return { created: false, orderId: String(existing.orderId) };
    }

    const couponRef = priced.couponId
      ? db.collection("coupons").doc(priced.couponId)
      : null;
    const couponSnapshot = couponRef ? await transaction.get(couponRef) : null;
    const automaticCouponReads = await Promise.all(
      priced.appliedPromotions
        .filter((promotion) => promotion.couponId && promotion.couponId !== priced.couponId)
        .map(async (promotion) => {
          const promotionRef = db.collection("coupons").doc(promotion.couponId as string);
          const promotionSnapshot = await transaction.get(promotionRef);
          return { couponSnapshot: promotionSnapshot };
        }),
    );
    const productReads = await Promise.all(
      Array.from(new Set(priced.orderItems.map((item) => item.productId))).map(
        async (productId) => {
          const productRef = db.collection("products").doc(productId);
          const productSnapshot = await transaction.get(productRef);
          return { productId, productRef, productSnapshot };
        },
      ),
    );

    if (couponRef && couponSnapshot) {
      const coupon = couponSnapshot.data();
      if (!couponSnapshot.exists || coupon?.isActive === false || coupon?.isArchived === true) {
        throw new Error("Code promo invalide.");
      }
      if (coupon?.maxUses && Number(coupon.usedCount || 0) >= Number(coupon.maxUses)) {
        throw new Error("Code promo deja utilise au maximum.");
      }
    }
    for (const { couponSnapshot: automaticSnapshot } of automaticCouponReads) {
      const coupon = automaticSnapshot.data();
      if (!automaticSnapshot.exists || coupon?.isActive === false || coupon?.isArchived === true) {
        throw new Error("Promotion automatique invalide.");
      }
      if (coupon?.maxUses && Number(coupon.usedCount || 0) >= Number(coupon.maxUses)) {
        throw new Error("Promotion automatique utilisee au maximum.");
      }
    }

    for (const { productId, productRef, productSnapshot } of productReads) {
      const matchingItems = priced.orderItems.filter((item) => item.productId === productId);
      const requestedQuantity = matchingItems.reduce(
        (sum, item) => sum + Number(item.quantity || 0),
        0,
      );
      const productName = matchingItems[0]?.name || productId;
      if (!productSnapshot.exists) {
        throw new Error(`Produit indisponible : ${productName}.`);
      }

      const data = productSnapshot.data();
      const stock = Number(data?.stock ?? 0);
      if (data?.isActive !== true) {
        throw new Error(`Produit indisponible : ${productName}.`);
      }
      if (stock < requestedQuantity) {
        throw new Error(`Stock insuffisant pour ${productName}.`);
      }
      for (const item of matchingItems.filter((entry) => entry.purchaseMode === "fixed_price")) {
        const product = { id: productSnapshot.id, ...data } as Product;
        assertFixedPriceOrderItemStillMatchesProduct(item, product);
      }

      transaction.update(productRef, {
        stock: stock - requestedQuantity,
        updatedAt: FieldValue.serverTimestamp(),
      });
      for (const item of matchingItems) {
        transaction.set(db.collection("stockMovements").doc(), {
          productId: item.productId,
          productName: item.name,
          type: "sale",
          quantity: -item.quantity,
          note: `Commande manuelle ${orderRef.id}`,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: "manual-checkout",
          orderId: orderRef.id,
        });
      }
    }

    if (priced.couponCode) {
      transaction.set(
        db.collection("coupons").doc(priced.couponId || priced.couponCode.toLowerCase()),
        {
          usedCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    for (const promotion of priced.appliedPromotions) {
      if (!promotion.couponId || promotion.couponId === priced.couponId) continue;
      transaction.set(
        db.collection("coupons").doc(promotion.couponId),
        {
          usedCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    transaction.set(
      orderRef,
      orderPayload(
        { ...body, checkoutRequestId: normalizedRequestId },
        priced,
        customerId,
        analyticsRevocationTokenHash,
      ),
    );
    transaction.set(
      requestRef,
      checkoutRequestDocument(orderRef.id, payloadFingerprint),
    );
    transaction.set(sideEffectsRef, orderSideEffectsDocument(orderRef.id));
    return { created: true, orderId: orderRef.id };
  });
}

async function processOrderSideEffectsBestEffort(
  db: FirebaseFirestore.Firestore,
  orderId: string,
) {
  const effects = await Promise.allSettled([
    processDraftInvoiceSideEffect(db, orderId),
    runEmailSideEffect({
      db,
      orderId,
      task: "customer_confirmation_email",
      prefix: "orderConfirmation",
      send: sendManualOrderConfirmationEmail,
    }),
    runEmailSideEffect({
      db,
      orderId,
      task: "admin_notification_email",
      prefix: "adminNotification",
      send: sendAdminManualOrderEmail,
    }),
    sendOrderCreationAlerts(db, orderId),
  ]);
  const client = effects[1].status === "fulfilled"
    ? effects[1].value
    : { status: "failed" as const, reason: "network_error" };
  const admin = effects[2].status === "fulfilled"
    ? effects[2].value
    : { status: "failed" as const, reason: "network_error" };
  if (effects.some((result) => result.status === "rejected")) {
    console.warn("Order side effects incomplete", { orderId });
  }
  return { client, admin };
}

async function processDraftInvoiceSideEffect(
  db: FirebaseFirestore.Firestore,
  orderId: string,
) {
  const claimed = await claimOrderSideEffectTask(db, orderId, "draft_invoice");
  if (!claimed) return { status: "skipped" as const, reason: "task_not_claimed" };
  const snapshot = await db.collection("orders").doc(orderId).get();
  if (!snapshot.exists) {
    const missing = { status: "failed" as const, reason: "order_missing" };
    await persistOrderSideEffectResult(db, orderId, "draft_invoice", missing);
    return missing;
  }
  const order = { id: snapshot.id, ...snapshot.data() } as Order;
  try {
    await createDraftInvoiceForOrder(db, order);
    const result = { status: "sent" as const };
    await persistOrderSideEffectResult(db, orderId, "draft_invoice", result);
    return result;
  } catch {
    const result = { status: "failed" as const, reason: "invoice_failed" };
    await persistOrderSideEffectResult(db, orderId, "draft_invoice", result);
    return result;
  }
}

async function sendExistingOrderResponse(
  db: FirebaseFirestore.Firestore,
  response: VercelResponseLike,
  orderId: string,
) {
  const snapshot = await db.collection("orders").doc(orderId).get();
  if (!snapshot.exists) throw new CheckoutRequestConflictError();
  const order = { id: snapshot.id, ...snapshot.data() } as Order;
  const client = storedEmailResult(order.emails?.orderConfirmationStatus);
  const admin = storedEmailResult(order.emails?.adminNotificationStatus);
  sendJson(response, {
    orderId,
    total: Number(order.total || 0),
    paymentInstructions: order.paymentInstructions,
    notifications: { status: notificationSummary(client, admin) },
  });
}

function storedEmailResult(status?: "sent" | "partial" | "failed" | "skipped") {
  if (!status) return undefined;
  if (status === "sent") return { status } as const;
  if (status === "partial") {
    return { status, reason: "partial_delivery", recipients: {} } as const;
  }
  return { status, reason: status === "skipped" ? "config_missing" : "email_delivery_failed" } as const;
}

export function assertFixedPriceOrderItemStillMatchesProduct(
  item: Order["items"][number],
  product: Product,
) {
  if (item.purchaseMode !== "fixed_price") return;
  const option = resolveFixedPriceOptions(product).find(
    (entry) => entry.id === item.fixedPriceOptionId,
  );
  if (!option) {
    throw new Error(`Format prix fixe indisponible pour ${item.name}.`);
  }
  const expectedQuantity = Number(item.fixedPriceQuantity || 0);
  const expectedTotal = fixedPriceLineTotal(option, expectedQuantity);
  if (
    option.quantityGrams !== item.fixedPriceGrams ||
    option.totalPrice !== item.fixedPriceTotal ||
    expectedTotal !== item.lineTotal ||
    fixedPriceEffectiveUnitPrice(option) !== item.unitPrice
  ) {
    throw new Error(`Format prix fixe modifie pour ${item.name}.`);
  }
}

function hashToken(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function createDraftInvoiceForOrder(
  db: FirebaseFirestore.Firestore,
  order: Order,
) {
  const existing = await db.collection("invoices").where("orderId", "==", order.id).limit(1).get();
  if (!existing.empty) return;
  const invoiceNumber = await nextInvoiceNumber(db);
  const now = new Date().toISOString();
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
    lines: buildCustomerInvoiceLines(order),
    subtotal: Number(order.subtotal || 0),
    deliveryFee: Number(order.deliveryFee || 0),
    discountAmount: Number(order.discountAmount || 0),
    appliedPromotions: order.appliedPromotions || [],
    total: Number(order.total || 0),
    paymentMethod: preferredPaymentMethodLabel(order.preferredPaymentMethod),
    paymentStatus: order.paymentStatus || "to_confirm",
    internalNote: "",
    createdAt: now,
    updatedAt: now,
  };
  await invoiceRef.set(invoice);
  await db.collection("orders").doc(order.id).update({
    invoiceId: invoiceRef.id,
    invoiceNumber,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function nextInvoiceNumber(db: FirebaseFirestore.Firestore) {
  const year = new Date().getFullYear();
  const counterRef = db.collection("counters").doc(`invoices-${year}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(counterRef);
    const current = Number(snapshot.data()?.value || 0);
    const next = current + 1;
    transaction.set(
      counterRef,
      {
        value: next,
        year,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return `VER-${year}-${String(next).padStart(4, "0")}`;
  });
}

function preferredPaymentMethodLabel(method?: Order["preferredPaymentMethod"]) {
  if (method === "card_payment_link") {
    return "Carte bancaire via lien de paiement après confirmation";
  }
  if (method === "cash_on_delivery") return "Espèces à la livraison locale";
  if (method === "bank_transfer") return "Virement bancaire";
  if (method === "local_delivery_payment") return "Paiement à la livraison locale";
  return "À confirmer avec Verdanza";
}
