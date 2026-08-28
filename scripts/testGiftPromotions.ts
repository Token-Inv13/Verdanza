import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCheckoutBody } from "../api/_server/checkout.js";
import { checkoutPayloadFingerprint } from "../api/_server/orderSideEffects.js";
import { buildCustomerInvoiceLines } from "../src/lib/customerInvoiceLines.js";
import {
  evaluateTieredProductGift,
  qualifyingGiftSubtotal,
  validateTieredProductGift,
} from "../src/lib/tieredProductGifts.js";
import {
  promotionAvailability,
  promotionBoundaryTimestamp,
  promotionDateTimeLocalToIso,
} from "../src/lib/promotionDates.js";
import type { Coupon, OrderItem, Product } from "../src/types/index.js";

const promotion: Coupon = {
  id: "weekend-aout-2026",
  code: "WEEKENDAOUT2026",
  label: "Dernier week-end d’août — fleurs offertes",
  discountType: "fixed",
  discountValue: 0,
  minimumOrder: 0,
  autoApply: true,
  promotionType: "tiered_product_gift",
  stackable: false,
  priority: 5,
  usedCount: 0,
  isActive: true,
  giftTiers: [
    { id: "tier-30", minimumSubtotal: 30, quantityGrams: 1 },
    { id: "tier-50", minimumSubtotal: 50, quantityGrams: 2 },
    { id: "tier-70", minimumSubtotal: 70, quantityGrams: 3 },
  ],
  giftProductIds: [
    "flower-blue-dream-cbd",
    "flower-mandarine-cbd",
    "flower-harlequin-greenhouse",
  ],
  giftSelectionMode: "customer_choice",
  defaultGiftProductId: "flower-blue-dream-cbd",
  qualifyingScope: "cart_subtotal",
};

const products = [
  product("flower-blue-dream-cbd", "Blue Dream", 22, true, 6),
  product("flower-mandarine-cbd", "Mandarine", 22, true, 6),
  product("flower-harlequin-greenhouse", "Harlequin Greenhouse", 16, true, 4),
  product("flower-plutonium-cbd-hydroponique", "Plutonium", 100, true, 6),
];

for (const [subtotal, expected] of [
  [0, 0],
  [20, 0],
  [29.99, 0],
  [30, 1],
  [49.99, 1],
  [50, 2],
  [69.99, 2],
  [70, 3],
  [120, 3],
] as Array<[number, number]>) {
  const result = evaluate(subtotal);
  assert.equal(result?.quote.unlockedQuantityGrams, expected, `tier at ${subtotal}`);
  assert.equal(result?.giftItem?.quantity || 0, expected, `gift line at ${subtotal}`);
}

assert.equal(qualifyingGiftSubtotal(promotion, [paidLine(30), giftLine(50)]), 30, "gift line excluded");
assert.equal(qualifyingGiftSubtotal(promotion, [paidLine(30), { ...paidLine(50), unitPrice: 0, lineTotal: 0 }]), 30, "zero line excluded");
assert.equal(
  qualifyingGiftSubtotal(promotion, [{ ...paidLine(40), purchaseMode: "fixed_price", lineTotal: 40 }]),
  40,
  "fixed-price paid total qualifies",
);

for (const productId of promotion.giftProductIds || []) {
  assert.equal(
    evaluate(50, { promotionId: promotion.id, giftProductId: productId })?.quote.selectedProductId,
    productId,
  );
}
const arbitrary = evaluate(50, {
  promotionId: promotion.id,
  giftProductId: "flower-plutonium-cbd-hydroponique",
});
assert.equal(arbitrary?.quote.selectedProductId, promotion.defaultGiftProductId);
assert.equal(arbitrary?.quote.selectionAdjusted, true, "unconfigured product cannot be imposed");

const parsed = parseCheckoutBody({
  checkoutRequestId: "017f22e2-79b0-4d29-aad7-2f6f3f012345",
  items: [{ productId: "paid", quantity: 1 }],
  deliveryMethod: "postal",
  complianceAccepted: true,
  customer: {
    email: "test@example.com",
    phone: "0600000000",
    firstName: "Test",
    lastName: "Client",
    address: { line1: "1 rue Test", postalCode: "13090", city: "Aix", country: "France" },
  },
  promotionSelections: [{
    promotionId: promotion.id,
    giftProductId: "flower-blue-dream-cbd",
    quantityGrams: 999,
    unitPrice: -100,
    tier: "fake",
  }],
});
assert.deepEqual(parsed.promotionSelections, [{
  promotionId: promotion.id,
  giftProductId: "flower-blue-dream-cbd",
}], "client gift price, tier and quantity are stripped");

assert.equal(evaluate(50, undefined, [product("flower-blue-dream-cbd", "Blue", 20, false, 6)])?.quote.unavailable, true);
const residual = evaluate(
  50,
  { promotionId: promotion.id, giftProductId: "flower-blue-dream-cbd" },
  [
    product("flower-blue-dream-cbd", "Blue Dream", 4, true, 6),
    product("flower-mandarine-cbd", "Mandarine", 1, true, 6),
    product("flower-harlequin-greenhouse", "Harlequin", 1, true, 4),
  ],
  [{ ...paidLine(50), productId: "flower-blue-dream-cbd", quantity: 3 }],
);
assert.equal(residual?.quote.unavailable, true, "paid quantity is reserved before gift stock");
assert.equal(residual?.giftItem, undefined);

