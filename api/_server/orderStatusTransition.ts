import { FieldValue } from "firebase-admin/firestore";
import { assertOrderDeletionAllowed, hasCagnotteEnrollment, orderFromSnapshot } from "./orderProtection.js";
import type { Firestore } from "firebase-admin/firestore";
import { computeWeightedSupplierCostsAsOf, resolveOrderItemPurchaseCost } from "../../src/lib/accountingCosts.js";
import { prepareOrderCancellationInTransaction } from "./orderCancellation.js";
import { enqueuePurchaseAnalyticsForPaidTransition } from "./purchaseAnalytics.js";
import { orderPaymentAmount, prepareOrderCagnotteTransition, validateOrderCagnotteEnrollment } from "./cagnotteOrders.js";
import { CAGNOTTE_RESERVATION_PROGRAM, CagnotteReservationError } from "./cagnotteReservations.js";
import { CAGNOTTE_SERVER_PROGRAM } from "./cagnotteProgram.js";
import type { CagnotteAccrualProgram } from "./cagnotteLedgerTypes.js";
import type { CagnotteReservationProgram } from "./cagnotteReservationTypes.js";
import { prepareUnpaidReviewControl, type UnpaidReviewRequest } from "./unpaidOrderReview.js";
import type { EmailResult } from "./email.js";
import type { PurchaseAnalyticsProcessResult } from "./purchaseAnalytics.js";
import type { Order, OrderStatus, PaymentStatus, ProductCost, SupplierPurchase, FinalPaymentMethod, PaymentLinkChannel } from "../../src/types/index.js";
import {
  assertCagnotteProductionFixtureStatusTransition,
  cagnotteProductionFixtureUpdatedAtForState,
  hasPersistedCagnotteProductionFixtureMarker,
  isExactCagnotteProductionFixtureOrder,
  type CagnotteProductionFixtureCapability,
} from "./cagnotteProductionFixture.js";
import { validateCagnotteProductionFixtureState } from "./cagnotteProductionFixtureState.js";
import { getReferralRuntime } from "./referralRuntimeConfig.js";
import type { ReferralRuntime } from "./referralRuntimeConfig.js";
import { prepareFirstPaymentWithoutReferral, prepareReferralTransition, validateReferralOrderSnapshot, type ReferralPaymentEvidence } from "./referralLedger.js";
import { getReferralSponsorIdentity, type ReferralSponsorIdentity } from "./referralSponsorIdentity.js";
import { normalizeReferralEmail, parseReferralEmailKeyring, referralEmailClaimAliases } from "./referralIdentity.js";

export type OrderStatusChange = {
  orderId: string; orderStatus?: OrderStatus; paymentStatus?: PaymentStatus;
  finalPaymentMethod?: FinalPaymentMethod | ""; internalNote?: string; paymentReference?: string;
  paymentLinkUrl?: string; paymentLinkLabel?: string; paymentLinkAmount?: number; paymentLinkCurrency?: "EUR";
  paymentLinkSent?: boolean; paymentLinkChannel?: PaymentLinkChannel | ""; trackingNumber?: string;
  archived?: boolean; hidden?: boolean; restore?: boolean; deleteCancelled?: boolean; historyNote?: string;
  unpaidReview?: UnpaidReviewRequest;
};

/** A referral discount cannot share an order with a positive cagnotte reservation or spend. */
export function hasPositiveCagnotteFinancing(order: Order): boolean {
  return (typeof order.cagnotteReservationIntent?.amountCents === "number" && order.cagnotteReservationIntent.amountCents > 0) ||
    (typeof order.cagnotte?.snapshot.appliedCagnotteCents === "number" && order.cagnotte.snapshot.appliedCagnotteCents > 0);
}

