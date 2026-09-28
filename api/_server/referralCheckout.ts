import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { CheckoutRequestBody, PricedCheckout } from "./checkout.js";
import type { ReferralRelation } from "../../src/types/referral.js";
import { REFERRAL_CHECKOUT_QUOTE_VERSION, type ReferralCheckoutQuote, type ReferralCheckoutAcceptance } from "../../src/types/referralCheckout.js";
import { getReferralRuntime, ReferralConfigurationError, type ReferralRuntime } from "./referralRuntimeConfig.js";
import { getReferralIdentity, type ReferralSponsorIdentity } from "./referralSponsorIdentity.js";
import { readCurrentPaymentIdentity, isValidReferralEmailIdentityClaim, type CurrentPaymentIdentity } from "./referralPaymentIdentity.js";
import { readReferralEmailBlocks } from "./referralEmailBlocks.js";
import { verifyFirebaseIdToken } from "./adminAuth.js";
import { ReferralError, findPriorPaidProductOrder } from "./referralService.js";
import { ORDER_EMAIL_MIGRATION_COLLECTION, ORDER_EMAIL_NORMALIZATION_VERSION, referralRelationIdentityHistoryStatus } from "./referralOrderEmailHistory.js";
import { canonicalReferralJson, createReferralOrderSnapshot } from "./referralSnapshot.js";
import { cagnotteOrderItemLineId, canEnrollCagnotteOrder } from "./cagnotteOrders.js";
import type { CagnotteAccrualProgram } from "./cagnotteLedgerTypes.js";
import { allocateCents, calculateLoyaltyCents } from "../../src/lib/cagnotteCalculations.js";
import { calculateExternalPaymentCents, exactEuroCents } from "../../src/lib/orderFinancing.js";

export type ReferralCheckoutDependencies = {
  referralRuntime?: () => ReferralRuntime;
  referralIdentity?: (uid: string) => Promise<ReferralSponsorIdentity>;
  referralKeyring?: () => string;
};
export type ReferralCheckoutContext = { uid: string; runtime: ReferralRuntime; identity: CurrentPaymentIdentity };
/** Invoked only for an explicit request. Closed before Auth, keyring or Firestore. */
export async function readReferralCheckoutContext(body: CheckoutRequestBody, deps: ReferralCheckoutDependencies, verify: typeof verifyFirebaseIdToken, now: number): Promise<ReferralCheckoutContext | undefined> {
  if (!body.referralUse) return undefined;
  let runtime: ReferralRuntime;
  try { runtime = (deps.referralRuntime ?? getReferralRuntime)(); }
  catch (error) { if (error instanceof ReferralConfigurationError) throw new ReferralError("referral_configuration_invalid", 503); throw error; }
  if (!runtime.operational || runtime.mode !== "active" || runtime.startsAtEpochMs === null || !Number.isSafeInteger(now) || now < runtime.startsAtEpochMs)
    throw new ReferralError("referral_program_disabled", 503);
  if (!body.authToken) throw new ReferralError("AUTH_REQUIRED", 401);
  const user = await verify(body.authToken);
  if (!user.uid || user.emailVerified !== true || !user.email) throw new ReferralError("referral_email_unverified", 401);
  const identity = await readCurrentPaymentIdentity(user.uid, deps.referralIdentity ?? getReferralIdentity,
    deps.referralKeyring ?? (() => process.env.REFERRAL_EMAIL_HMAC_KEYRING_JSON ?? ""));
  if (identity.reason) throw new ReferralError(identity.reason === "referee_email_unverified" ? "referral_email_unverified" : "referral_identity_unavailable", 503);
  return { uid: user.uid, runtime, identity };
}

/** Stable server line IDs for this new contract only; normal checkout keeps its existing order. */
function referralLines(priced: PricedCheckout) {
  const sorted = [...priced.orderItems].sort((a, b) => {
    const left = canonicalReferralJson(a); const right = canonicalReferralJson(b); return left < right ? -1 : left > right ? 1 : 0;
  });
  const occurrences = new Map<string, number>();
  return sorted.map(item => {
    const key = createHash("sha256").update(canonicalReferralJson(item)).digest("hex").slice(0, 32);
    const occurrence = occurrences.get(key) ?? 0; occurrences.set(key, occurrence + 1);
    return { ...item, lineId: `referral-line-${key}-${occurrence}` };
  });
}

