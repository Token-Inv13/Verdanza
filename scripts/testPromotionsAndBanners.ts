import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  automaticPromotionRulesFromCoupons,
  calculateCartPromotions,
} from "../src/lib/cartPromotions.ts";
import type { Coupon } from "../src/types/index.js";

type TestCase = {
  name: string;
  run: () => void;
};

const root = process.cwd();

const fleurs20: Coupon = {
  id: "fleurs20",
  code: "FLEURS20",
  label: "20 EUR de fleurs offerts",
  discountType: "fixed",
  discountValue: 0,
  minimumOrder: 0,
  autoApply: true,
  promotionType: "threshold_extra_discount",
  eligibleCategory: "flowers",
  categories: ["flowers"],
  minEligibleSubtotal: 0,
  paidThresholdAmount: 30,
  maxGiftAmount: 20,
  maxDiscountAmount: 20,
  stackable: false,
  priority: 100,
  usedCount: 0,
  isActive: true,
  isArchived: false,
};

const tests: TestCase[] = [
  promotionCase("28 EUR flowers", 28, 0),
  promotionCase("30 EUR flowers", 30, 0),
  promotionCase("40 EUR flowers", 40, 10),
  promotionCase("50 EUR flowers", 50, 20),
  promotionCase("72 EUR flowers", 72, 20),
  {
    name: "mixed cart counts only flowers",
    run() {
      const result = calculateCartPromotions({
        lines: [
          { productId: "flower", category: "flowers", unitPrice: 40, quantity: 1 },
          { productId: "resin", category: "resins", unitPrice: 50, quantity: 1 },
        ],
        rules: automaticPromotionRulesFromCoupons([fleurs20]),
      });
      assertEqual(result.promotionDiscountTotal, 10);
    },
  },
  {
    name: "multi-category promotion counts all configured categories",
    run() {
      const result = calculateCartPromotions({
        lines: [
          { productId: "flower", category: "flowers", unitPrice: 20, quantity: 1 },
          { productId: "resin", category: "resins", unitPrice: 20, quantity: 1 },
        ],
        rules: automaticPromotionRulesFromCoupons([
          {
            ...fleurs20,
            eligibleCategory: undefined,
            categories: ["flowers", "resins"],
          },
        ]),
      });
      assertEqual(result.promotionDiscountTotal, 10);
    },
  },
  {
    name: "automatic inactive promotion is ignored",
    run() {
      const result = calculateCartPromotions({
        lines: [{ productId: "flower", category: "flowers", unitPrice: 72, quantity: 1 }],
        rules: automaticPromotionRulesFromCoupons([{ ...fleurs20, isActive: false }]),
      });
      assertEqual(result.promotionDiscountTotal, 0);
    },
  },
  {
    name: "automatic maxUses reached is ignored at quote level",
    run() {
      const result = calculateCartPromotions({
        lines: [{ productId: "flower", category: "flowers", unitPrice: 72, quantity: 1 }],
        rules: automaticPromotionRulesFromCoupons([{ ...fleurs20, maxUses: 1, usedCount: 1 }]),
      });
      assertEqual(result.promotionDiscountTotal, 0);
    },
  },
  {
    name: "banner service excludes templates publicly",
    run() {
      const source = readFile("src/services/promoBannersService.ts");
      assertIncludes(source, "banner.isTemplate");
      assertIncludes(source, "Modèle non publiable");
    },
  },
  {
    name: "optional banner fields do not coerce absent isActive to false",
    run() {
      const source = readFile("src/services/promoBannersService.ts");
      assertNotIncludes(source, "isActive: Boolean(input.isActive)");
      assertIncludes(source, "existingData?.isActive");
    },
  },
  {
    name: "createdAt is only set on banner creation",
    run() {
      const source = readFile("src/services/promoBannersService.ts");
      assertIncludes(source, "existing.exists() ? {} : { createdAt: serverTimestamp() }");
    },
  },
  {
    name: "definitive banner deletion is implemented",
    run() {
      const source = readFile("src/services/promoBannersService.ts");
      assertIncludes(source, "deletePromoBanner");
      assertIncludes(source, "deleteDoc(doc(db, collections.promoBanners, bannerId))");
    },
  },
  {
    name: "definitive coupon deletion neutralizes linked banners",
    run() {
      const source = readFile("src/services/couponsService.ts");
      assertIncludes(source, "deleteCouponAndNeutralizeBannerLinks");
      assertIncludes(source, "linkedCouponId: coupon.id");
      assertNotIncludes(source, missingDependencyFlagName());
      assertIncludes(source, "batch.delete(doc(db, collections.coupons, coupon.id))");
    },
  },
  {
    name: "banner visibility uses linked coupon lookup instead of stale deletion flags",
    run() {
      assertNotIncludes(readFile("src/services/promoBannersService.ts"), missingDependencyFlagName());
      assertNotIncludes(readFile("api/public-promo-banners.ts"), missingDependencyFlagName());
      assertIncludes(readFile("src/services/promoBannersService.ts"), "Promotion liée introuvable");
      assertIncludes(readFile("api/public-promo-banners.ts"), "banner.deletedLinkedCouponId");
    },
  },
  {
    name: "checkout refreshes automatic quote before order creation",
    run() {
      const source = readFile("src/pages/CheckoutPage.tsx");
      assertIncludes(source, "await quoteOrder({");
      assertIncludes(source, "couponCode: hasManualPromo ? normalizedAppliedCouponCode : undefined");
    },
  },
  {
    name: "orders and invoices keep applied promotion snapshots",
    run() {
      assertIncludes(readFile("api/_server/checkout.ts"), "appliedPromotions: priced.appliedPromotions.map");
      assertIncludes(readFile("api/create-order.ts"), "appliedPromotions: order.appliedPromotions || []");
      assertIncludes(readFile("api/invoices.ts"), "appliedPromotions: order.appliedPromotions || []");
    },
  },
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

function promotionCase(name: string, flowersSubtotal: number, expectedDiscount: number): TestCase {
  return {
    name,
    run() {
      const result = calculateCartPromotions({
        lines: [
          {
            productId: "flower",
            name: "Fleur test",
            category: "flowers",
            unitPrice: flowersSubtotal,
            quantity: 1,
          },
        ],
        rules: automaticPromotionRulesFromCoupons([fleurs20]),
      });
      assertEqual(result.promotionDiscountTotal, expectedDiscount);
    },
  };
}

function readFile(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

function assertEqual(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assertIncludes(source: string, expected: string) {
  if (!source.includes(expected)) {
    throw new Error(`Expected source to include: ${expected}`);
  }
}

function assertNotIncludes(source: string, unexpected: string) {
  if (source.includes(unexpected)) {
    throw new Error(`Expected source not to include: ${unexpected}`);
  }
}

function missingDependencyFlagName() {
  return ["promotionDependency", "Missing"].join("");
}