/** Actual endpoint transaction; admin is already verified by its unchanged HTTP boundary. */
export async function commitOrderStatusTransition({
  db, body, admin, accrualProgram = CAGNOTTE_SERVER_PROGRAM,
  reservationProgram = CAGNOTTE_RESERVATION_PROGRAM, firebaseProjectId,
  productionFixtureCapability,
  referralProgram,
  getSponsorIdentity = getReferralSponsorIdentity,
  referralEmailKeyring = () => process.env.REFERRAL_EMAIL_HMAC_KEYRING_JSON ?? "",
  now = () => new Date().toISOString(),
}: {
  db: Firestore; body: OrderStatusChange; admin: {uid:string; email:string | null};
  accrualProgram?: CagnotteAccrualProgram | null;
  reservationProgram?: CagnotteReservationProgram | null;
  firebaseProjectId?: string | null;
  productionFixtureCapability?: CagnotteProductionFixtureCapability;
  referralProgram?: ReferralRuntime;
  getSponsorIdentity?: (uid: string) => Promise<ReferralSponsorIdentity>;
  referralEmailKeyring?: () => string;
  now?: ()=>string;
}): Promise<{ updatedOrder: Order | null; previousStatus: OrderStatus | null; purchaseAnalyticsQueued: boolean; missingPromotionIds: string[]; unpaidReviewContext: Awaited<ReturnType<typeof prepareUnpaidReviewControl>>["context"] | null }> {
  const operationTime=now();
  let updatedOrder: Order | null = null;
  let previousStatus: OrderStatus | null = null;
  let purchaseAnalyticsQueued = false;
  let missingPromotionIds: string[] = [];
  let unpaidReviewContext: Awaited<ReturnType<typeof prepareUnpaidReviewControl>>["context"] | null = null;
  let resolvedReferralProgram = referralProgram;
  let paymentEvidence: ReferralPaymentEvidence | undefined;
  if (body.paymentStatus === "paid") {
    const candidateSnapshot = await db.collection("orders").doc(body.orderId).get();
    if (candidateSnapshot.exists) {
      const candidate = orderFromSnapshot(candidateSnapshot);
      if (candidate.paymentStatus !== "paid" && candidate.orderStatus !== "cancelled" && !candidate.cancelledAt) {
        resolvedReferralProgram ??= getReferralRuntime();
        if (resolvedReferralProgram.operational && (candidate.referral || candidate.customerId)) {
          const referralId = candidate.referral ? validateReferralOrderSnapshot(candidate).referralId : candidate.customerId!;
          const relationDoc = await db.collection("referrals").doc(referralId).get();
          const relation = relationDoc.data();
          if (!relation && candidate.referral) throw new Error("referral_relation_missing");
          // Auth evidence is needed only while the first paid order can claim the relation.
          if (relation?.qualifyingOrderId === null && relation.state === "linked") {
            const sponsorUid = relation.sponsorUid;
            if (typeof sponsorUid !== "string" || !sponsorUid) throw new Error("referral_relation_missing");
            let sponsorAccount: ReferralPaymentEvidence["sponsorAccount"] = "unavailable";
            let refereeAccount: ReferralPaymentEvidence["refereeAccount"] = "unavailable";
            let sponsorEmail: string | undefined;
            let refereeEmail: string | undefined;
            try {
              const identity = await getSponsorIdentity(sponsorUid);
              if (identity.uid === sponsorUid) {
                sponsorAccount = identity.disabled ? "disabled" : "active";
                sponsorEmail = normalizeReferralEmail(identity.email);
              }
            } catch { /* A payment may proceed, but an unverified sponsor earns no reward. */ }
            try {
              const identity = await getSponsorIdentity(referralId);
              if (identity.uid === referralId) {
                refereeAccount = identity.disabled ? "disabled" : identity.emailVerified === true ? "active" : "unverified";
                refereeEmail = normalizeReferralEmail(identity.email);
              }
            } catch { /* Current referee identity cannot qualify a reward. */ }
            let claimAliases: ReferralPaymentEvidence["claimAliases"];
            let activeKeyVersion: string | undefined;
            if (refereeAccount === "active" && refereeEmail) {
              try {
                const keyring = parseReferralEmailKeyring(referralEmailKeyring());
                claimAliases = referralEmailClaimAliases(keyring, refereeEmail);
                activeKeyVersion = keyring.activeVersion;
              } catch { /* Missing or malformed keyring closes the reward path. */ }
            }
            paymentEvidence = { referralId, sponsorUid, refereeUid: referralId,
              linkedAtEpochMs: relation.linkedAtEpochMs, sponsorAccount, refereeAccount, sponsorEmail, refereeEmail, claimAliases, activeKeyVersion };
          }
        }
      }
    }
  }
  await db.runTransaction(async (transaction) => {
    updatedOrder = null; previousStatus = null; purchaseAnalyticsQueued = false; missingPromotionIds = []; unpaidReviewContext = null;
    let cancellationPlan: Awaited<ReturnType<typeof prepareOrderCancellationInTransaction>> | null = null;
    let writePaymentLinkEvent: (() => void) | null = null;
    const orderRef = db.collection("orders").doc(body.orderId);
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists) throw new Error("Commande introuvable.");

    const order = orderFromSnapshot(snapshot);
    const productionFixture = hasPersistedCagnotteProductionFixtureMarker(order);
    if (productionFixture && !isExactCagnotteProductionFixtureOrder(order)) {
      throw new Error("production_fixture_marker_invalid");
    }
    if (productionFixture) {
      const expectedTransition = assertCagnotteProductionFixtureStatusTransition({
        capability: productionFixtureCapability,
        order,
        body,
        operationTime,
      });
      await validateCagnotteProductionFixtureState({
        db,
        transaction,
        orderSnapshot: snapshot,
        expectedTransition,
      });
    }
    if ((hasCagnotteEnrollment(order) || Object.prototype.hasOwnProperty.call(order, "referral")) && (order.orderStatus === "cancelled" || order.cancelledAt) &&
      ((body.orderStatus && body.orderStatus !== "cancelled") || (body.paymentStatus && body.paymentStatus !== "cancelled"))) {
      throw new CagnotteReservationError("CONFLICT", "Une commande inscrite annulée ne peut pas être réactivée.");
    }
    if (body.paymentStatus === "paid" && order.paymentStatus !== "paid" && order.referral && hasPositiveCagnotteFinancing(order)) {
      throw new CagnotteReservationError("CONFLICT", "Parrainage et cagnotte incompatibles sur cette commande.");
    }
    previousStatus = order.orderStatus;
    if (body.deleteCancelled) {
      assertOrderDeletionAllowed(order);
      if (order.orderStatus !== "cancelled" || order.paymentStatus !== "cancelled") {
        throw new Error(
          "Seules les commandes annulees peuvent etre supprimees definitivement.",
        );
      }
      if (!order.stockRestoredAt) {
        throw new Error(
          "Suppression refusee: le stock de cette commande n'est pas marque comme restaure.",
        );
      }
      if (order.invoiceId || order.invoiceNumber) {
        throw new Error(
          "Suppression refusee: une facture est liee a cette commande. Archivez-la plutot.",
        );
      }
      const invoiceSnapshot = await transaction.get(
        db.collection("invoices").where("orderId", "==", order.id).limit(1),
      );
      if (!invoiceSnapshot.empty) {
        throw new Error(
          "Suppression refusee: une facture est liee a cette commande. Archivez-la plutot.",
        );
      }
      transaction.delete(orderRef);
      return;
    }

    const nextStatus = body.orderStatus ?? order.orderStatus;
    const fixtureNextPaymentStatus = body.paymentStatus ?? order.paymentStatus;
    const nextFinalPaymentMethod =
      body.finalPaymentMethod || order.finalPaymentMethod || undefined;
    const update: Record<string, unknown> = {
      updatedAt: productionFixture
        ? cagnotteProductionFixtureUpdatedAtForState(fixtureNextPaymentStatus, nextStatus)
        : FieldValue.serverTimestamp(),
    };
    if (body.unpaidReview || (body.orderStatus === "cancelled" && hasCagnotteEnrollment(order))) {
      const unpaidControl = await prepareUnpaidReviewControl({
        db, transaction, order, request: body.unpaidReview,
        cancellationRequested: body.orderStatus === "cancelled", actor: admin, now: operationTime,
      });
      unpaidReviewContext = unpaidControl.context;
      if (unpaidControl.reviewToStore) update.unpaidReview = unpaidControl.reviewToStore;
    }

    if (body.orderStatus === "cancelled") {
      if (body.paymentStatus && body.paymentStatus !== "cancelled") {
        throw new Error(
          "Une commande annulee ne peut pas conserver un reglement actif.",
        );
      }
      const cancellation = await prepareOrderCancellationInTransaction({
        db,
        transaction,
        order,
        adminUid: admin.uid,
        now: operationTime,
      });
      cancellationPlan = cancellation;
      Object.assign(update, cancellation.orderUpdate);
      missingPromotionIds = cancellation.missingPromotionIds;
    }

    if (body.internalNote !== undefined) {
      update.internalNote = body.internalNote;
    }
    if (body.paymentStatus) {
      if (body.paymentStatus === "paid" && !nextFinalPaymentMethod) {
        throw new Error("Methode de paiement finale requise avant paiement confirme.");
      }
      update.paymentStatus = body.paymentStatus;
      if (body.paymentStatus === "paid" && order.paymentStatus !== "paid") {
        const paidAt = operationTime;
        update.paidAt = paidAt;
        update.paymentConfirmedAt = paidAt;
        update.paymentConfirmedBy = admin.email;
        update.items = productionFixture
          ? order.items.map((item) => ({
              ...item,
              purchasePricePerGramSnapshot: null,
              purchaseCostTotalSnapshot: null,
              purchaseCostCapturedAt: paidAt,
            }))
          : await capturePurchaseCostSnapshots({
              db,
              transaction,
              order,
              capturedAt: paidAt,
            });
      }
    }
    if (body.finalPaymentMethod !== undefined) {
      if (
        body.finalPaymentMethod === "cash_on_delivery" &&
        order.deliveryMethod !== "local_express"
      ) {
        throw new Error("Paiement en especes reserve a la livraison locale.");
      }
      update.finalPaymentMethod = body.finalPaymentMethod || FieldValue.delete();
    }
    if (body.paymentReference !== undefined) {
      update.paymentReference = body.paymentReference;
    }
    if (body.paymentLinkUrl !== undefined) {
      update.paymentLinkUrl = body.paymentLinkUrl.trim();
    }
    if (body.paymentLinkLabel !== undefined) {
      update.paymentLinkLabel = body.paymentLinkLabel.trim() || FieldValue.delete();
    }
    if (body.paymentLinkAmount !== undefined) {
      update.paymentLinkAmount = Number(body.paymentLinkAmount) || FieldValue.delete();
    }
    if (body.paymentLinkCurrency !== undefined) {
      update.paymentLinkCurrency = body.paymentLinkCurrency || FieldValue.delete();
    }
    if (body.paymentLinkChannel !== undefined) {
      update.paymentLinkChannel = body.paymentLinkChannel || FieldValue.delete();
    }
    if (body.paymentLinkSent !== undefined) {
      if (body.paymentLinkSent && order.cagnotte?.snapshot.appliedCagnotteCents) {
        const submittedAmount = body.paymentLinkAmount ?? order.paymentLinkAmount;
        if (submittedAmount === undefined || submittedAmount !== orderPaymentAmount(order)) {
          throw new Error("Montant du lien incompatible avec le montant hors cagnotte.");
        }
      }
      update.paymentLinkSent = body.paymentLinkSent;
      update.paymentLinkSentAt = body.paymentLinkSent
        ? operationTime
        : FieldValue.delete();
      update.paymentLinkSentBy = body.paymentLinkSent ? admin.email : FieldValue.delete();
      if (body.paymentLinkSent && (!body.paymentStatus || body.paymentStatus === "payment_link_sent")) {
        Object.assign(update, preparePaymentLinkStatusTransition(order));
      }
      if (body.paymentLinkSent) {
        writePaymentLinkEvent = () => { transaction.set(db.collection("analyticsOperationalEvents").doc(), {
          event: "payment_link_sent",
          orderId: order.id,
          transaction_id: order.id,
          payment_method: "card_payment_link",
          delivery_method: order.deliveryMethod,
          value: orderPaymentAmount(order),
          currency: "EUR",
          createdAt: FieldValue.serverTimestamp(),
          createdBy: admin.uid,
        }); };
      }
    }
    if (body.trackingNumber !== undefined) {
      update.trackingNumber = body.trackingNumber;
    }
    if (body.archived !== undefined) {
      update.archived = body.archived;
      update.archivedAt = body.archived ? operationTime : FieldValue.delete();
      update.archivedBy = body.archived ? admin.email : FieldValue.delete();
    }
    if (body.hidden !== undefined) {
      update.hidden = body.hidden;
      update.hiddenAt = body.hidden ? operationTime : FieldValue.delete();
      update.hiddenBy = body.hidden ? admin.email : FieldValue.delete();
    }
    if (body.restore) {
      update.archived = false;
      update.hidden = false;
      update.archivedAt = FieldValue.delete();
      update.archivedBy = FieldValue.delete();
      update.hiddenAt = FieldValue.delete();
      update.hiddenBy = FieldValue.delete();
    }

    if (body.orderStatus && body.orderStatus !== order.orderStatus) {
      update.orderStatus = body.orderStatus;
      update.statusHistory = FieldValue.arrayUnion({
        status: body.orderStatus,
        previousStatus: order.orderStatus,
        changedAt: operationTime,
        changedBy: "admin",
        changedByUid: admin.uid,
        note: body.historyNote || "",
      });
    }

    // A link-only event must not reconcile a prior delivery or suspended accrual.
    const linkOnly = body.paymentLinkSent === true && !body.orderStatus &&
      (!body.paymentStatus || body.paymentStatus === "payment_link_sent");
    const cagnottePlan = linkOnly ? null : await prepareOrderCagnotteTransition({
      db, transaction, order, accrualProgram, reservationProgram, firebaseProjectId,
      recordedAtEpochMs: Date.parse(operationTime),
      nextOrderStatus: nextStatus,
      nextPaymentStatus: (update.paymentStatus as PaymentStatus | undefined) ?? order.paymentStatus,
      paymentConfirmationRequested: body.paymentStatus === "paid",
    });
    const paymentTransition = body.paymentStatus === "paid" && order.paymentStatus !== "paid";
    const deliveryTransition = body.orderStatus === "delivered" && order.orderStatus !== "delivered";
    const referralEvent = paymentTransition ? nextStatus === "delivered" ? "payment_and_delivery" : "payment"
      : deliveryTransition ? "delivery" : null;
    const transitionReferralProgram = linkOnly || !referralEvent ? null : resolvedReferralProgram ?? getReferralRuntime();
    const referralPlan = !transitionReferralProgram || !transitionReferralProgram.operational || transitionReferralProgram.mode === "off" ? null : order.referral ? await prepareReferralTransition({
      db, transaction, order, program: transitionReferralProgram, recordedAtEpochMs: Date.parse(operationTime),
      event: referralEvent!, paymentEvidence,
    }) : paymentTransition ? await prepareFirstPaymentWithoutReferral({ db, transaction, order,
      program: transitionReferralProgram, paymentEvidence, recordedAtEpochMs: Date.parse(operationTime) }) : null;
    if (body.paymentStatus === "paid" && order.paymentStatus !== "paid" && order.cagnotte?.snapshot.appliedCagnotteCents) {
      if (!cagnottePlan || !("reservation" in cagnottePlan) || !("ledger" in cagnottePlan) ||
        !["consumed", "already_consumed"].includes(cagnottePlan.reservation.status)) {
        throw new CagnotteReservationError("CONFLICT", "Preuve de consommation de cagnotte incohérente.");
      }
      const decision = ["applied", "already_applied"].includes(cagnottePlan.ledger.status)
        ? "attributed"
        : cagnottePlan.ledger.status === "not_eligible"
          ? "not_attributed"
          : null;
      if (!decision) throw new CagnotteReservationError("CONFLICT", "Décision d’attribution du gain incohérente.");
      update.cagnottePaymentEvidence = {
        schemaVersion: 1,
        version: "cagnotte-payment-evidence-v1",
        reservationState: "consumed",
        loyaltyAccrualDecision: decision,
        ...(decision === "not_attributed" ? { loyaltyAccrualReason: "server_program_ineligible" } : {}),
        recordedAt: operationTime,
      };
    }
    // All reads and business checks are complete. Only writes from this point on.
    cancellationPlan?.write();
    writePaymentLinkEvent?.();
    cagnottePlan?.write();
    referralPlan?.write();
    if (body.paymentStatus === "paid" && !productionFixture) {
      purchaseAnalyticsQueued = await enqueuePurchaseAnalyticsForPaidTransition({
        db,
        transaction,
        order,
        update,
      });
    }

    transaction.update(
      orderRef,
      update as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
    );
    updatedOrder = {
      ...order,
      orderStatus: nextStatus,
      paymentStatus:
        (update.paymentStatus as PaymentStatus | undefined) ??
        body.paymentStatus ??
        order.paymentStatus,
      internalNote: body.internalNote ?? order.internalNote,
      ...(typeof update.paidAt === "string" ? { paidAt: update.paidAt } : {}),
      ...(typeof update.paymentConfirmedAt === "string"
        ? { paymentConfirmedAt: update.paymentConfirmedAt }
        : {}),
      ...(update.cagnottePaymentEvidence
        ? { cagnottePaymentEvidence: update.cagnottePaymentEvidence as Order["cagnottePaymentEvidence"] }
        : {}),
    };
  });

  return {updatedOrder,previousStatus,purchaseAnalyticsQueued,missingPromotionIds,unpaidReviewContext};
}

