import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import {
  allocateCents,
  assessCagnotteCompatibility,
  calculateCagnotte,
  calculateCagnotteCapCents,
  calculateLoyaltyCents,
  CAGNOTTE_CALCULATION_VERSION,
  checkReferralAmountThreshold,
  REFERRAL_REFERENCE_CENTS,
  simulateCagnotteRefund,
} from "../src/lib/cagnotteCalculations.js";
import { CAGNOTTE_OPENING_COMMERCIAL_POLICY } from "../src/lib/cagnotteCommercialPolicy.js";
import type {
  AllocationBase,
  CagnotteAdvantage,
  CagnotteCalculationInput,
  CagnotteSnapshot,
  CumulativeLineReturn,
  ProductDiscount,
} from "../src/types/cagnotte.js";

let passed = 0;
const examples: { scenario: string; applied: number; paid: number; gain: number }[] = [];

function test(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`OK ${passed} - ${name}`);
}

function single(initialCents: number, requestedCagnotteCents = 0, availableCagnotteCents = 100_000): CagnotteCalculationInput {
  return {
    lines: [{ lineId: "product", initialCents }], discounts: [],
    requestedCagnotteCents, availableCagnotteCents,
  };
}

function discount(amountCents: number, kind: ProductDiscount["kind"] = "product_discount"): ProductDiscount {
  return { discountId: "discount", amountCents, kind, lineIds: ["product"] };
}

function returned(returnedNetCents: number): readonly CumulativeLineReturn[] {
  return [{ lineId: "product", returnedNetCents }];
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach((child: unknown) => freezeDeep(child));
    Object.freeze(value);
  }
  return value;
}

function example(name: string, input: CagnotteCalculationInput, expected: readonly number[]) {
  test(name, () => {
    const snapshot = calculateCagnotte(input);
    deepStrictEqual(
      [snapshot.appliedCagnotteCents, snapshot.productsPaidCents, snapshot.loyaltyCents], expected,
    );
    equal(snapshot.kind, "estimate");
    equal(snapshot.calculationVersion, "cagnotte-math-v1");
    examples.push({
      scenario: name, applied: snapshot.appliedCagnotteCents,
      paid: snapshot.productsPaidCents, gain: snapshot.loyaltyCents,
    });
  });
}

example("100 EUR, sans cagnotte", single(10_000), [0, 10_000, 500]);
example("100 EUR, demande 8 EUR", single(10_000, 800), [800, 9_200, 460]);
example("100 EUR, demande 30 EUR", single(10_000, 3_000), [2_000, 8_000, 400]);
example("33,33 EUR, au plafond", single(3_333, 10_000), [666, 2_667, 133]);
example("50 EUR, remise filleul supposee eligible 5 EUR", {
  ...single(5_000), discounts: [discount(500, "referral_discount")],
}, [0, 4_500, 225]);
example("40 EUR + cadeau gratuit de valeur 10 EUR", {
  ...single(4_000),
  lines: [
    { lineId: "product", initialCents: 4_000 },
    { lineId: "gift", initialCents: 0, isGift: true, giftCommercialValueCents: 1_000 },
  ],
}, [0, 4_000, 200]);

test("panier vide", () => {
  const result = calculateCagnotte({ ...single(0, 100), lines: [] });
  deepStrictEqual(result.lines, []);
  deepStrictEqual([result.eligibleCents, result.cagnotteCapCents, result.productsPaidCents, result.loyaltyCents], [0, 0, 0, 0]);
  deepStrictEqual(result.limitationReasons, ["twenty_percent_cap"]);
  deepStrictEqual(simulateCagnotteRefund(result, [], []).delta, {
    returnedNetCents: 0, cagnotteRestitutionCents: 0, financialRefundCents: 0, loyaltyCorrectionCents: 0,
  });
});

test("ligne nulle et reduction nulle", () => {
  const result = calculateCagnotte({ ...single(0), discounts: [discount(0)] });
  equal(result.lines[0].netCents, 0);
  equal(result.loyaltyCents, 0);
  equal(simulateCagnotteRefund(result, [], returned(0)).next.returnedNetCents, 0);
});

