import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { CAGNOTTE_CALCULATION_VERSION } from "../../src/lib/cagnotteCalculations.js";
import { REFERRAL_MINIMUM_PRODUCTS_CENTS, REFERRAL_PROGRAM_VERSION, REFERRAL_SPONSOR_REWARD_CENTS, type ReferralEmailClaim, type ReferralOrderSnapshot, type ReferralRelation } from "../../src/types/referral.js";
import type { Order } from "../../src/types/index.js";
import { applyCagnotteWalletDeltas, prepareCagnotteWalletMutation, writeCagnotteWalletMutation } from "./cagnotteLedger.js";
import { CAGNOTTE_REGULARIZATION_VERSION, CAGNOTTE_RESERVATION_VERSION, type CagnotteMovement } from "./cagnotteLedgerTypes.js";
import { findPriorPaidProductOrder, ReferralError, sponsorHasDeliveredPaidOrder } from "./referralService.js";
import { canonicalReferralJson, referralSnapshotFingerprint } from "./referralSnapshot.js";

type Event = "payment" | "payment_and_delivery" | "delivery" | "refund" | "correction";
type Program = { mode: "off" | "drain" | "active"; startsAtEpochMs: number | null; operational: boolean };
export type ReferralPaymentEvidence = { referralId: string; sponsorUid: string; refereeUid: string; linkedAtEpochMs: number;
  sponsorAccount: "active" | "disabled" | "unavailable"; refereeAccount: "active" | "disabled" | "unverified" | "unavailable";
  sponsorEmail?: string; refereeEmail?: string; activeKeyVersion?: string; claimAliases?: readonly { version: string; id: string }[] };
type IneligibilityReason = NonNullable<ReferralRelation["rewardIneligibilityReason"]>;
type PreparedClaim = { reason?: IneligibilityReason; newClaim?: { ref: FirebaseFirestore.DocumentReference; value: ReferralEmailClaim } };
async function prepareCurrentRefereeClaim(input: { db: Firestore; transaction: Transaction; before: ReferralRelation;
  evidence?: ReferralPaymentEvidence; recordedAtEpochMs: number }): Promise<PreparedClaim> {
  const { db, transaction: tx, before, evidence } = input;
  if (!evidence || evidence.referralId !== before.refereeUid || evidence.refereeUid !== before.refereeUid ||
      evidence.sponsorUid !== before.sponsorUid || evidence.linkedAtEpochMs !== before.linkedAtEpochMs)
    return { reason: "referral_identity_changed" };
  if (evidence.refereeAccount === "disabled" || evidence.refereeAccount === "unverified") return { reason: "referee_email_unverified" };
  if (evidence.refereeAccount !== "active" || !evidence.refereeEmail || !evidence.activeKeyVersion || !evidence.claimAliases?.length)
    return { reason: "referee_identity_unavailable" };
  const aliases = evidence.claimAliases;
  const refs = aliases.map((alias) => db.collection("referralEmailClaims").doc(alias.id));
  const docs = await tx.getAll(...refs);
  if (docs.some((doc, index) => doc.exists && (doc.data()?.refereeUid !== before.refereeUid || doc.data()?.referralId !== before.refereeUid ||
      doc.data()?.schemaVersion !== 1 || doc.data()?.programVersion !== REFERRAL_PROGRAM_VERSION || doc.data()?.keyVersion !== aliases[index].version)))
    return { reason: "referee_email_claimed" };
  const activeIndex = aliases.findIndex((alias) => alias.version === evidence.activeKeyVersion);
  if (activeIndex < 0) return { reason: "referee_identity_unavailable" };
  return docs[activeIndex].exists ? {} : { newClaim: { ref: refs[activeIndex], value: { schemaVersion: 1,
    programVersion: REFERRAL_PROGRAM_VERSION, keyVersion: evidence.activeKeyVersion, refereeUid: before.refereeUid,
    referralId: before.refereeUid, createdAtEpochMs: input.recordedAtEpochMs } } };
}
type Input = { db: Firestore; transaction: Transaction; order: Order; program: Program; event: Event; recordedAtEpochMs: number;
  refundId?: string; cumulativeReturnedProductsCents?: number; paymentEvidence?: ReferralPaymentEvidence };
