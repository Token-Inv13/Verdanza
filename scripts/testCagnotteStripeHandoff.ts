import assert from "node:assert/strict";
import { prepareCagnotteCheckoutQuote, assertAcceptedCagnotteQuote } from "../api/_server/cagnotteCheckout.js";
import type { CheckoutRequestBody, PricedCheckout } from "../api/_server/checkout.js";
import type { CagnotteReservationTestProgram } from "../api/_server/cagnotteReservationTypes.js";
import { calculateExternalPaymentCents, deriveOrderFinancingAmounts, exactEuroCents } from "../src/lib/orderFinancing.js";
import { calculateCagnotte } from "../src/lib/cagnotteCalculations.js";
import type { CagnotteAdvantage } from "../src/types/cagnotte.js";

const reservationProgram: CagnotteReservationTestProgram = {
  mode: "local_test", programVersion: "stripe-handoff-test-v1", calculationVersion: "cagnotte-math-v1",
  startsAtEpochMs: 1, reservationVersion: "cagnotte-reservation-v1", reservationsEnabled: true,
};
const body: CheckoutRequestBody = {
  items: [{ productId: "synthetic", quantity: 1 }], deliveryMethod: "postal",
  customer: { firstName: "Test", lastName: "Client", email: "test@example.invalid", phone: "0600000000",
    address: { firstName: "Test", lastName: "Client", line1: "1 rue fictive", postalCode: "75001", city: "Paris", country: "France" } },
};
function priced(productsCents: number, deliveryCents: number): PricedCheckout {
  return {
    orderItems: [{ productId: "synthetic", name: "Produit fictif", quantity: 1, unitPrice: productsCents / 100, lineTotal: productsCents / 100 }],
    subtotal: productsCents / 100, subtotalBeforeDiscount: productsCents / 100,
    subtotalBeforePromotion: productsCents / 100, subtotalAfterPromotion: productsCents / 100,
    deliveryFee: deliveryCents / 100, discountAmount: 0, promotionDiscountTotal: 0,
    totalAfterDiscount: productsCents / 100, total: (productsCents + deliveryCents) / 100,
    promoApplied: false, appliedPromotions: [], promotionProgressMessages: [], giftPromotions: [],
    deliveryMinimumApplied: 0, postalFreeShippingApplied: false, deliveryFeeStatus: "configured", deliveryNote: "Fixture locale",
  };
}
function prepare(value: PricedCheckout, requested: number, available: number, request = body) {
  return prepareCagnotteCheckoutQuote({ body: { ...request, cagnotteUse: { requestedCents: requested } }, priced: value,
    beneficiaryId: "synthetic-client", availableCents: available, reservationProgram,
    accrualProgram: { ...reservationProgram, newAccrualsEnabled: true }, createdAtEpochMs: 1000 });
}
function accept(quote: ReturnType<typeof prepare>["quote"]) {
  return { quoteVersion: quote.quoteVersion, quoteFingerprint: quote.quoteFingerprint,
    acceptedCagnotteCents: quote.proposedCagnotteCents, acceptedPayableCents: quote.payableCents };
}