test("cadeaux seuls : valeur commerciale hors de toute base", () => {
  const result = calculateCagnotte({
    ...single(0, 500), lines: [
      { lineId: "gift", initialCents: 0, isGift: true, giftCommercialValueCents: 50_000 },
    ],
  });
  deepStrictEqual(
    [result.subtotalCents, result.discountCents, result.eligibleCents, result.appliedCagnotteCents, result.loyaltyCents],
    [0, 0, 0, 0, 0],
  );
  equal(result.compatibility.status, "blocked");
  const refund = simulateCagnotteRefund(result, [], [{ lineId: "gift", returnedNetCents: 0 }]);
  equal(refund.delta.financialRefundCents, 0);
  throws(() => simulateCagnotteRefund(result, [], [{ lineId: "gift", returnedNetCents: 1 }]), RangeError);
});

test("demi-centime vers le haut et arrondi global", () => {
  deepStrictEqual([9, 10, 11, 29, 30].map(calculateLoyaltyCents), [0, 1, 1, 1, 2]);
  const result = calculateCagnotte({
    ...single(0), lines: [{ lineId: "a", initialCents: 10 }, { lineId: "b", initialCents: 10 }],
  });
  equal(result.loyaltyCents, 1);
  equal(calculateLoyaltyCents(10) + calculateLoyaltyCents(10), 2);
});

test("plafond avant cagnotte et arrondi inferieur", () => {
  deepStrictEqual([0, 1, 4, 5, 3_333, 10_000].map(calculateCagnotteCapCents), [0, 0, 0, 1, 666, 2_000]);
  const result = calculateCagnotte({ ...single(10_000, 3_000), discounts: [discount(1_000)] });
  deepStrictEqual([result.eligibleCents, result.cagnotteCapCents, result.appliedCagnotteCents], [9_000, 1_800, 1_800]);
  equal(result.requestedCagnotteCents, 3_000);
  deepStrictEqual(result.limitationReasons, ["twenty_percent_cap"]);
});

test("demande et solde inferieurs au plafond, motifs explicites", () => {
  const lowRequest = calculateCagnotte(single(10_000, 123));
  equal(lowRequest.appliedCagnotteCents, 123);
  deepStrictEqual(lowRequest.limitationReasons, []);
  const lowBalance = calculateCagnotte(single(10_000, 800, 300));
  equal(lowBalance.appliedCagnotteCents, 300);
  deepStrictEqual(lowBalance.limitationReasons, ["available_balance"]);
  const both = calculateCagnotte(single(10_000, 3_000, 300));
  deepStrictEqual(both.limitationReasons, ["available_balance", "twenty_percent_cap"]);
  equal(calculateCagnotte(single(10_000, 800, 0)).appliedCagnotteCents, 0);
});

test("seuil de parrainage : montant uniquement, aucune personne declaree eligible", () => {
  deepStrictEqual(REFERRAL_REFERENCE_CENTS, { sponsorReward: 1_000, refereeDiscount: 500, minimumProducts: 5_000 });
  equal(Object.isFrozen(REFERRAL_REFERENCE_CENTS), true);
  deepStrictEqual([4_999, 5_000, 5_001].map((amount) => {
    const result = checkReferralAmountThreshold(amount);
    equal(result.customerEligibility, "not_evaluated");
    equal(result.thresholdCents, 5_000);
    return result.amountEligible;
  }), [false, true, true]);
});

test("contrat commercial V1 explicite, sans activation ni automatisme a 72 heures", () => {
  equal(CAGNOTTE_OPENING_COMMERCIAL_POLICY.version, "cagnotte-commercial-policy-v1");
  equal(CAGNOTTE_OPENING_COMMERCIAL_POLICY.commerciallyValidatedOn, "2026-09-06");
  equal(CAGNOTTE_OPENING_COMMERCIAL_POLICY.acquisition.percentage, 5);
  equal(CAGNOTTE_OPENING_COMMERCIAL_POLICY.redemption.maximumEligibleProductsPercentage, 20);
  deepStrictEqual(CAGNOTTE_OPENING_COMMERCIAL_POLICY.acquisition.availabilityRequires, ["payment_confirmed", "delivery_confirmed"]);
  equal(CAGNOTTE_OPENING_COMMERCIAL_POLICY.creditValidity.automaticExpiration, false);
  equal(CAGNOTTE_OPENING_COMMERCIAL_POLICY.unpaidReservations.manualReviewAfterHours, 72);
  equal(CAGNOTTE_OPENING_COMMERCIAL_POLICY.unpaidReservations.automaticCancellation, false);
  equal(CAGNOTTE_OPENING_COMMERCIAL_POLICY.unpaidReservations.automaticRelease, false);
  equal(CAGNOTTE_OPENING_COMMERCIAL_POLICY.unpaidReservations.automaticNotification, false);
});

