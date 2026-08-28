import type {
  AppliedPromotion,
  Coupon,
  OrderItem,
  ProductCategory,
  PromotionRuleType,
} from "../types/index.js";
import { promotionBoundaryTimestamp } from "./promotionDates.js";

export type PromotionCartLine = {
  productId: string;
  name?: string;
  category?: ProductCategory;
  quantity: number;
  unitPrice: number;
  lineTotal?: number;
};

type PromotionLine = PromotionCartLine | OrderItem;

export type PromotionRule = {
  id: string;
  label: string;
  active: boolean;
  autoApply: boolean;
  type: PromotionRuleType;
  eligibleCategory?: ProductCategory;
  eligibleCategories?: ProductCategory[];
  minCartSubtotal?: number;
  minEligibleSubtotal?: number;
  paidThresholdAmount?: number;
  maxGiftAmount?: number;
  discountAmount?: number;
  discountPercent?: number;
  maxDiscountAmount?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  priority?: number;
  stackable?: boolean;
  couponCode?: string;
  couponId?: string;
  applicationMode?: "automatic" | "code";
  productIds?: string[];
};

export type CartPromotionResult = {
  subtotalBeforePromotion: number;
  subtotalAfterPromotion: number;
  promotionDiscountTotal: number;
  appliedPromotions: AppliedPromotion[];
  progressMessages: string[];
};

export const LAUNCH_FLOWERS_PROMOTION: PromotionRule = {
  id: "launch-flowers-20-off-30",
  label: "Offre Verdanza : 20 € de fleurs offerts",
  active: true,
  autoApply: true,
  type: "threshold_extra_discount",
  eligibleCategory: "flowers",
  paidThresholdAmount: 30,
  maxGiftAmount: 20,
  priority: 10,
  stackable: false,
};

export const BUILT_IN_AUTOMATIC_PROMOTIONS: PromotionRule[] = [
  LAUNCH_FLOWERS_PROMOTION,
];

export function calculateCartPromotions(input: {
  lines: PromotionLine[];
  rules?: PromotionRule[];
  now?: Date;
}): CartPromotionResult {
  const rules = input.rules ?? [];
  const subtotalBeforePromotion = roundMoney(
    input.lines.reduce(
      (sum, line) => sum + promotionLineTotal(line),
      0,
    ),
  );
  const activeRules = rules
    .filter((rule) => isRuleUsable(rule, input.now ?? new Date()))
    .sort((left, right) => Number(left.priority || 0) - Number(right.priority || 0));

  const candidates = activeRules
    .map((rule) => evaluatePromotionRule(rule, input.lines, subtotalBeforePromotion))
    .filter((entry): entry is AppliedPromotion => Boolean(entry && entry.discountAmount > 0));

  const nonStackable = candidates.filter((entry) => {
    const rule = activeRules.find((candidate) => candidate.id === entry.id);
    return rule?.stackable !== true;
  });
  const stackable = candidates.filter((entry) => {
    const rule = activeRules.find((candidate) => candidate.id === entry.id);
    return rule?.stackable === true;
  });

  // MVP rule: automatic promotions do not stack by default. If several
  // non-stackable promotions are eligible, the best discount wins.
  const bestNonStackable = nonStackable.sort(
    (left, right) => right.discountAmount - left.discountAmount,
  )[0];
  const appliedPromotions = bestNonStackable ? [bestNonStackable] : [];

  // Stackable automatic promotions are intentionally not combined yet. This
  // avoids unexpected stacking until an explicit Admin rule defines ordering.
  void stackable;

  const promotionDiscountTotal = roundMoney(
    Math.min(
      subtotalBeforePromotion,
      appliedPromotions.reduce((sum, promotion) => sum + promotion.discountAmount, 0),
    ),
  );

  return {
    subtotalBeforePromotion,
    subtotalAfterPromotion: roundMoney(subtotalBeforePromotion - promotionDiscountTotal),
    promotionDiscountTotal,
    appliedPromotions,
    progressMessages: buildProgressMessages(activeRules, input.lines, subtotalBeforePromotion),
  };
}

export function automaticPromotionRulesFromCoupons(
  coupons: Coupon[] = [],
  options: { includeBuiltInFallback?: boolean } = {},
) {
  const couponRules = coupons
    .map(promotionRuleFromCoupon)
    .filter((rule): rule is PromotionRule => Boolean(rule));

  return dedupePromotionRules([
    ...couponRules,
    ...(options.includeBuiltInFallback ? BUILT_IN_AUTOMATIC_PROMOTIONS : []),
  ]);
}

