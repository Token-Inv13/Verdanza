import { orderFromSnapshot } from "./_server/orderProtection.js";
import { commitCheckoutOrder } from "./_server/checkoutOrder.js";
export { commitCheckoutOrder, assertFixedPriceOrderItemStillMatchesProduct } from "./_server/checkoutOrder.js";
import { FieldValue } from "firebase-admin/firestore";
import crypto from "node:crypto";
import { getAdminDb, getAdminProjectId } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import {
  parseCheckoutBody,
  priceCheckout,
  type PricedCheckout,
} from "./_server/checkout.js";
import { createCheckoutIdentityResolver } from "./_server/checkoutIdentity.js";
import { verifyFirebaseIdToken } from "./_server/adminAuth.js";
import { CagnotteCheckoutError } from "./_server/cagnotteCheckout.js";
import { CAGNOTTE_RESERVATION_PROGRAM, CagnotteReservationError } from "./_server/cagnotteReservations.js";
import type { CagnotteReservationProgram } from "./_server/cagnotteReservationTypes.js";
import { CAGNOTTE_SERVER_PROGRAM } from "./_server/cagnotteProgram.js";
import type { CagnotteAccrualProgram } from "./_server/cagnotteLedgerTypes.js";
import { orderPaymentAmount } from "./_server/cagnotteOrders.js";
import { resolveCheckoutRateLimitPolicy } from "./_server/checkoutRateLimitPolicy.js";
import {
  sendAdminManualOrderEmail,
  sendManualOrderConfirmationEmail,
} from "./_server/email.js";
import { sendOrderCreationAlerts } from "./_server/orderAlerts.js";
import {
  CheckoutRequestConflictError,
  checkoutPayloadFingerprint,
  claimOrderSideEffectTask,
  findCheckoutRequest,
  notificationSummary,
  persistOrderSideEffectResult,
  runEmailSideEffect,
  validateCheckoutRequestId,
} from "./_server/orderSideEffects.js";
import {
  assessPublicSubmissionTrap,
  enforcePublicSubmissionRateLimit,
  isRateLimitInfrastructureFailure,
  sendCheckoutSecurityUnavailableResponse,
  sendPublicRateLimitResponse,
  sendPublicSubmissionTrapResponse,
} from "./_server/publicRateLimit.js";
import { buildCustomerInvoiceLines } from "../src/lib/customerInvoiceLines.js";
import { buildOrderFinancingDocumentSnapshot } from "../src/lib/orderFinancing.js";
import type { Invoice, Order } from "../src/types/index.js";