const sameProduct = evaluate(
  50,
  { promotionId: promotion.id, giftProductId: "flower-blue-dream-cbd" },
  [product("flower-blue-dream-cbd", "Blue Dream", 5, true, 6)],
  [{ ...paidLine(50), productId: "flower-blue-dream-cbd", quantity: 3 }],
);
assert.equal(sameProduct?.giftItem?.quantity, 2, "paid and gift same product fit exact aggregate stock");

assert.equal(evaluate(50, undefined, [])?.quote.unavailable, true, "no reference available");
assert.equal(evaluate(70)?.giftItem?.quantity, 3, "tier change updates quantity");
assert.equal(evaluate(29.99)?.giftItem, undefined, "gift removed below first tier");
assert.equal(
  evaluateTieredProductGift({ promotion: { ...promotion, isActive: false }, paidItems: [paidLine(70)], products }),
  null,
);
assert.equal(
  evaluateTieredProductGift({ promotion: { ...promotion, endsAt: "2026-08-01" }, paidItems: [paidLine(70)], products, now: new Date("2026-08-02T00:00:00Z") }),
  null,
);
assert.equal(
  evaluateTieredProductGift({ promotion: { ...promotion, maxUses: 1, usedCount: 1 }, paidItems: [paidLine(70)], products }),
  null,
);

const orderItems = [paidLine(50), evaluate(50)!.giftItem!];
const invoiceLines = buildCustomerInvoiceLines({
  items: orderItems,
  appliedPromotions: [evaluate(50)!.appliedPromotion!],
});
assert.equal(invoiceLines.filter((line) => line.isGift).length, 1);
assert.equal(invoiceLines.find((line) => line.isGift)?.total, 0);
assert.notEqual(invoiceLines[0].id, invoiceLines[1].id, "paid and gift line ids differ");
assert.equal(invoiceLines[1].promotionLabel, promotion.label);

const fingerprintBase = {
  ...parsed,
  checkoutRequestId: "017f22e2-79b0-4d29-aad7-2f6f3f012345",
};
const fingerprintA = checkoutPayloadFingerprint(fingerprintBase);
const fingerprintB = checkoutPayloadFingerprint({
  ...fingerprintBase,
  promotionSelections: [{ promotionId: promotion.id, giftProductId: "flower-mandarine-cbd" }],
});
assert.notEqual(fingerprintA, fingerprintB, "gift selection participates in idempotency fingerprint");

assert.equal(promotionDateTimeLocalToIso("2026-08-30T23:59:59"), "2026-08-30T21:59:59.000Z");
assert.equal(promotionBoundaryTimestamp("2026-08-30", "end"), Date.parse("2026-08-30T21:59:59.999Z"));
assert.equal(
  promotionAvailability({ ...promotion, endsAt: "2026-08-30" }, Date.parse("2026-08-30T21:59:59.500Z")),
  "active",
);
assert.equal(
  promotionAvailability({ ...promotion, endsAt: "2026-08-30" }, Date.parse("2026-08-30T22:00:00.000Z")),
  "expired",
);

assert.deepEqual(validateTieredProductGift(promotion), []);
assert.ok(validateTieredProductGift({ ...promotion, giftTiers: [] }).length > 0);
assert.ok(validateTieredProductGift({
  ...promotion,
  giftTiers: [
    { id: "a", minimumSubtotal: 30, quantityGrams: 2 },
    { id: "b", minimumSubtotal: 30, quantityGrams: 1 },
  ],
}).length >= 2);

const createOrderSource = readFileSync("api/create-order.ts", "utf8");
const cancellationSource = readFileSync("api/_server/orderCancellation.ts", "utf8");
const bannerSource = readFileSync("api/quote-order.ts", "utf8");
const accountingSource = readFileSync("src/lib/accountingSummary.ts", "utf8");
assert.match(createOrderSource, /type: item\.isGift \? "promotion_gift" : "sale"/);
assert.match(createOrderSource, /requestedQuantity = matchingItems\.reduce/);
assert.match(cancellationSource, /for \(const item of order\.items \|\| \[\]\)/);
assert.match(cancellationSource, /promotionsRestoredAt/);
assert.match(bannerSource, /firstTier[\s\S]*product\.stock/);
assert.doesNotMatch(accountingSource, /filter\(\(item\) => !item\.isGift\)/, "gift cost is not excluded from accounting");

console.log("Tiered product gift tests passed (36+ scenarios and invariants).");

function evaluate(
  subtotal: number,
  selection?: { promotionId: string; giftProductId: string },
  inventory = products,
  paidItems = [paidLine(subtotal)],
) {
  return evaluateTieredProductGift({ promotion, paidItems, products: inventory, selection });
}

function paidLine(total: number): OrderItem {
  return {
    lineId: "paid:product",
    productId: "paid-product",
    name: "Produit payé",
    quantity: 1,
    unitPrice: total,
    lineTotal: total,
    category: "flowers",
  };
}

function giftLine(quantity: number): OrderItem {
  return {
    lineId: "gift:test:product",
    productId: "gift-product",
    name: "Cadeau",
    quantity,
    unitPrice: 0,
    lineTotal: 0,
    category: "flowers",
    isGift: true,
    promotionId: promotion.id,
  };
}

function product(
  id: string,
  name: string,
  stock: number,
  isActive: boolean,
  price: number,
): Product {
  return {
    id,
    slug: id,
    name,
    category: "flowers",
    price,
    shortDescription: "",
    longDescription: "",
    image: `/images/${id}.webp`,
    cbdRate: "",
    thcRate: "",
    origin: "",
    cultureType: "A renseigner",
    aromas: [],
    tags: [],
    stock,
    lowStockThreshold: 2,
    isActive,
    isFeatured: false,
    seoTitle: name,
    seoDescription: name,
  };
}