export function promotionRuleFromCoupon(coupon: Coupon): PromotionRule | null {
  if (!coupon.autoApply) return null;
  return promotionRuleFromCouponDefinition(coupon, "automatic");
}

export function promotionRuleFromCouponDefinition(
  coupon: Coupon,
  applicationMode: "automatic" | "code",
): PromotionRule {
  const categories = coupon.categories ?? [];
  const type =
    coupon.promotionType ??
    inferPromotionType(coupon.discountType, coupon.eligibleCategory ?? categories[0]);
  const eligibleCategory = coupon.eligibleCategory ?? categories[0];

  return {
    id: coupon.id || coupon.code,
    label: coupon.label || coupon.code,
    active: coupon.isActive && !coupon.isArchived && !couponHasReachedMaxUses(coupon),
    autoApply: applicationMode === "automatic",
    type,
    eligibleCategory,
    eligibleCategories: Array.from(
      new Set([...(categories ?? []), ...(eligibleCategory ? [eligibleCategory] : [])]),
    ),
    minCartSubtotal: Number(coupon.minimumOrder || 0),
    minEligibleSubtotal: Number(coupon.minEligibleSubtotal || coupon.minimumOrder || 0),
    paidThresholdAmount: Number(coupon.paidThresholdAmount || 0),
    maxGiftAmount: Number(coupon.maxGiftAmount || 0),
    discountAmount: coupon.discountType === "fixed" ? Number(coupon.discountValue || 0) : 0,
    discountPercent: coupon.discountType === "percent" ? Number(coupon.discountValue || 0) : 0,
    maxDiscountAmount: coupon.maxDiscountAmount,
    startsAt: coupon.startsAt ?? null,
    endsAt: coupon.endsAt ?? null,
    priority: coupon.priority,
    stackable: coupon.stackable,
    couponCode: coupon.code,
    couponId: coupon.id,
    applicationMode,
    productIds: coupon.productIds ?? [],
  };
}

function inferPromotionType(
  discountType: Coupon["discountType"],
  eligibleCategory?: ProductCategory,
): PromotionRuleType {
  if (discountType === "free_shipping") return "free_shipping";
  if (discountType === "percent") {
    return eligibleCategory ? "percentage_category_discount" : "percentage_cart_discount";
  }
  return eligibleCategory ? "fixed_category_discount" : "fixed_cart_discount";
}

export function evaluatePromotionRule(
  rule: PromotionRule,
  lines: PromotionLine[],
  subtotal: number,
): AppliedPromotion | null {
  if (rule.type === "free_shipping") return null;
  const categoryScope = rule.eligibleCategories?.length
    ? rule.eligibleCategories
    : rule.eligibleCategory;
  const eligibleSubtotal =
    rule.productIds?.length
      ? productsSubtotal(lines, rule.productIds)
      : rule.type === "fixed_category_discount" ||
          rule.type === "percentage_category_discount" ||
          rule.type === "threshold_extra_discount"
        ? categorySubtotal(lines, categoryScope)
        : subtotal;

  if (subtotal < Number(rule.minCartSubtotal || 0)) return null;
  const minimumEligibleSubtotal =
    rule.type === "threshold_extra_discount"
      ? Number(rule.paidThresholdAmount || 0)
      : Number(rule.minEligibleSubtotal || 0);
  if (eligibleSubtotal < minimumEligibleSubtotal) return null;
  if (eligibleSubtotal <= 0) return null;

  const rawDiscount =
    rule.type === "threshold_extra_discount"
      ? Math.min(
          Number(rule.maxGiftAmount || 0),
          Math.max(0, eligibleSubtotal - Number(rule.paidThresholdAmount || 0)),
        )
      : rule.type === "percentage_cart_discount" ||
          rule.type === "percentage_category_discount"
        ? eligibleSubtotal * (Number(rule.discountPercent || 0) / 100)
        : Number(rule.discountAmount || 0);
  const cappedDiscount = rule.maxDiscountAmount
    ? Math.min(rawDiscount, Number(rule.maxDiscountAmount))
    : rawDiscount;
  const discountAmount = roundMoney(Math.min(cappedDiscount, subtotal));

  if (discountAmount <= 0) return null;
  const label =
    rule.type === "threshold_extra_discount"
      ? `Offre Verdanza : ${formatPromotionEuro(discountAmount).replace(
          ",00",
          "",
        )} de fleurs offerts`
      : rule.label;
  return {
    id: rule.id,
    label,
    type: rule.type,
    applicationMode: rule.applicationMode ?? (rule.autoApply ? "automatic" : "code"),
    discountAmount,
    eligibleSubtotal: roundMoney(eligibleSubtotal),
    eligibleCategory: rule.eligibleCategory,
    eligibleCategories: rule.eligibleCategories?.length
      ? rule.eligibleCategories
      : rule.eligibleCategory
        ? [rule.eligibleCategory]
        : [],
    productIds: rule.productIds,
    couponId: rule.couponId,
    couponCode: rule.couponCode,
  };
}