for (const kind of ["promotion_code", "contest_prize", "automatic_promotion"] as const) {
  test(`${kind} : utilisation bloquee, acquisition sur le reliquat conservee`, () => {
    const result = calculateCagnotte({ ...single(10_000, 800), discounts: [discount(1_000, kind)] });
    equal(result.compatibility.status, "blocked");
    deepStrictEqual(result.compatibility.blockingAdvantages, [kind]);
    deepStrictEqual(result.limitationReasons, ["compatibility_blocked"]);
    deepStrictEqual([result.discountCents, result.appliedCagnotteCents, result.productsPaidCents, result.loyaltyCents], [1_000, 0, 9_000, 450]);
  });
}

test("cadeau promotionnel : utilisation bloquee sans gain ni double reduction sur le cadeau", () => {
  const result = calculateCagnotte({
    ...single(10_000, 800),
    lines: [...single(10_000).lines, { lineId: "gift", initialCents: 0, isGift: true, giftCommercialValueCents: 2_000 }],
  });
  equal(result.compatibility.status, "blocked");
  deepStrictEqual(result.compatibility.blockingAdvantages, ["promotional_gift"]);
  deepStrictEqual(result.limitationReasons, ["compatibility_blocked"]);
  deepStrictEqual([result.discountCents, result.appliedCagnotteCents, result.productsPaidCents, result.loyaltyCents], [0, 0, 10_000, 500]);
  deepStrictEqual(result.lines.find((line) => line.lineId === "gift"), {
    lineId: "gift", initialCents: 0, isGift: true, giftCommercialValueCents: 2_000,
    discounts: [], discountCents: 0, netCents: 0, cagnotteCents: 0, productsPaidCents: 0,
  });
});

test("parrainage hors validation V1 : aucune autorisation implicite", () => {
  const result = calculateCagnotte({ ...single(5_000, 500), discounts: [discount(500, "referral_discount")] });
  equal(result.compatibility.status, "needs_validation");
  deepStrictEqual(result.compatibility.pendingAdvantages, ["referral_discount"]);
  deepStrictEqual(result.limitationReasons, ["compatibility_to_validate"]);
  deepStrictEqual([result.discountCents, result.appliedCagnotteCents, result.productsPaidCents, result.loyaltyCents], [500, 0, 4_500, 225]);
});

test("avantage non monetaire, absence de promotion et cumuls restent explicites", () => {
  const result = calculateCagnotte({ ...single(10_000, 800), advantages: ["promotion_code"] });
  equal(result.discountCents, 0);
  equal(result.appliedCagnotteCents, 0);
  const compatibility = assessCagnotteCompatibility([
    "referral_discount", "promotion_code", "automatic_promotion", "promotion_code",
  ]);
  deepStrictEqual(compatibility, {
    status: "blocked", blockingAdvantages: ["promotion_code", "automatic_promotion"],
    pendingAdvantages: ["referral_discount"],
  });
  deepStrictEqual(assessCagnotteCompatibility([]), { status: "allowed", blockingAdvantages: [], pendingAdvantages: [] });
  equal(calculateCagnotte(single(10_000, 800)).appliedCagnotteCents, 800);
});