const cents = (value: number) => Number.isSafeInteger(value) && value >= 0;
const key = (orderId: string, event: string) => createHash("sha256").update(`referral-v1\0${orderId}\0${event}`).digest("hex");

/** A first paid product order closes an unconsumed link even when checkout applied no referral discount. */
export async function prepareFirstPaymentWithoutReferral(input: { db: Firestore; transaction: Transaction; order: Order; program: Program;
  paymentEvidence?: ReferralPaymentEvidence; recordedAtEpochMs: number }) {
  if (!input.program.operational || input.program.mode === "off" || input.order.referral ||
      input.order.productionFixture || !input.order.customerId ||
      !Array.isArray(input.order.items) || input.order.items.length === 0 ||
      input.order.items.some((item) => typeof item.productId !== "string" || !item.productId || !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) return null;
  const relationRef = input.db.collection("referrals").doc(input.order.customerId);
  const doc = await input.transaction.get(relationRef);
  if (!doc.exists) return null;
  const before = doc.data() as ReferralRelation;
  if (before.refereeUid !== input.order.customerId || before.schemaVersion !== 1 || before.programVersion !== REFERRAL_PROGRAM_VERSION)
    throw new ReferralError("referral_relation_corrupt");
  if (before.state !== "linked" || before.qualifyingOrderId !== null) return null;
  if (before.paymentConfirmed || before.rewardCompartment !== "none") throw new ReferralError("referral_relation_corrupt");
  const claim = await prepareCurrentRefereeClaim({ db: input.db, transaction: input.transaction, before,
    evidence: input.paymentEvidence, recordedAtEpochMs: input.recordedAtEpochMs });
  return { status: "applied" as const, write() { input.transaction.set(relationRef, { ...before, state: "cancelled", paymentConfirmed: true,
    qualifyingOrderId: input.order.id, rewardIneligibilityReason: claim.reason ?? "first_paid_order_without_referral_discount" } satisfies ReferralRelation);
    if (claim.newClaim) input.transaction.create(claim.newClaim.ref, claim.newClaim.value);
  } };
}

export function validateReferralOrderSnapshot(order: Order): ReferralOrderSnapshot {
  const snapshot = order.referral;
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.programVersion !== REFERRAL_PROGRAM_VERSION ||
    snapshot.referralId !== order.customerId || snapshot.thresholdCents !== REFERRAL_MINIMUM_PRODUCTS_CENTS ||
    snapshot.refereeDiscountCents !== 500 || !cents(snapshot.createdAtEpochMs) ||
    !cents(snapshot.eligibleProductsBeforeReferralCents) || snapshot.eligibleProductsBeforeReferralCents < snapshot.thresholdCents ||
    !Array.isArray(snapshot.lines) || !snapshot.lines.length || typeof snapshot.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(snapshot.fingerprint)) throw new ReferralError("referral_snapshot_invalid");
  const ids = new Set<string>(); let total = 0; let discount = 0;
  for (const line of snapshot.lines) {
    if (typeof line.lineId !== "string" || !line.lineId || ids.has(line.lineId) || !cents(line.eligibleBeforeReferralCents) ||
      line.eligibleBeforeReferralCents === 0 || !cents(line.referralDiscountCents) ||
      line.referralDiscountCents >= line.eligibleBeforeReferralCents) throw new ReferralError("referral_snapshot_invalid");
    ids.add(line.lineId); total += line.eligibleBeforeReferralCents; discount += line.referralDiscountCents;
  }
  const { fingerprint, ...facts } = snapshot;
  if (total !== snapshot.eligibleProductsBeforeReferralCents || discount !== snapshot.refereeDiscountCents ||
    referralSnapshotFingerprint(facts) !== fingerprint) throw new ReferralError("referral_snapshot_invalid");
  return snapshot;
}