function buildProgressMessages(
  rules: PromotionRule[],
  lines: PromotionLine[],
  subtotal: number,
) {
  return rules
    .map((rule) => {
      if (
        rule.type !== "fixed_category_discount" &&
        rule.type !== "threshold_extra_discount"
      ) {
        return "";
      }
      const eligibleCategories = rule.eligibleCategories?.length
        ? rule.eligibleCategories
        : rule.eligibleCategory;
      if (!eligibleCategories) return "";
      const eligibleSubtotal = categorySubtotal(lines, eligibleCategories);
      if (rule.type === "threshold_extra_discount") {
        const paidThresholdAmount = Number(rule.paidThresholdAmount || 0);
        const maxGiftAmount = Number(rule.maxGiftAmount || 0);
        const missing = paidThresholdAmount - eligibleSubtotal;
        if (missing > 0 && subtotal > 0 && eligibleSubtotal > 0) {
          return `Encore ${formatPromotionEuro(missing)} de fleurs CBD pour débloquer l'offre : jusqu'à ${formatPromotionEuro(
            maxGiftAmount,
          )} offerts.`;
        }
        if (eligibleSubtotal === paidThresholdAmount && paidThresholdAmount > 0) {
          return `Offre débloquée : ajoutez jusqu'à ${formatPromotionEuro(
            maxGiftAmount,
          )} de fleurs CBD offertes.`;
        }
        return "";
      }
      const missing = Number(rule.minEligibleSubtotal || 0) - eligibleSubtotal;
      if (missing <= 0 || subtotal <= 0 || eligibleSubtotal <= 0) return "";
      return `Encore ${formatPromotionEuro(missing)} de fleurs CBD pour profiter de l'offre : ${formatPromotionEuro(
        Number(rule.discountAmount || 0),
      )} offerts.`;
    })
    .filter(Boolean);
}

function categorySubtotal(
  lines: PromotionLine[],
  category?: ProductCategory | ProductCategory[],
) {
  if (!category) return 0;
  const categories = Array.isArray(category) ? new Set(category) : new Set([category]);
  return roundMoney(
    lines.reduce((sum, line) => {
      if (!line.category || !categories.has(line.category)) return sum;
      return sum + promotionLineTotal(line);
    }, 0),
  );
}

function productsSubtotal(
  lines: PromotionLine[],
  productIds: string[],
) {
  const eligibleProductIds = new Set(productIds);
  return roundMoney(
    lines.reduce((sum, line) => {
      if (!eligibleProductIds.has(line.productId)) return sum;
      return sum + promotionLineTotal(line);
    }, 0),
  );
}

function isRuleUsable(rule: PromotionRule, now: Date) {
  if (!rule.active || !rule.autoApply) return false;
  const nowTime = now.getTime();
  const startsAt = promotionBoundaryTimestamp(rule.startsAt, "start");
  const endsAt = promotionBoundaryTimestamp(rule.endsAt, "end");
  if (startsAt && nowTime < startsAt) return false;
  if (endsAt && nowTime > endsAt) return false;
  return true;
}

function couponHasReachedMaxUses(coupon: Coupon) {
  return Boolean(
    coupon.maxUses &&
      Number(coupon.maxUses || 0) > 0 &&
      Number(coupon.usedCount || 0) >= Number(coupon.maxUses || 0),
  );
}

function dedupePromotionRules(rules: PromotionRule[]) {
  const seen = new Set<string>();
  return rules.filter((rule) => {
    const key = rule.couponCode || rule.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatPromotionEuro(value: number) {
  return `${roundMoney(value).toFixed(2).replace(".", ",")} €`;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function promotionLineTotal(line: PromotionLine) {
  const configured = Number(line.lineTotal);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return Number(line.unitPrice || 0) * Number(line.quantity || 0);
}