test("reduction canonique appliquee une fois, perimetres et bases restantes", () => {
  const result = calculateCagnotte({
    lines: [{ lineId: "c", initialCents: 100 }, { lineId: "b", initialCents: 200 }, { lineId: "a", initialCents: 100 }],
    discounts: [
      { discountId: "a-only", amountCents: 50, kind: "product_discount", lineIds: ["a"] },
      { discountId: "a-b", amountCents: 50, kind: "product_discount", lineIds: ["b", "a"] },
    ], requestedCagnotteCents: 60, availableCagnotteCents: 60,
  });
  equal(result.discountCents, 100);
  deepStrictEqual(result.lines.map((line) => [line.lineId, line.discountCents, line.netCents, line.cagnotteCents, line.productsPaidCents]), [
    ["a", 60, 40, 8, 32], ["b", 40, 160, 32, 128], ["c", 0, 100, 20, 80],
  ]);
  deepStrictEqual(result.lines[2].discounts, []);
  deepStrictEqual(result.lines[0].discounts, [{ discountId: "a-only", amountCents: 50 }, { discountId: "a-b", amountCents: 10 }]);
});

test("prix de conditionnement exact, sans reconstruction de prix unitaire", () => {
  const result = calculateCagnotte({
    ...single(0), lines: [{ lineId: "pack", initialCents: 999 }, { lineId: "other-pack", initialCents: 1_337 }],
  });
  equal(result.subtotalCents, 2_336);
  equal(result.loyaltyCents, 117);
});

test("prorata : plus grand reste puis identifiant stable", () => {
  deepStrictEqual(allocateCents(5, [
    { lineId: "c", baseCents: 3 }, { lineId: "b", baseCents: 2 }, { lineId: "a", baseCents: 1 },
  ]), [{ lineId: "a", amountCents: 1 }, { lineId: "b", amountCents: 2 }, { lineId: "c", amountCents: 2 }]);
  deepStrictEqual(allocateCents(1, [{ lineId: "b", baseCents: 1 }, { lineId: "a", baseCents: 1 }]), [
    { lineId: "a", amountCents: 1 }, { lineId: "b", amountCents: 0 },
  ]);
  deepStrictEqual(allocateCents(0, []), []);
  deepStrictEqual(allocateCents(0, [{ lineId: "zero", baseCents: 0 }]), [{ lineId: "zero", amountCents: 0 }]);
});

test("reordonnancement des lignes et perimetres sans changer l'instantane", () => {
  const input: CagnotteCalculationInput = {
    ...single(0, 50), lines: [{ lineId: "z", initialCents: 111 }, { lineId: "a", initialCents: 111 }],
    discounts: [{ discountId: "one", kind: "product_discount", amountCents: 1, lineIds: ["z", "a"] }],
  };
  const expected = calculateCagnotte(input);
  deepStrictEqual(calculateCagnotte({
    ...input, lines: [...input.lines].reverse(),
    discounts: input.discounts.map((entry) => ({ ...entry, lineIds: [...entry.lineIds].reverse() })),
  }), expected);
  equal(expected.lines[0].discountCents, 1);
});

const refundOrigin = calculateCagnotte(single(10_000, 2_000));
test("retour de 25 EUR : financier 20 EUR, cagnotte 5 EUR, correction 1 EUR", () => {
  const result = simulateCagnotteRefund(refundOrigin, [], returned(2_500));
  equal(result.kind, "refund_simulation");
  equal(result.calculationVersion, CAGNOTTE_CALCULATION_VERSION);
  deepStrictEqual(result.delta, {
    returnedNetCents: 2_500, cagnotteRestitutionCents: 500, financialRefundCents: 2_000, loyaltyCorrectionCents: 100,
  });
  equal(result.next.theoreticalLoyaltyCents, 300);
});

test("retour total : parts originales exactes et gain final nul", () => {
  const result = simulateCagnotteRefund(refundOrigin, [], returned(10_000));
  deepStrictEqual(result.delta, {
    returnedNetCents: 10_000, cagnotteRestitutionCents: 2_000, financialRefundCents: 8_000, loyaltyCorrectionCents: 400,
  });
  equal(result.next.retainedProductsPaidCents, 0);
  equal(result.next.theoreticalLoyaltyCents, 0);
});