const matrix = [
  { name: "A", products: 10000, delivery: 0, requested: 3000, wallet: 3000, cap: 2000, used: 2000, paid: 8000, external: 8000, gain: 400 },
  { name: "B", products: 10000, delivery: 0, requested: 2000, wallet: 500, cap: 2000, used: 500, paid: 9500, external: 9500, gain: 475 },
  { name: "C", products: 10000, delivery: 549, requested: 3000, wallet: 3000, cap: 2000, used: 2000, paid: 8000, external: 8549, gain: 400 },
  { name: "arrondis", products: 3333, delivery: 549, requested: 1000, wallet: 1000, cap: 666, used: 666, paid: 2667, external: 3216, gain: 133 },
  { name: "moins de 1 euro", products: 10000, delivery: 549, requested: 50, wallet: 1000, cap: 2000, used: 50, paid: 9950, external: 10499, gain: 498 },
  { name: "wallet zero", products: 10000, delivery: 549, requested: 2000, wallet: 0, cap: 2000, used: 0, paid: 10000, external: 10549, gain: 500 },
  { name: "plafond arrondi zero", products: 4, delivery: 0, requested: 1, wallet: 1000, cap: 0, used: 0, paid: 4, external: 4, gain: 0 },
];
for (const row of matrix) {
  const { quote, calculationIntent } = prepare(priced(row.products, row.delivery), row.requested, row.wallet);
  assert.deepEqual([quote.cagnotteCapCents, quote.proposedCagnotteCents, calculationIntent.order.snapshot.productsPaidCents,
    quote.payableCents, quote.estimatedLoyaltyCents], [row.cap, row.used, row.paid, row.external, row.gain], row.name);
  assert.equal(calculateExternalPaymentCents(row.paid, row.delivery), row.external);
  const order = { total: (row.products + row.delivery) / 100, deliveryFee: row.delivery / 100, paymentAmount: row.external / 100,
    cagnotte: { schemaVersion: 1 as const, beneficiaryId: "synthetic-client", programVersion: reservationProgram.programVersion,
      calculationVersion: reservationProgram.calculationVersion, createdAtEpochMs: 1000, snapshot: calculationIntent.order.snapshot } };
  assert.equal(deriveOrderFinancingAmounts(order).paymentCents, row.external);
  assert.equal(exactEuroCents(order.paymentAmount), row.external);
  assert.throws(() => deriveOrderFinancingAmounts({ ...order, paymentAmount: order.paymentAmount + 0.01 }), /incohérent/);
  if (row.used) assert.doesNotThrow(() => assertAcceptedCagnotteQuote(quote, accept(quote)));
  else assert.throws(() => assertAcceptedCagnotteQuote(quote, accept(quote)), /nouveau devis/);
  console.log(`PASS handoff ${row.name}: used=${row.used}, external=${row.external}, gain=${row.gain}`);
}
for (const invalid of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => calculateExternalPaymentCents(invalid, 0));
  assert.throws(() => calculateExternalPaymentCents(0, invalid));
}
assert.throws(() => calculateExternalPaymentCents(Number.MAX_SAFE_INTEGER, 1));

const original = prepare(priced(10000, 549), 2000, 3000).quote;
assert.throws(() => assertAcceptedCagnotteQuote(original, undefined), /accepté/);
for (const patch of [{ acceptedCagnotteCents: 1999 }, { acceptedPayableCents: 8000 }, { quoteFingerprint: "outdated" }]) {
  assert.throws(() => assertAcceptedCagnotteQuote(original, { ...accept(original), ...patch }), /nouveau devis/);
}
for (const changed of [prepare(priced(11000, 549), 2000, 3000), prepare(priced(10000, 0), 2000, 3000),
  prepare(priced(10000, 549), 500, 3000), prepare(priced(10000, 549), 2000, 500),
  prepare(priced(10000, 549), 2000, 3000, { ...body, promotionSelections: [{ promotionId: "gift", giftProductId: "gift-product" }] })]) {
  assert.throws(() => assertAcceptedCagnotteQuote(changed.quote, accept(original)), /nouveau devis/);
}
assertAcceptedCagnotteQuote(prepare(priced(10000, 549), 2000, 4000).quote, accept(original));

for (const advantage of ["promotion_code", "automatic_promotion", "promotional_gift", "contest_prize", "referral_discount"] as const) {
  const snapshot = calculateCagnotte({ lines: [{ lineId: "product", initialCents: 10000 }],
    discounts: [{ discountId: "applied", amountCents: 500, kind: "product_discount", lineIds: ["product"] }],
    advantages: [advantage], requestedCagnotteCents: 2000, availableCagnotteCents: 3000 });
  assert.equal(snapshot.appliedCagnotteCents, 0); assert.equal(snapshot.discountCents, 500);
  assert.equal(snapshot.productsPaidCents, 9500); assert.equal(snapshot.loyaltyCents, 475);
  assert.notEqual(snapshot.compatibility.status, "allowed");
}
assert.throws(() => calculateCagnotte({ lines: [{ lineId: "product", initialCents: 10000 }], discounts: [],
  advantages: ["unknown" as CagnotteAdvantage], requestedCagnotteCents: 2000, availableCagnotteCents: 3000 }), /inconnu/);
const inactiveOffer = { ...priced(10000, 549), promotionProgressMessages: ["Offre non atteinte : badge seulement"] };
assert.equal(prepare(inactiveOffer, 2000, 3000).quote.proposedCagnotteCents, 2000);
console.log("PASS handoff: integer payment contract, stale acceptance, incompatible benefits and inactive offer.");