/** Largest remainder on paid bases, capped so every line keeps at least one net cent. */
export function allocateReferralDiscount(lines: readonly { lineId: string; eligibleBeforeReferralCents: number }[]) {
  let remaining = 500;
  const amounts = new Map(lines.map(line => [line.lineId, 0]));
  while (remaining > 0) {
    const eligible = lines.filter(line => line.eligibleBeforeReferralCents - 1 > amounts.get(line.lineId)!);
    if (!eligible.length || eligible.reduce((sum, line) => sum + line.eligibleBeforeReferralCents - 1 - amounts.get(line.lineId)!, 0) < remaining)
      throw new ReferralError("referral_allocation_unavailable");
    const shares = allocateCents(remaining, eligible.map(line => ({ lineId: line.lineId, baseCents: line.eligibleBeforeReferralCents })));
    for (const share of shares) {
      const line = eligible.find(line => line.lineId === share.lineId)!;
      const part = Math.min(share.amountCents, line.eligibleBeforeReferralCents - 1 - amounts.get(line.lineId)!);
      amounts.set(line.lineId, amounts.get(line.lineId)! + part); remaining -= part;
    }
  }
  return [...lines].sort((a, b) => a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0)
    .map(line => ({ ...line, referralDiscountCents: amounts.get(line.lineId)! }));
}

/** Read-only plan. The same function runs in quote and creation transactions. */
export async function prepareReferralCheckout(input: { db: Firestore; transaction: Transaction; body: CheckoutRequestBody; priced: PricedCheckout;
  context: ReferralCheckoutContext; nowEpochMs: number; accrualProgram: CagnotteAccrualProgram | null; firebaseProjectId?: string | null }) {
  const { db, transaction: tx, context, body } = input;
  const none = (reason: Extract<ReferralCheckoutQuote, { applied: false }>["reason"]) => ({ priced: input.priced, snapshot: undefined,
    quote: { quoteVersion: REFERRAL_CHECKOUT_QUOTE_VERSION, applied: false, reason } as const });
  const p = input.priced;
  if (p.promoApplied || p.couponCode || p.contestPrizeId || p.appliedPromotions.length || p.orderItems.some(item => item.isGift) || exactEuroCents(p.promotionDiscountTotal) > 0)
    return none("priority_advantage");
  const orderItems = referralLines(p);
  const lines = orderItems.filter(item => !item.isGift).map((item, index) => ({ lineId: cagnotteOrderItemLineId(item, index), eligibleBeforeReferralCents: exactEuroCents(item.lineTotal) }));
  const base = lines.reduce((sum, line) => sum + line.eligibleBeforeReferralCents, 0);
  if (!Number.isSafeInteger(base) || base !== exactEuroCents(p.subtotal)) throw new ReferralError("referral_checkout_inconsistent");
  if (base < 5000) return none("below_threshold");
  const aliases = context.identity.aliases!;
  const blocks = await readReferralEmailBlocks(tx, db, aliases);
  if (blocks.corrupt) throw new ReferralError("referral_identity_unavailable");
  if (blocks.block) return none("right_consumed");
  const relationDoc = await tx.get(db.collection("referrals").doc(context.uid));
  if (!relationDoc.exists) return none("no_relation");
  const relation = relationDoc.data() as ReferralRelation;
  if (referralRelationIdentityHistoryStatus(context.uid, relation) !== "clear") throw new ReferralError("referral_relation_corrupt");
  if (relation.state !== "linked" || relation.qualifyingOrderId !== null || relation.paymentConfirmed) return none("right_consumed");
  if (relation.checkoutReservation) return none("right_reserved");
  // A positive durable payment remains decisive even if its old claim or marker is gone.
  const history = await findPriorPaidProductOrder(tx, db, context.uid, null, context.identity.normalizedEmail, context.identity.normalizedEmail);
  if (history.kind === "found") return none("right_consumed");
  if (history.kind === "inconclusive") throw new ReferralError("referral_history_inconclusive");
  const claims = await tx.getAll(...aliases.map(alias => db.collection("referralEmailClaims").doc(alias.id)));
  let protectedEmail = false;
  for (let i = 0; i < claims.length; i++) {
    if (!claims[i].exists) continue;
    const claim = claims[i].data();
    if (!isValidReferralEmailIdentityClaim(claim, aliases[i].version)) throw new ReferralError("referral_identity_unavailable");
    if (claim.refereeUid !== context.uid) throw new ReferralError("referral_email_claimed");
    protectedEmail = true;
  }
  if (!protectedEmail) throw new ReferralError("referral_identity_unavailable");
  if ((body.cagnotteUse?.requestedCents ?? 0) > 0) throw new ReferralError("REFERRAL_CAGNOTTE_CONFLICT");
  if (!canEnrollCagnotteOrder(input.accrualProgram, context.uid, input.nowEpochMs, input.firebaseProjectId)) throw new ReferralError("referral_loyalty_unavailable", 503);
  const snapshot = createReferralOrderSnapshot({ refereeUid: context.uid, createdAtEpochMs: input.nowEpochMs, lines: allocateReferralDiscount(lines) });
  const marker = await tx.get(db.collection(ORDER_EMAIL_MIGRATION_COLLECTION).doc(ORDER_EMAIL_NORMALIZATION_VERSION));
  const productDocs = await tx.getAll(...[...new Set(orderItems.map(item => item.productId))].sort().map(id => db.collection("products").doc(id)));
  const productsAfterReferralCents = base - 500;
  const deliveryCents = exactEuroCents(p.deliveryFee);
  const payableCents = calculateExternalPaymentCents(productsAfterReferralCents, deliveryCents);
  const loyaltyEstimateCents = calculateLoyaltyCents(productsAfterReferralCents);
  const quoteFingerprint = createHash("sha256").update(canonicalReferralJson({ version: REFERRAL_CHECKOUT_QUOTE_VERSION, uid: context.uid,
    runtime: context.runtime, relation, marker: { facts: marker.data(), updateTime: marker.updateTime ? [marker.updateTime.seconds, marker.updateTime.nanoseconds] : null },
    products: productDocs.map(doc => ({ id: doc.id, stock: doc.data()?.stock, updateTime: doc.updateTime ? [doc.updateTime.seconds, doc.updateTime.nanoseconds] : null })),
    claims: claims.map((doc, i) => ({ alias: aliases[i], facts: doc.data() ?? null })),
    blocks: blocks.docs.map((doc, i) => ({ alias: aliases[i], facts: doc.data() ?? null })),
    items: orderItems, allocation: snapshot.lines, delivery: { method: body.deliveryMethod, zone: body.deliveryZone ?? null,
      slot: body.deliverySlot ?? null, address: body.customer.address, cents: deliveryCents, status: p.deliveryFeeStatus },
    promotions: p.appliedPromotions, promotionDiscountCents: exactEuroCents(p.promotionDiscountTotal), referralDiscountCents: 500,
    payableCents, requestedCagnotteCents: body.cagnotteUse?.requestedCents ?? 0, loyaltyEstimateCents })).digest("hex");
  return { snapshot, priced: { ...p, orderItems, discountAmount: (exactEuroCents(p.discountAmount) + 500) / 100,
    totalAfterDiscount: payableCents / 100, total: payableCents / 100 },
    quote: { quoteVersion: REFERRAL_CHECKOUT_QUOTE_VERSION, applied: true, referralDiscountCents: 500, productsBeforeReferralCents: base,
      productsAfterReferralCents, deliveryCents, payableCents, loyaltyEstimateCents, quoteFingerprint } as const };
}