test("retours successifs : centimes indivisibles et correction sans cumul d'arrondis", () => {
  const origin = calculateCagnotte(single(17, 3));
  let previous: readonly CumulativeLineReturn[] = [];
  let financial = 0;
  let wallet = 0;
  let correction = 0;
  for (const total of [1, 2, 5, 6, 11, 16, 17]) {
    const next = returned(total);
    const result = simulateCagnotteRefund(origin, previous, next);
    const once = simulateCagnotteRefund(origin, [], next);
    financial += result.delta.financialRefundCents;
    wallet += result.delta.cagnotteRestitutionCents;
    correction += result.delta.loyaltyCorrectionCents;
    deepStrictEqual([financial, wallet, correction], [
      once.delta.financialRefundCents, once.delta.cagnotteRestitutionCents, once.delta.loyaltyCorrectionCents,
    ]);
    equal(wallet, Number(3n * BigInt(total) / 17n));
    previous = next;
  }
  deepStrictEqual([financial, wallet, correction], [14, 3, 1]);
  // The first 5 cents remove the global half-cent rounding, despite rounding 5% of 5 to zero.
  equal(simulateCagnotteRefund(origin, [], returned(5)).delta.loyaltyCorrectionCents, 1);
  equal(calculateLoyaltyCents(5), 0);
});

test("etat cumule identique : toutes les differences nulles", () => {
  const result = simulateCagnotteRefund(refundOrigin, returned(2_500), returned(2_500));
  deepStrictEqual(result.delta, {
    returnedNetCents: 0, cagnotteRestitutionCents: 0, financialRefundCents: 0, loyaltyCorrectionCents: 0,
  });
  equal(result.lines[0].cagnotteRestitutionDeltaCents, 0);
  equal(result.lines[0].financialRefundDeltaCents, 0);
});

test("remboursement global multiligne et conservation des avantages d'origine", () => {
  const origin = calculateCagnotte({
    ...single(0, 100), lines: [
      { lineId: "a", initialCents: 17 }, { lineId: "b", initialCents: 19 },
    ], discounts: [{ discountId: "original", amountCents: 2, kind: "product_discount", lineIds: ["b"] }],
  });
  deepStrictEqual(origin.lines.map((line) => line.cagnotteCents), [3, 3]);
  const result = simulateCagnotteRefund(origin, [], [{ lineId: "b", returnedNetCents: 17 }]);
  deepStrictEqual([result.delta.financialRefundCents, result.delta.cagnotteRestitutionCents], [14, 3]);
  equal(result.next.theoreticalLoyaltyCents, 1);
  const referral = calculateCagnotte({ ...single(5_000), discounts: [discount(500, "referral_discount")] });
  const partial = simulateCagnotteRefund(referral, [], returned(1_000));
  equal(partial.next.retainedProductsPaidCents, 3_500);
  equal(partial.next.theoreticalLoyaltyCents, 175);
});

test("arithmetique exacte proche de MAX_SAFE_INTEGER, produits intermediaires BigInt", () => {
  const max = Number.MAX_SAFE_INTEGER;
  equal(calculateLoyaltyCents(max), 450_359_962_737_050);
  equal(calculateCagnotteCapCents(max), 1_801_439_850_948_198);
  const bases = [{ lineId: "b", baseCents: max - 1 }, { lineId: "a", baseCents: 1 }];
  deepStrictEqual(allocateCents(max, bases), [{ lineId: "a", amountCents: 1 }, { lineId: "b", amountCents: max - 1 }]);
  const origin = calculateCagnotte(single(max, max, max));
  const result = simulateCagnotteRefund(origin, [], returned(max - 1));
  equal(result.next.cagnotteRestitutionCents, Number(BigInt(origin.appliedCagnotteCents) * BigInt(max - 1) / BigInt(max)));
  const full = simulateCagnotteRefund(origin, [], returned(max));
  equal(full.next.cagnotteRestitutionCents, origin.appliedCagnotteCents);
  equal(full.next.financialRefundCents, origin.productsPaidCents);
});