/** Shared controlled transition, applied only after transactional reads by both callers.
 * Sending is not payment/delivery evidence and requires no cagnotte plan. */
export function preparePaymentLinkStatusTransition(order: Order): { paymentStatus: PaymentStatus } {
  if (order.deletedAt) throw new Error("order_deleted");
  if (order.orderStatus === "cancelled" || order.paymentStatus === "cancelled" || order.cancelledAt) throw new Error("order_cancelled");
  if (order.paymentStatus === "paid") throw new Error("order_already_paid");
  if (hasCagnotteEnrollment(order)) validateOrderCagnotteEnrollment(order);
  return { paymentStatus: "payment_link_sent" };
}

/** Existing post-commit work, with explicit delivery doubles in local tests. */
export async function processOrderStatusTransitionEffects(input: {
  db: Firestore; body: OrderStatusChange; committed: Awaited<ReturnType<typeof commitOrderStatusTransition>>;
  sendStatusEmail: (order: Order, previous: OrderStatus, next: OrderStatus) => Promise<EmailResult>;
  processAnalytics: (db: Firestore, orderId: string) => Promise<PurchaseAnalyticsProcessResult>;
}) {
  const { db, body, committed, sendStatusEmail, processAnalytics } = input;
  const { updatedOrder, previousStatus, purchaseAnalyticsQueued } = committed;
  if (updatedOrder && hasPersistedCagnotteProductionFixtureMarker(updatedOrder)) {
    if (!isExactCagnotteProductionFixtureOrder(updatedOrder)) {
      throw new Error("production_fixture_marker_invalid");
    }
    return null;
  }
  if (updatedOrder && body.orderStatus && previousStatus && body.orderStatus !== previousStatus) {
    const result = await sendStatusEmail(updatedOrder, previousStatus, body.orderStatus);
    if (result.status === "sent") {
      await db.collection("orders").doc(body.orderId).update({
        [`emails.statusUpdateSentAt.${body.orderStatus}`]: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
  return purchaseAnalyticsQueued ? processAnalytics(db, body.orderId) : null;
}

async function capturePurchaseCostSnapshots({
  db,
  transaction,
  order,
  capturedAt,
}: {
  db: FirebaseFirestore.Firestore;
  transaction: FirebaseFirestore.Transaction;
  order: Order;
  capturedAt: string;
}) {
  const items = order.items || [];
  const productIds = [
    ...new Set(
      items
        .filter((item) => item.purchaseCostCapturedAt === undefined)
        .map((item) => item.productId)
        .filter(Boolean),
    ),
  ];
  const supplierSnapshot = await transaction.get(
    db.collection("supplierPurchases").where("status", "==", "validated"),
  );
  const weightedSupplierCosts = computeWeightedSupplierCostsAsOf(
    supplierSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as SupplierPurchase),
    capturedAt,
  ).costByProductId;
  const missingSupplierCostIds = productIds.filter((productId) => !weightedSupplierCosts.has(productId));
  const manualCostEntries = await Promise.all(
    missingSupplierCostIds.map(async (productId) => {
      const snapshot = await transaction.get(db.collection("productCosts").doc(productId));
      const rawCost = snapshot.data()?.purchasePricePerGram;
      return [
        productId,
        { productId, purchasePricePerGram: optionalNonNegativeNumber(rawCost) },
      ] as const;
    }),
  );
  const manualCostByProductId = new Map<string, ProductCost>(manualCostEntries);

  return items.map((item) => {
    if (item.purchaseCostCapturedAt !== undefined) return item;
    const purchaseCost = resolveOrderItemPurchaseCost(
      item,
      weightedSupplierCosts,
      manualCostByProductId,
    );
    const snapshot = {
      purchasePricePerGramSnapshot: purchaseCost.pricePerGram,
      purchaseCostTotalSnapshot: purchaseCost.status === "missing" ? null : purchaseCost.cost,
      purchaseCostCapturedAt: capturedAt,
    };
    return {
      ...item,
      ...snapshot,
      ...(purchaseCost.source ? { purchaseCostSource: purchaseCost.source } : {}),
    };
  });
}

function optionalNonNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}