export function createOrderHandler(dependencies: {
  getDb: typeof getAdminDb;
  verifyToken: typeof verifyFirebaseIdToken;
  accrualProgram?: CagnotteAccrualProgram | null;
  reservationProgram?: CagnotteReservationProgram | null;
  getFirebaseProjectId?: () => string | null;
  now?: () => number;
  processSideEffects?: typeof processOrderSideEffectsBestEffort;
  enforceRateLimit?: typeof enforcePublicSubmissionRateLimit;
}) {
return async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "POST")) return;

  try {
    const requestBody =
      typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const body = parseCheckoutBody(requestBody);
    const operationNowEpochMs = (dependencies.now ?? Date.now)();
    const accrualProgram = dependencies.accrualProgram === undefined
      ? CAGNOTTE_SERVER_PROGRAM
      : dependencies.accrualProgram;
    const reservationProgram = dependencies.reservationProgram === undefined
      ? CAGNOTTE_RESERVATION_PROGRAM
      : dependencies.reservationProgram;
    const firebaseProjectId = accrualProgram || reservationProgram
      ? dependencies.getFirebaseProjectId?.()
      : null;
    const checkoutRequestId = validateCheckoutRequestId(body.checkoutRequestId);
    body.checkoutRequestId = checkoutRequestId;
    const payloadFingerprint = checkoutPayloadFingerprint(body);
    const db = dependencies.getDb();
    const verifiedUid = createCheckoutIdentityResolver(body.authToken, dependencies.verifyToken);
    const existingRequest = await findCheckoutRequest(
      db,
      checkoutRequestId,
      payloadFingerprint,
      verifiedUid,
    );
    if (existingRequest) {
      await sendExistingOrderResponse(db, response, existingRequest.orderId, verifiedUid);
      return;
    }
    const requestedCagnotteCents = Number(body.cagnotteUse?.requestedCents || 0);
    let verifiedCustomerId: string | undefined;
    if (requestedCagnotteCents > 0) {
      verifiedCustomerId = await verifiedUid();
      if (!body.authToken || !verifiedCustomerId) {
        throw new CagnotteCheckoutError("AUTH_REQUIRED", "Authentification requise pour utiliser la cagnotte.");
      }
      if (!reservationProgram) {
        throw new CagnotteCheckoutError("RESERVATIONS_DISABLED", "L’utilisation de la cagnotte est désactivée.");
      }
    }
    if (accrualProgram && body.authToken && !verifiedCustomerId) {
      verifiedCustomerId = await verifiedUid();
    }

    const checkoutRateLimitPolicy = resolveCheckoutRateLimitPolicy({
      verifiedUid: verifiedCustomerId,
      requestedCagnotteCents,
      accrualProgram,
      reservationProgram,
      firebaseProjectId,
      operationNowEpochMs,
    });

    const trap = assessPublicSubmissionTrap({
      honeypot: body.company,
      context: body.submissionSecurity,
      nowMs: operationNowEpochMs,
    });
    if (trap) {
      sendPublicSubmissionTrapResponse(
        response,
        "/api/create-order",
        Boolean(body.authToken),
        trap,
      );
      return;
    }

    const rateLimitInput = {
      route: "/api/create-order" as const,
      request,
      email: body.customer.email,
      anonymousId: body.submissionSecurity?.anonymousId,
      authenticated: Boolean(body.authToken),
      failurePolicy: checkoutRateLimitPolicy.failurePolicy,
      attemptId: checkoutRequestId,
      attemptPayloadFingerprint: payloadFingerprint,
      nowMs: operationNowEpochMs,
      db,
    };
    const rateLimit = dependencies.enforceRateLimit
      ? await dependencies.enforceRateLimit(rateLimitInput)
      : await enforcePublicSubmissionRateLimit(rateLimitInput);
    if (!rateLimit.allowed) {
      if (
        checkoutRateLimitPolicy.failurePolicy === "fail_closed" &&
        isRateLimitInfrastructureFailure(rateLimit.code)
      ) {
        sendCheckoutSecurityUnavailableResponse(response, rateLimit, {
          authenticated: Boolean(verifiedCustomerId),
          cagnotteMode: checkoutRateLimitPolicy.cagnotteMode,
          nowMs: operationNowEpochMs,
        });
        return;
      }
      sendPublicRateLimitResponse(response, rateLimit);
      return;
    }

    let priced: PricedCheckout;
    try {
      priced = await priceCheckout(db, body);
      if (
        priced.giftPromotions.some(
          (promotion) =>
            promotion.selectionAdjusted &&
            body.promotionSelections?.some(
              (selection) => selection.promotionId === promotion.promotionId,
            ),
        )
      ) {
        throw new Error(
          "Le cadeau sélectionné n'est plus disponible. Le devis et les choix ont été actualisés.",
        );
      }
    } catch (error) {
      const requestCreatedDuringPricing = await findCheckoutRequest(
        db,
        checkoutRequestId,
        payloadFingerprint,
        verifiedUid,
      );
      if (requestCreatedDuringPricing) {
        await sendExistingOrderResponse(db, response, requestCreatedDuringPricing.orderId, verifiedUid);
        return;
      }
      throw error;
    }
    const customerId = verifiedCustomerId ?? await verifiedUid();
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
      customerId,
      analyticsRevocationTokenHash,
      checkoutRequestId,
      payloadFingerprint,
      accrualProgram,
      reservationProgram,
      firebaseProjectId,
      nowEpochMs: operationNowEpochMs,
    });
    if (!creation.created) {
      await sendExistingOrderResponse(db, response, creation.orderId, verifiedUid);
      return;
    }

    const sideEffects = await (dependencies.processSideEffects ?? processOrderSideEffectsBestEffort)(db, creation.orderId);
    const storedOrder = orderFromSnapshot(await db.collection("orders").doc(creation.orderId).get());

    sendJson(response, {
      orderId: creation.orderId,
      ...checkoutCreationResult(storedOrder),
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
      message.includes("livraison postale") ||
      message.toLowerCase().includes("adresse") ||
      message.includes("zone de livraison")
      ? message
      : "Impossible de valider la commande pour le moment. Veuillez réessayer ou contacter Verdanza par email à contact@verdanza.fr.";
    const isConflict = error instanceof CheckoutRequestConflictError ||
      error instanceof CagnotteReservationError ||
      (error instanceof CagnotteCheckoutError && error.code !== "AUTH_REQUIRED");
    const authenticationRequired = error instanceof CagnotteCheckoutError && error.code === "AUTH_REQUIRED";
    const invalidRequestId = message === "checkout_request_id_invalid";
    const code = error instanceof CheckoutRequestConflictError
      ? "checkout_request_conflict"
      : error instanceof CagnotteCheckoutError
        ? error.code
        : error instanceof CagnotteReservationError
          ? `cagnotte_${error.code.toLowerCase()}`
          : invalidRequestId
            ? "checkout_request_id_invalid"
            : stockOrProductError || safeBusinessError === message
              ? "checkout_rejected"
              : "checkout_result_uncertain";
    sendJson(
      response,
      {
        code,
        error: error instanceof CagnotteCheckoutError
          ? error.message
          : isConflict
          ? "Cette tentative ne correspond plus au panier initial. Verifiez vos commandes avant de recommencer."
          : invalidRequestId
            ? "Tentative de commande invalide. Rechargez la page avant de reessayer."
            : safeBusinessError,
      },
      authenticationRequired ? 401 : isConflict ? 409 : 400,
    );
  }
}
}