const invalidMoney: readonly unknown[] = [-1, 0.5, "100", NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, null, undefined, true, 1n];
for (const [index, invalid] of invalidMoney.entries()) {
  test(`montant invalide ${index + 1} : rejet aux frontieres publiques`, () => {
    const amount = invalid as number;
    throws(() => calculateLoyaltyCents(amount), RangeError);
    throws(() => calculateCagnotteCapCents(amount), RangeError);
    throws(() => checkReferralAmountThreshold(amount), RangeError);
    throws(() => allocateCents(amount, []), RangeError);
    throws(() => allocateCents(0, [{ lineId: "a", baseCents: amount }]), RangeError);
    throws(() => calculateCagnotte(single(amount)), RangeError);
    throws(() => calculateCagnotte({ ...single(100), requestedCagnotteCents: amount }), RangeError);
    throws(() => calculateCagnotte({ ...single(100), availableCagnotteCents: amount }), RangeError);
    throws(() => calculateCagnotte({ ...single(100), discounts: [discount(amount)] }), RangeError);
    // This metadata is optional; undefined means it was not supplied.
    if (invalid !== undefined) {
      throws(() => calculateCagnotte({ ...single(0), lines: [
        { lineId: "gift", initialCents: 0, isGift: true, giftCommercialValueCents: amount },
      ] }), RangeError);
    }
    throws(() => simulateCagnotteRefund(refundOrigin, [], returned(amount)), RangeError);
    throws(() => simulateCagnotteRefund(refundOrigin, returned(amount), []), RangeError);
  });
}

test("sommes non sures rejetees meme si chaque montant est sur", () => {
  const lines = [{ lineId: "a", initialCents: Number.MAX_SAFE_INTEGER }, { lineId: "b", initialCents: 1 }];
  throws(() => calculateCagnotte({ ...single(0), lines }), RangeError);
  throws(() => allocateCents(0, lines.map((line) => ({ lineId: line.lineId, baseCents: line.initialCents }))), RangeError);
});

test("identifiants dupliques ou invalides et lignes inconnues", () => {
  throws(() => calculateCagnotte({ ...single(1), lines: [...single(1).lines, ...single(1).lines] }), RangeError);
  throws(() => allocateCents(1, [{ lineId: "a", baseCents: 1 }, { lineId: "a", baseCents: 1 }]), RangeError);
  for (const lineId of ["", " ", " a", "a ", 1, null]) {
    throws(() => calculateCagnotte({ ...single(1), lines: [{ lineId: lineId as string, initialCents: 1 }] }), RangeError);
  }
  for (const lineIds of [["unknown"], ["product", "product"], []]) {
    throws(() => calculateCagnotte({ ...single(100), discounts: [{ ...discount(1), lineIds }] }), RangeError);
  }
  throws(() => calculateCagnotte({ ...single(100), discounts: [discount(1), discount(1)] }), RangeError);
  throws(() => calculateCagnotte({ ...single(100), discounts: [{ ...discount(1), discountId: "" }] }), RangeError);
});

test("montants superieurs au perimetre restant, cadeaux incoherents", () => {
  throws(() => allocateCents(1, []), RangeError);
  throws(() => allocateCents(2, [{ lineId: "a", baseCents: 1 }]), RangeError);
  throws(() => calculateCagnotte({ ...single(100), discounts: [discount(101)] }), RangeError);
  throws(() => calculateCagnotte({
    ...single(100), discounts: [discount(60), { ...discount(41), discountId: "second" }],
  }), RangeError);
  throws(() => calculateCagnotte({
    ...single(1), lines: [...single(1).lines, { lineId: "excluded", initialCents: 10_000 }], discounts: [discount(2)],
  }), RangeError);
  throws(() => calculateCagnotte({ ...single(1), lines: [{ lineId: "gift", initialCents: 1, isGift: true }] }), RangeError);
  throws(() => calculateCagnotte({ ...single(1), lines: [
    { lineId: "product", initialCents: 1, isGift: "true" as unknown as boolean },
  ] }), RangeError);
});