/** Read phase only. Caller invokes write after every other transactional read. */
export async function prepareReferralTransition(input: Input) {
  if (!input.order.referral) return null;
  const snapshot = validateReferralOrderSnapshot(input.order);
  if (!input.program.operational || input.program.mode === "off" || input.program.startsAtEpochMs === null ||
    snapshot.createdAtEpochMs < input.program.startsAtEpochMs) throw new ReferralError("referral_program_disabled", 503);
  if (!cents(input.recordedAtEpochMs)) throw new ReferralError("referral_event_invalid");
  const relationRef = input.db.collection("referrals").doc(snapshot.referralId);
  const relationDoc = await input.transaction.get(relationRef);
  if (!relationDoc.exists) throw new ReferralError("referral_relation_missing");
  const before = relationDoc.data() as ReferralRelation;
  if (before.schemaVersion !== 1 || before.programVersion !== REFERRAL_PROGRAM_VERSION || before.refereeUid !== snapshot.referralId ||
    typeof before.sponsorUid !== "string" || !before.sponsorUid || before.sponsorUid === before.refereeUid ||
    !["linked", "pending", "rewarded", "cancelled", "reversed"].includes(before.state)) throw new ReferralError("referral_relation_conflict");
  if (!cents(before.cumulativeReturnedProductsCents) ||
    !before.processedRefunds || typeof before.processedRefunds !== "object" || Array.isArray(before.processedRefunds) ||
    Object.values(before.processedRefunds).some((value) => !cents(value)) ||
    before.paymentConfirmed !== (before.qualifyingOrderId !== null) || before.deliveryConfirmed !== (before.deliveredOrderId !== null) ||
    (before.deliveredOrderId !== null && (before.qualifyingOrderId === null || before.deliveredOrderId !== before.qualifyingOrderId)) ||
    (before.state === "linked" && (before.paymentConfirmed || before.deliveryConfirmed || before.rewardCompartment !== "none")) ||
    (before.state === "pending" && (!before.paymentConfirmed || before.deliveryConfirmed || before.rewardCompartment !== "pending")) ||
    (before.state === "rewarded" && (!before.paymentConfirmed || !before.deliveryConfirmed || before.rewardCompartment !== "available")) ||
    (before.state === "cancelled" && (!before.paymentConfirmed || before.rewardCompartment !== "none")) ||
    (before.state === "reversed" && (!before.paymentConfirmed || !before.deliveryConfirmed || before.rewardCompartment !== "none")) ||
    (before.rewardIneligibilityReason !== undefined && !["sponsor_no_longer_eligible", "sponsor_account_disabled", "sponsor_identity_unavailable", "first_paid_order_without_referral_discount", "prior_paid_order_detected", "referral_history_inconclusive", "referee_identity_unavailable", "referee_email_unverified", "referee_email_claimed", "self_referral_at_payment", "referral_identity_changed"].includes(before.rewardIneligibilityReason)) ||
    (before.rewardIneligibilityReason !== undefined && (!before.paymentConfirmed || before.rewardCompartment !== "none")))
    throw new ReferralError("referral_relation_corrupt");
  // A second discounted order cannot become paid after another order consumed the right.
  // Its delivery, cancellation and refund workflows remain independent.
  if (before.qualifyingOrderId !== null && before.qualifyingOrderId !== input.order.id) {
    if (input.event === "payment" || input.event === "payment_and_delivery")
      throw new ReferralError("referral_discount_already_consumed");
    return { status: "already_applied" as const, write() {} };
  }
  if (before.qualifyingOrderId === null && input.event !== "payment" && input.event !== "payment_and_delivery")
    return { status: "already_applied" as const, write() {} };
  if (before.cumulativeReturnedProductsCents > snapshot.eligibleProductsBeforeReferralCents) throw new ReferralError("referral_relation_corrupt");
  const next = structuredClone(before);
  let newClaim: { ref: FirebaseFirestore.DocumentReference; value: ReferralEmailClaim } | null = null;
  const normalEvent = input.event === "payment" || input.event === "payment_and_delivery" || input.event === "delivery";
  if (input.event === "payment" || input.event === "payment_and_delivery") {
    if (before.paymentConfirmed && (input.event === "payment" || before.deliveryConfirmed)) return { status: "already_applied" as const, write() {} };
    if (!before.paymentConfirmed) {
      const evidence = input.paymentEvidence;
      const history = await findPriorPaidProductOrder(input.transaction, input.db, before.refereeUid, input.order.id,
        evidence?.refereeAccount === "active" && typeof input.order.customerEmail === "string" &&
          input.order.customerEmail.trim().toLowerCase() === evidence.refereeEmail ? input.order.customerEmail.trim() : undefined,
        evidence?.refereeAccount === "active" ? evidence.refereeEmail : undefined);
      if (history.kind === "found") throw new ReferralError("referral_discount_already_consumed");
      if (history.kind === "inconclusive") throw new ReferralError("referral_history_inconclusive");
      const claim = await prepareCurrentRefereeClaim({ db: input.db, transaction: input.transaction, before,
        evidence, recordedAtEpochMs: input.recordedAtEpochMs });
      if (claim.reason) throw new ReferralError(claim.reason);
      if (evidence?.sponsorEmail && evidence.refereeEmail === evidence.sponsorEmail)
        throw new ReferralError("self_referral_at_payment");
      newClaim = claim.newClaim ?? null;
      if (evidence?.sponsorAccount === "active") {
        if (!await sponsorHasDeliveredPaidOrder(input.transaction, input.db, before.sponsorUid))
          next.rewardIneligibilityReason = "sponsor_no_longer_eligible";
      } else if (evidence?.sponsorAccount === "disabled") next.rewardIneligibilityReason = "sponsor_account_disabled";
      else next.rewardIneligibilityReason = "sponsor_identity_unavailable";
    }
    next.paymentConfirmed = true;
    next.qualifyingOrderId = input.order.id;
    if (input.event === "payment_and_delivery") {
      next.deliveryConfirmed = true;
      next.deliveredOrderId = input.order.id;
    }
  } else if (input.event === "delivery") {
    if (before.deliveryConfirmed) return { status: "already_applied" as const, write() {} };
    next.deliveryConfirmed = true;
    next.deliveredOrderId = input.order.id;
  } else {
    if (!before.paymentConfirmed) throw new ReferralError("referral_payment_required");
    if (!input.refundId || !/^[A-Za-z0-9._:@+-]{1,128}$/.test(input.refundId) || !cents(input.cumulativeReturnedProductsCents!)) throw new ReferralError("referral_refund_invalid");
    if (input.event === "refund" && input.cumulativeReturnedProductsCents! < before.cumulativeReturnedProductsCents) throw new ReferralError("referral_refund_invalid");
    const prior = next.processedRefunds[input.refundId];
    if (prior !== undefined) {
      if (prior !== input.cumulativeReturnedProductsCents) throw new ReferralError("referral_refund_conflict");
      return { status: "already_applied" as const, write() {} };
    }
    next.processedRefunds = { ...next.processedRefunds, [input.refundId]: input.cumulativeReturnedProductsCents! };
    next.cumulativeReturnedProductsCents = input.cumulativeReturnedProductsCents!;
  }
  if (next.cumulativeReturnedProductsCents > snapshot.eligibleProductsBeforeReferralCents) throw new ReferralError("referral_refund_invalid");
  const retained = snapshot.eligibleProductsBeforeReferralCents - next.cumulativeReturnedProductsCents;
  const shouldReward = next.paymentConfirmed && !next.rewardIneligibilityReason && retained >= REFERRAL_MINIMUM_PRODUCTS_CENTS;
  const desired: ReferralRelation["rewardCompartment"] = shouldReward ? next.deliveryConfirmed ? "available" : "pending" : "none";
  if (normalEvent && (before.state === "cancelled" || before.state === "reversed") && desired !== "none")
    throw new ReferralError("referral_restore_requires_correction");
  const movements: Array<{ event: CagnotteMovement["businessEvent"]; pending: number; available: number; regularization: number; id: string }> = [];
  const move = (event: CagnotteMovement["businessEvent"], suffix: string, pending: number, available: number, regularization = 0) => movements.push({ event, pending, available, regularization, id: key(input.order.id, suffix) });
  if (next.rewardCompartment === "none" && desired !== "none") move(before.state === "reversed" || before.state === "cancelled" ? "referral_reward_restored" : "referral_reward_pending", input.event === "correction" ? `restore:${input.refundId}` : "pending", REFERRAL_SPONSOR_REWARD_CENTS, 0);
  if (next.rewardCompartment === "pending" && desired === "none") move("referral_reward_cancelled", `cancel:${input.refundId}`, -REFERRAL_SPONSOR_REWARD_CENTS, 0);
  if (next.rewardCompartment === "pending" && desired === "available") move("referral_reward_available", "available", -REFERRAL_SPONSOR_REWARD_CENTS, REFERRAL_SPONSOR_REWARD_CENTS);
  if (next.rewardCompartment === "available" && desired === "none") move("referral_reward_reversed", `reverse:${input.refundId}`, 0, -REFERRAL_SPONSOR_REWARD_CENTS);
  // Payment of an already delivered order emits both movements atomically.
  if (next.rewardCompartment === "none" && desired === "available") move("referral_reward_available", before.state === "reversed" || before.state === "cancelled" ? `available:restore:${input.refundId}` : "available", -REFERRAL_SPONSOR_REWARD_CENTS, REFERRAL_SPONSOR_REWARD_CENTS);
  const movementRefs = movements.map((entry) => input.db.collection("cagnotteMovements").doc(entry.id));
  const movementDocs = movementRefs.length ? await input.transaction.getAll(...movementRefs) : [];
  if (movementDocs.some((doc) => doc.exists)) throw new ReferralError("referral_movement_conflict");
  const wallet = movements.length ? await prepareCagnotteWalletMutation({ db: input.db, transaction: input.transaction, beneficiaryId: before.sponsorUid,
    allowMissing: before.state === "linked" && before.rewardCompartment === "none" }) : null;
  const output: CagnotteMovement[] = [];
  for (const entry of movements) {
    let available = entry.available; let regularization = entry.regularization;
    if (!wallet) throw new ReferralError("referral_wallet_missing");
    if (entry.event === "referral_reward_reversed") { available = -Math.min(wallet.current.availableCents, REFERRAL_SPONSOR_REWARD_CENTS); regularization = REFERRAL_SPONSOR_REWARD_CENTS + available; }
    if (entry.event === "referral_reward_available") { const compensation = Math.min(wallet.current.regularizationCents, REFERRAL_SPONSOR_REWARD_CENTS); available -= compensation; regularization = -compensation; }
    applyCagnotteWalletDeltas(wallet, { pendingCents: entry.pending, availableCents: available, regularizationCents: regularization });
    output.push({ schemaVersion: 3, regularizationVersion: CAGNOTTE_REGULARIZATION_VERSION, reservationVersion: CAGNOTTE_RESERVATION_VERSION,
      calculationVersion: CAGNOTTE_CALCULATION_VERSION, programVersion: REFERRAL_PROGRAM_VERSION, currency: "EUR", origin: "internal_server",
      orderId: input.order.id, beneficiaryId: before.sponsorUid, businessEvent: entry.event, eventKey: entry.id,
      payload: canonicalReferralJson({ event: entry.event, referralId: snapshot.referralId, orderId: input.order.id, refundId: input.refundId ?? null,
        ...(input.event === "refund" ? { cause: "refund" } : input.event === "correction" ? { cause: "refund_correction" } : {}),
        cumulativeReturnedProductsCents: next.cumulativeReturnedProductsCents }), pendingDeltaCents: entry.pending, availableDeltaCents: available,
      reservedDeltaCents: 0, regularizationDeltaCents: regularization, recordedAtEpochMs: input.recordedAtEpochMs });
  }
  next.rewardCompartment = desired;
  next.state = desired === "pending" ? "pending" : desired === "available" ? "rewarded" : next.paymentConfirmed ? before.state === "rewarded" || before.state === "reversed" ? "reversed" : "cancelled" : "linked";
  let written = false;
  return { status: "applied" as const, write() {
    if (written) throw new ReferralError("referral_plan_reused"); written = true;
    input.transaction.set(relationRef, next);
    if (newClaim) input.transaction.create(newClaim.ref, newClaim.value);
    if (wallet) writeCagnotteWalletMutation(wallet);
    for (const movement of output) input.transaction.create(input.db.collection("cagnotteMovements").doc(movement.eventKey), movement);
  } };
}
