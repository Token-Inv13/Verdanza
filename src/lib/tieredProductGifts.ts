import type {
  AppliedPromotion,
  Coupon,
  GiftPromotionQuote,
  OrderItem,
  Product,
  ProductGiftTier,
  PromotionSelection,
} from "../types/index.js";
import { orderItemLineTotal } from "./orderLineDisplay.js";
import { promotionAvailability } from "./promotionDates.js";

export type TieredGiftEvaluation = {
  quote: GiftPromotionQuote;
  giftItem?: OrderItem;
  appliedPromotion?: AppliedPromotion;
  qualifyingSubtotal: number;
  tier?: ProductGiftTier;
};

export function evaluateTieredProductGift(input: {
  promotion: Coupon;
  paidItems: OrderItem[];
  products: Product[];
  selection?: PromotionSelection;
  now?: Date;
}): TieredGiftEvaluation | null {
  const { promotion, paidItems, products } = input;
  if (
    promotion.promotionType !== "tiered_product_gift" ||
    promotionAvailability(promotion, input.now) !== "active"
  ) {
    return null;
  }
  const tiers = normalizeGiftTiers(promotion.giftTiers || []);
  if (!tiers.length) return null;
  const qualifyingSubtotal = qualifyingGiftSubtotal(promotion, paidItems);
  const tier = [...tiers].reverse().find((entry) => qualifyingSubtotal >= entry.minimumSubtotal);
  const nextTier = tiers.find((entry) => qualifyingSubtotal < entry.minimumSubtotal);
  const requiredQuantity = tier?.quantityGrams || tiers[0].quantityGrams;
  const purchasedByProduct = paidItems.reduce((result, item) => {
    if (!item.isGift) {
      result.set(item.productId, Number(result.get(item.productId) || 0) + Number(item.quantity || 0));
    }
    return result;
  }, new Map<string, number>());
  const configuredIds = new Set(promotion.giftProductIds || []);
  const availableProducts = products
    .filter((product) => configuredIds.has(product.id) && product.isActive)
    .map((product) => ({
      productId: product.id,
      name: product.name,
      image: product.image || "",
      unitPrice: Number(product.price || 0),
      availableStock: Math.max(
        0,
        Math.floor(Number(product.stock || 0) - Number(purchasedByProduct.get(product.id) || 0)),
      ),
    }))
    .filter((product) => product.availableStock >= requiredQuantity);
  const requestedId =
    promotion.giftSelectionMode !== "automatic_first_available" &&
    input.selection?.promotionId === promotion.id
      ? input.selection.giftProductId
      : "";
  const requestedAvailable = availableProducts.some((product) => product.productId === requestedId);
  const defaultAvailable = availableProducts.some(
    (product) => product.productId === promotion.defaultGiftProductId,
  );
  const selectedProductId = requestedAvailable
    ? requestedId
    : defaultAvailable
      ? promotion.defaultGiftProductId
      : availableProducts[0]?.productId;
  const selectionAdjusted = Boolean(requestedId && requestedId !== selectedProductId);
  const quote: GiftPromotionQuote = {
    promotionId: promotion.id,
    label: promotion.label || promotion.code,
    unlockedQuantityGrams: tier?.quantityGrams || 0,
    selectedProductId,
    availableProducts,
    ...(nextTier
      ? {
          nextTier: {
            minimumSubtotal: nextTier.minimumSubtotal,
            missingAmount: roundMoney(nextTier.minimumSubtotal - qualifyingSubtotal),
            quantityGrams: nextTier.quantityGrams,
          },
        }
      : {}),
    ...(selectionAdjusted ? { selectionAdjusted: true } : {}),
    ...(!availableProducts.length ? { unavailable: true } : {}),
  };
  if (!tier || !selectedProductId || !availableProducts.length) {
    return { quote, qualifyingSubtotal, tier };
  }
  const selectedProduct = products.find((product) => product.id === selectedProductId);
  if (!selectedProduct) return { quote: { ...quote, unavailable: true }, qualifyingSubtotal, tier };
  const commercialValue = roundMoney(Number(selectedProduct.price || 0) * tier.quantityGrams);
  const appliedPromotion: AppliedPromotion = {
    id: promotion.id,
    label: promotion.label || promotion.code,
    type: "tiered_product_gift",
    applicationMode: "automatic",
    discountAmount: 0,
    eligibleSubtotal: qualifyingSubtotal,
    couponId: promotion.id,
    couponCode: promotion.code,
    giftTierId: tier.id,
    giftMinimumSubtotal: tier.minimumSubtotal,
    giftProductId: selectedProduct.id,
    giftProductName: selectedProduct.name,
    giftQuantityGrams: tier.quantityGrams,
    giftUnitPriceSnapshot: Number(selectedProduct.price || 0),
    giftCommercialValue: commercialValue,
  };
  const giftItem: OrderItem = {
    lineId: `gift:${promotion.id}:${selectedProduct.id}`,
    productId: selectedProduct.id,
    productInternalReference: selectedProduct.internalReference || "",
    name: selectedProduct.name,
    quantity: tier.quantityGrams,
    unitPrice: 0,
    lineTotal: 0,
    purchaseMode: "gram",
    slug: selectedProduct.slug,
    category: selectedProduct.category,
    cultureType: selectedProduct.cultureType,
    isGift: true,
    promotionId: promotion.id,
    promotionLabel: promotion.label || promotion.code,
    giftUnitPriceSnapshot: Number(selectedProduct.price || 0),
  };
  return { quote, giftItem, appliedPromotion, qualifyingSubtotal, tier };
}