test("formes de donnees et classifications inconnues rejetees", () => {
  for (const value of [null, [], 1]) {
    throws(() => calculateCagnotte(value as unknown as CagnotteCalculationInput), RangeError);
  }
  throws(() => calculateCagnotte({ ...single(1), lines: null } as unknown as CagnotteCalculationInput), RangeError);
  throws(() => calculateCagnotte({ ...single(1), discounts: null } as unknown as CagnotteCalculationInput), RangeError);
  throws(() => assessCagnotteCompatibility(null as unknown as readonly CagnotteAdvantage[]), RangeError);
  throws(() => assessCagnotteCompatibility(["unknown" as CagnotteAdvantage]), RangeError);
  for (const kind of ["unknown", "promotional_gift"]) {
    throws(() => calculateCagnotte({ ...single(1), discounts: [{ ...discount(0), kind } as ProductDiscount] }), RangeError);
  }
  throws(() => allocateCents(0, null as unknown as readonly AllocationBase[]), RangeError);
});

test("retours : trop-rembourse, recul, doublons, inconnus et omission d'un cumul positif", () => {
  throws(() => simulateCagnotteRefund(refundOrigin, [], returned(10_001)), RangeError);
  throws(() => simulateCagnotteRefund(refundOrigin, returned(2_500), returned(2_499)), RangeError);
  throws(() => simulateCagnotteRefund(refundOrigin, returned(2_500), []), RangeError);
  throws(() => simulateCagnotteRefund(refundOrigin, [], [...returned(1), ...returned(1)]), RangeError);
  throws(() => simulateCagnotteRefund(refundOrigin, [...returned(1), ...returned(1)], returned(1)), RangeError);
  throws(() => simulateCagnotteRefund(refundOrigin, [], [{ lineId: "unknown", returnedNetCents: 0 }]), RangeError);
  throws(() => simulateCagnotteRefund(refundOrigin, null as unknown as readonly CumulativeLineReturn[], []), RangeError);
});

test("instantanes incoherents ou version inconnue rejetes", () => {
  throws(() => simulateCagnotteRefund({ ...refundOrigin, calculationVersion: "v2" } as unknown as CagnotteSnapshot, [], []), RangeError);
  throws(() => simulateCagnotteRefund({ ...refundOrigin, eligibleCents: 9_999 }, [], []), RangeError);
  throws(() => simulateCagnotteRefund({ ...refundOrigin, loyaltyCents: 399 }, [], []), RangeError);
  throws(() => simulateCagnotteRefund({ ...refundOrigin, requestedCagnotteCents: 0 }, [], []), RangeError);
  throws(() => simulateCagnotteRefund({ ...refundOrigin, lines: [refundOrigin.lines[0], refundOrigin.lines[0]] }, [], []), RangeError);
  throws(() => simulateCagnotteRefund({ ...refundOrigin, lines: [{ ...refundOrigin.lines[0], productsPaidCents: 1 }] }, [], []), RangeError);
  throws(() => simulateCagnotteRefund({ ...refundOrigin, lines: [{
    ...refundOrigin.lines[0], discounts: [{ discountId: "x", amountCents: 0 }, { discountId: "x", amountCents: 0 }],
  }] }, [], []), RangeError);
});

test("arguments geles, aucune mutation, resultats deterministes et sans alias d'entree", () => {
  const input = freezeDeep({
    ...single(100, 10), discounts: [discount(11)], advantages: [] as CagnotteAdvantage[],
  });
  const before = structuredClone(input);
  const snapshot = calculateCagnotte(input);
  deepStrictEqual(calculateCagnotte(input), snapshot);
  deepStrictEqual(input, before);
  ok(snapshot.lines !== input.lines);
  ok(snapshot.lines[0] !== input.lines[0]);
  const frozenSnapshot = freezeDeep(snapshot);
  const snapshotBefore = structuredClone(frozenSnapshot);
  const previous = freezeDeep(returned(1));
  const next = freezeDeep(returned(17));
  const previousBefore = structuredClone(previous);
  const nextBefore = structuredClone(next);
  deepStrictEqual(simulateCagnotteRefund(frozenSnapshot, previous, next), simulateCagnotteRefund(frozenSnapshot, previous, next));
  deepStrictEqual(frozenSnapshot, snapshotBefore);
  deepStrictEqual(previous, previousBefore);
  deepStrictEqual(next, nextBefore);
  const bases = freezeDeep([{ lineId: "b", baseCents: 17 }, { lineId: "a", baseCents: 19 }]);
  const basesBefore = structuredClone(bases);
  deepStrictEqual(allocateCents(7, bases), allocateCents(7, bases));
  deepStrictEqual(bases, basesBefore);
  const advantages = freezeDeep(["automatic_promotion", "promotion_code"] as const);
  const advantagesBefore = structuredClone(advantages);
  deepStrictEqual(assessCagnotteCompatibility(advantages), assessCagnotteCompatibility(advantages));
  deepStrictEqual(advantages, advantagesBefore);
});