export default createOrderHandler({
  getDb: getAdminDb,
  verifyToken: verifyFirebaseIdToken,
  accrualProgram: CAGNOTTE_SERVER_PROGRAM,
  reservationProgram: CAGNOTTE_RESERVATION_PROGRAM,
  getFirebaseProjectId: getAdminProjectId,
});

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
  const order = orderFromSnapshot(snapshot);
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
  verifyCustomer: () => Promise<string | undefined>,
) {
  const snapshot = await db.collection("orders").doc(orderId).get();
  if (!snapshot.exists) throw new CheckoutRequestConflictError();
  const order = orderFromSnapshot(snapshot);
  if (order.cagnotte && (await verifyCustomer() !== order.cagnotte.beneficiaryId || order.customerId !== order.cagnotte.beneficiaryId)) {
    throw new CheckoutRequestConflictError();
  }
  const client = storedEmailResult(order.emails?.orderConfirmationStatus);
  const admin = storedEmailResult(order.emails?.adminNotificationStatus);
  sendJson(response, {
    orderId,
    ...checkoutCreationResult(order),
    notifications: { status: notificationSummary(client, admin) },
  });
}

function checkoutCreationResult(order: Order) {
  const amountCents = order.cagnotteReservationIntent?.amountCents ?? 0;
  return {
    total: Number(order.total || 0),
    paymentAmount: orderPaymentAmount(order),
    paymentStatus: order.paymentStatus,
    orderStatus: order.orderStatus,
    paymentInstructions: order.paymentInstructions,
    ...(amountCents > 0 ? { cagnotteUse: { amountCents, state: "reserved" as const } } : {}),
    summary: {
      items: order.items || [],
      subtotal: Number(order.subtotal || 0),
      deliveryFee: Number(order.deliveryFee || 0),
      deliveryMethod: order.deliveryMethod,
      deliveryZone: order.deliveryZone || order.deliveryZoneId,
      deliveryNote: order.deliveryNote,
      postalFreeShippingApplied: order.postalFreeShippingApplied,
      preferredPaymentMethod: order.preferredPaymentMethod,
      couponCode: order.couponCode,
      discountAmount: Number(order.discountAmount || 0),
      appliedPromotions: order.appliedPromotions || [],
    },
  };
}

function storedEmailResult(status?: "sent" | "partial" | "failed" | "skipped") {
  if (!status) return undefined;
  if (status === "sent") return { status } as const;
  if (status === "partial") {
    return { status, reason: "partial_delivery", recipients: {} } as const;
  }
  return { status, reason: status === "skipped" ? "config_missing" : "email_delivery_failed" } as const;
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
  const financing = buildOrderFinancingDocumentSnapshot(order);
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
    ...(financing ? { financing } : {}),
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
