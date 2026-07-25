import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  automaticPromotionRulesFromCoupons,
  calculateCartPromotions,
} from "../src/lib/cartPromotions.ts";
import {
  buildAssociatedPromoBannerInput,
  findAssociatedPromoBanner,
} from "../src/services/promoBannersService.ts";
import type { Coupon, PromoBanner } from "../src/types/index.js";

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
    name: "promotion banner association is created and updated without duplicates",
    run() {
      const coupon: Coupon = {
        id: "welcome10",
        code: "WELCOME10",
        label: "Welcome10",
        discountType: "percent",
        discountValue: 10,
        minimumOrder: 15,
        usedCount: 1,
        isActive: true,
      };

      const created = buildAssociatedPromoBannerInput({
        coupon,
        banners: [],
        title: coupon.label,
        message: "Pourcentage : 10 % a partir de 15 EUR.",
      });
      assertEqual(created.id, "banner-welcome10");
      assertEqual(created.linkedCouponId, "welcome10");
      assertEqual(created.linkedPromoCode, "WELCOME10");
      assertEqual(created.isActive, false);
      assertEqual(created.isArchived, false);
      assertEqual(created.isTemplate, false);

      const adminBanners = [asPromoBanner(created)];
      assertEqual(
        findAssociatedPromoBanner(adminBanners, coupon)?.id,
        "banner-welcome10",
      );
      assertEqual(adminBanners.filter((banner) => !banner.isTemplate).length, 1);

      const secondSave = buildAssociatedPromoBannerInput({
        coupon,
        banners: adminBanners,
        title: "Welcome10 ete",
        message: "Pourcentage : 10 % a partir de 15 EUR.",
      });
      assertEqual(secondSave.id, "banner-welcome10");
      assertEqual(secondSave.title, "Welcome10 ete");
      assertEqual(
        new Set([adminBanners[0].id, secondSave.id]).size,
        1,
      );

      const existingLinked = asPromoBanner({
        ...created,
        id: "custom-welcome-banner",
        linkedCouponId: "",
        linkedPromoCode: "WELCOME10",
        isActive: true,
        placements: ["home", "shop"],
      });
      const updated = buildAssociatedPromoBannerInput({
        coupon,
        banners: [existingLinked],
        title: "Welcome10",
        message: "Message mis a jour.",
      });
      assertEqual(updated.id, "custom-welcome-banner");
      assertEqual(updated.linkedCouponId, "welcome10");
      assertEqual(updated.linkedPromoCode, "WELCOME10");
      assertEqual(updated.isActive, true);
      assertEqual(updated.placements?.join(","), "home,shop");
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
      assertNotIncludes(readFile("api/quote-order.ts"), missingDependencyFlagName());
      assertIncludes(readFile("src/services/promoBannersService.ts"), "Promotion liée introuvable");
      assertIncludes(readFile("api/quote-order.ts"), "banner.deletedLinkedCouponId");
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

function asPromoBanner(input: Partial<PromoBanner> & { id?: string }): PromoBanner {
  return {
    id: input.id || "banner",
    title: input.title || "Banner",
    message: input.message || "Message",
    type: input.type || "top_bar",
    placement: input.placement || "home",
    placements: input.placements || ["home"],
    isActive: input.isActive === true,
    startsAt: input.startsAt || "",
    endsAt: input.endsAt || "",
    priority: Number(input.priority || 10),
    buttonLabel: input.buttonLabel || "",
    buttonUrl: input.buttonUrl || "",
    linkedCouponId: input.linkedCouponId || "",
    linkedPromoCode: input.linkedPromoCode || "",
    deletedLinkedCouponId: input.deletedLinkedCouponId || "",
    variant: input.variant || "promo",
    dismissible: input.dismissible === true,
    isArchived: input.isArchived === true,
    isTemplate: input.isTemplate === true,
  };
}

function missingDependencyFlagName() {
  return ["promotionDependency", "Missing"].join("");
}