export function qualifyingGiftSubtotal(promotion: Coupon, paidItems: OrderItem[]) {
  const scope = promotion.qualifyingScope || "cart_subtotal";
  const categories = new Set(promotion.qualifyingCategories || []);
  const productIds = new Set(promotion.qualifyingProductIds || []);
  return roundMoney(
    paidItems.reduce((sum, item) => {
      const lineTotal = orderItemLineTotal(item);
      if (item.isGift || Number(item.unitPrice || 0) <= 0 || lineTotal <= 0) return sum;
      if (scope === "categories" && (!item.category || !categories.has(item.category))) return sum;
      if (scope === "products" && !productIds.has(item.productId)) return sum;
      return sum + lineTotal;
    }, 0),
  );
}

export function normalizeGiftTiers(tiers: ProductGiftTier[]) {
  return [...tiers]
    .map((tier) => ({
      id: String(tier.id || "").trim(),
      minimumSubtotal: roundMoney(Number(tier.minimumSubtotal || 0)),
      quantityGrams: Math.floor(Number(tier.quantityGrams || 0)),
    }))
    .sort((left, right) => left.minimumSubtotal - right.minimumSubtotal);
}

export function validateTieredProductGift(
  promotion: Pick<
    Coupon,
    | "promotionType"
    | "giftTiers"
    | "giftProductIds"
    | "defaultGiftProductId"
    | "qualifyingScope"
    | "qualifyingCategories"
    | "qualifyingProductIds"
    | "startsAt"
    | "endsAt"
  >,
) {
  if (promotion.promotionType !== "tiered_product_gift") return [];
  const issues: string[] = [];
  const tiers = normalizeGiftTiers(promotion.giftTiers || []);
  if (!tiers.length) issues.push("Ajoutez au moins un palier cadeau.");
  if (tiers.some((tier) => !tier.id || tier.minimumSubtotal <= 0 || tier.quantityGrams <= 0)) {
    issues.push("Chaque palier doit avoir un identifiant, un montant et une quantité strictement positifs.");
  }
  if (new Set(tiers.map((tier) => tier.minimumSubtotal)).size !== tiers.length) {
    issues.push("Les montants de palier doivent être uniques.");
  }
  if (tiers.some((tier, index) => index > 0 && tier.quantityGrams < tiers[index - 1].quantityGrams)) {
    issues.push("Les quantités offertes doivent être non décroissantes.");
  }
  if (!promotion.giftProductIds?.length) issues.push("Sélectionnez au moins un produit cadeau.");
  if (
    promotion.defaultGiftProductId &&
    !promotion.giftProductIds?.includes(promotion.defaultGiftProductId)
  ) {
    issues.push("Le produit cadeau par défaut doit faire partie de la sélection.");
  }
  if (promotion.qualifyingScope === "categories" && !promotion.qualifyingCategories?.length) {
    issues.push("Sélectionnez au moins une catégorie qualifiante.");
  }
  if (promotion.qualifyingScope === "products" && !promotion.qualifyingProductIds?.length) {
    issues.push("Sélectionnez au moins un produit qualifiant.");
  }
  if (promotion.startsAt && promotion.endsAt && Date.parse(promotion.endsAt) <= Date.parse(promotion.startsAt)) {
    issues.push("La date de fin doit être postérieure à la date de début.");
  }
  return issues;
}

export function tieredGiftProgressMessage(quote: GiftPromotionQuote) {
  if (quote.unavailable) return "L’offre cadeau est temporairement épuisée.";
  if (!quote.unlockedQuantityGrams && quote.nextTier) {
    return `Plus que ${formatEuro(quote.nextTier.missingAmount)} pour recevoir ${quote.nextTier.quantityGrams} g offert${quote.nextTier.quantityGrams > 1 ? "s" : ""}.`;
  }
  if (quote.nextTier) {
    return `Ajoutez encore ${formatEuro(quote.nextTier.missingAmount)} pour passer à ${quote.nextTier.quantityGrams} g offerts.`;
  }
  return `Vous bénéficiez de ${quote.unlockedQuantityGrams} g offerts.`;
}

function formatEuro(value: number) {
  return `${roundMoney(value).toFixed(2).replace(".", ",")} €`;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