// A bounded deterministic matrix: 24 orders, each with four cumulative return states.
for (const total of [1, 9, 10, 17, 101, 3_333, 10_000, 45_000]) {
  for (const request of [0, 1, 100_000]) {
    test(`invariants : total ${total} centimes, demande ${request}`, () => {
      const initialA = Math.floor(total / 3);
      const input = freezeDeep({
        lines: [{ lineId: "b", initialCents: total - initialA }, { lineId: "a", initialCents: initialA }],
        discounts: [{ discountId: "canonical", kind: "product_discount" as const, amountCents: total % 5, lineIds: ["a", "b"] }],
        requestedCagnotteCents: request, availableCagnotteCents: total,
      });
      const snapshot = calculateCagnotte(input);
      deepStrictEqual(calculateCagnotte({ ...input, lines: [...input.lines].reverse() }), snapshot);
      equal(snapshot.discountCents, total % 5);
      equal(snapshot.subtotalCents, snapshot.discountCents + snapshot.eligibleCents);
      equal(snapshot.eligibleCents, snapshot.appliedCagnotteCents + snapshot.productsPaidCents);
      equal(sum(snapshot.lines.map((line) => line.cagnotteCents)), snapshot.appliedCagnotteCents);
      equal(sum(snapshot.lines.map((line) => line.productsPaidCents)), snapshot.productsPaidCents);
      for (const line of snapshot.lines) {
        equal(line.discountCents, sum(line.discounts.map((entry) => entry.amountCents)));
        equal(line.initialCents, line.discountCents + line.cagnotteCents + line.productsPaidCents);
        for (const cents of [line.discountCents, line.netCents, line.cagnotteCents, line.productsPaidCents]) {
          ok(Number.isSafeInteger(cents) && cents >= 0 && cents <= line.initialCents);
        }
        ok(line.cagnotteCents <= line.netCents);
      }
      let previous: readonly CumulativeLineReturn[] = [];
      let financial = 0;
      let wallet = 0;
      let correction = 0;
      for (const step of [0, 1, 2, 3]) {
        const next = snapshot.lines.map((line) => ({ lineId: line.lineId, returnedNetCents: Math.floor(line.netCents * step / 3) }));
        const result = simulateCagnotteRefund(snapshot, previous, next);
        const once = simulateCagnotteRefund(snapshot, [], next);
        financial += result.delta.financialRefundCents;
        wallet += result.delta.cagnotteRestitutionCents;
        correction += result.delta.loyaltyCorrectionCents;
        deepStrictEqual(result.next, once.next);
        deepStrictEqual([financial, wallet, correction], [
          once.delta.financialRefundCents, once.delta.cagnotteRestitutionCents, once.delta.loyaltyCorrectionCents,
        ]);
        equal(financial + wallet, sum(next.map((line) => line.returnedNetCents)));
        for (const value of Object.values(result.delta)) ok(Number.isSafeInteger(value) && value >= 0);
        equal(result.delta.financialRefundCents, sum(result.lines.map((line) => line.financialRefundDeltaCents)));
        equal(result.delta.cagnotteRestitutionCents, sum(result.lines.map((line) => line.cagnotteRestitutionDeltaCents)));
        previous = next;
      }
      deepStrictEqual([financial, wallet, correction], [snapshot.productsPaidCents, snapshot.appliedCagnotteCents, snapshot.loyaltyCents]);
    });
  }
}

console.log("Exemples verifies (tous les montants ci-dessous sont des centimes) :");
console.table(examples);
console.log(`Cagnotte : ${passed} cas reussis, dont 24 cas d'invariants. Donnees synthetiques uniquement.`);
