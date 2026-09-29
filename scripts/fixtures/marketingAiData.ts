import { randomUUID } from "node:crypto";
import type { MarketingAiBrief, MarketingAiContext } from "../../src/types/marketingAi.js";
import type { MarketingKind } from "../../src/types/marketing.js";
export const aiNow = new Date("2026-09-28T12:00:00.000Z");
export const aiBrief: MarketingAiBrief = { objective: "Mettre en avant les résines", kind: "campaign", scope: "all", tone: "discovery", count: 3 };
export const aiContext: MarketingAiContext = { now: aiNow.toISOString(), timeZone: "Europe/Paris", products: [{ id: "ai-product", name: "Résine fixture", category: "resins", price: 10, stock: 100, formats: [], tags: ["catalogue"], aromas: ["boisé"] }] };
export function aiPayload(kind: MarketingKind = "campaign", count = 1) {
  const startsAt = "2026-09-29T12:00:00.000Z", endsAt = "2026-10-04T12:00:00.000Z";
  return { proposals: Array.from({ length: count }, (_, i) => ({ kind, title: `Découverte résines ${i + 1}`, concept: `Concept privé ${i + 1}`, rationale: "Un produit réellement disponible dans la sélection.", referencedProductIds: ["ai-product"],
    promotion: ["promotion", "campaign"].includes(kind) ? { code: `AI_${randomUUID().replaceAll("-", "").toUpperCase()}`, label: "Découverte résines", discountType: "percent", discountValue: 10, minimumOrder: 20, promotionType: "percentage_category_discount", autoApply: false, stackable: false, priority: 10, eligibleCategory: "resins", minEligibleSubtotal: null, paidThresholdAmount: null, maxGiftAmount: null, maxDiscountAmount: 15, maxUses: 30, startsAt, endsAt, productIds: ["ai-product"], categories: ["resins"], giftProductIds: [], giftTiers: [], giftSelectionMode: null, defaultGiftProductId: null, qualifyingScope: null, qualifyingCategories: [], qualifyingProductIds: [] } : null,
    banner: ["banner", "campaign"].includes(kind) ? { title: "Découverte résines", message: "Découvrez notre sélection de résines.", type: "shop_card", placement: "shop", placements: ["shop"], startsAt, endsAt, priority: 10, buttonLabel: "Découvrir", buttonUrl: "/boutique", variant: "promo", dismissible: true } : null,
    contest: kind === "contest" ? { title: "Concours découverte", slug: `concours-fixture-${randomUUID()}`, description: "Participation gratuite et sans obligation d'achat.", prizeValue: 30, prizeType: "store_credit", startAt: startsAt, endAt: endsAt, drawAt: "2026-10-05T12:00:00.000Z", rulesUrl: "", rulesText: "Règlement de test suffisamment détaillé, participation gratuite.", eligibilityConditions: "Personnes majeures uniquement.", prizeExpirationDays: 30 } : null
  })) };
}