export function assertAcceptedReferralQuote(quote: ReferralCheckoutQuote, acceptance?: ReferralCheckoutAcceptance) {
  if (!quote.applied) { if (acceptance) throw new ReferralError("REFERRAL_QUOTE_CONFLICT"); return; }
  if (!acceptance) throw new ReferralError("REFERRAL_ACCEPTANCE_REQUIRED");
  if (acceptance.quoteVersion !== quote.quoteVersion || acceptance.quoteFingerprint !== quote.quoteFingerprint ||
      acceptance.acceptedReferralDiscountCents !== quote.referralDiscountCents || acceptance.acceptedPayableCents !== quote.payableCents)
    throw new ReferralError("REFERRAL_QUOTE_CONFLICT");
}

/** Prepared only by real creation, never by quote. Its read serializes concurrent candidates. */
export async function prepareReferralCheckoutReservation(input: { db: Firestore; transaction: Transaction; uid: string;
  orderId: string; checkoutRequestId: string; createdAtEpochMs: number }) {
  const ref = input.db.collection("referrals").doc(input.uid);
  const doc = await input.transaction.get(ref);
  if (!doc.exists || referralRelationIdentityHistoryStatus(input.uid, doc.data()!) !== "clear" ||
      doc.data()?.state !== "linked" || doc.data()?.checkoutReservation !== undefined) throw new ReferralError("REFERRAL_QUOTE_CONFLICT");
  const checkoutReservation = { schemaVersion: 1 as const, orderId: input.orderId,
    checkoutRequestId: input.checkoutRequestId, createdAtEpochMs: input.createdAtEpochMs };
  if (referralRelationIdentityHistoryStatus(input.uid, { ...doc.data(), checkoutReservation }) !== "clear") throw new ReferralError("REFERRAL_QUOTE_CONFLICT");
  return { write() { input.transaction.update(ref, { checkoutReservation }); } };
}
