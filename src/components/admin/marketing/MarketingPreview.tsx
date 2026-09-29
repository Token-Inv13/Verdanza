import type { Coupon, PromoBanner } from "../../../types";
import type { MarketingContext, MarketingKind, MarketingParameters } from "../../../types/marketing";
import { formatMarketingDate } from "../../../lib/adminMarketingDates";
import { promotionAvailability } from "../../../lib/promotionDates";
import { promoBannerVisibility } from "../../../services/promoBannersService";

export function MarketingPreview({ kind, parameters, context }: { kind: MarketingKind; parameters: MarketingParameters; context: MarketingContext }) {
  const p = parameters.promotion;
  const b = parameters.banner;
  const c = parameters.contest;
  const products = (ids?: string[]) => ids?.map((id) => context.products.find((product) => product.id === id)?.name || `${id} (introuvable)`).join(", ") || "Tout le catalogue";
  const linked = b && context.coupons.find((coupon) => b.linkedCouponId ? coupon.id === b.linkedCouponId : Boolean(b.linkedPromoCode) && coupon.code === b.linkedPromoCode);
  const simulatedCoupon: Coupon | undefined = p ? { ...p, id: "campaign-preview", isActive: true, usedCount: 0 } : undefined;
  const previewBanner: PromoBanner | undefined = b ? { ...b, id: "admin-preview", isActive: true, ...(kind === "campaign" ? { linkedCouponId: simulatedCoupon?.id, linkedPromoCode: p?.autoApply ? "" : p?.code } : {}) } : undefined;
  const visibility = previewBanner && promoBannerVisibility(previewBanner, { linkedCoupon: kind === "campaign" ? simulatedCoupon : linked, hasLinkedCouponLookup: true });
  const linkedState = !linked ? "absente" : ({ active: "active", scheduled: "future", inactive: "inactive", expired: "expirée", max_uses: "limite atteinte" })[promotionAvailability(linked)];
  const shownCode = kind === "campaign" ? p?.autoApply ? "" : p?.code : linked?.autoApply ? "" : b?.linkedPromoCode || linked?.code;
  const typeLabels = { fixed_cart_discount: "Montant fixe panier", fixed_category_discount: "Montant fixe catégorie", threshold_extra_discount: "Offert après seuil", percentage_cart_discount: "Pourcentage panier", percentage_category_discount: "Pourcentage catégorie", free_shipping: "Livraison offerte", tiered_product_gift: "Cadeau produit par paliers" };
  return <section aria-label="Prévisualisation Marketing" className="grid gap-4 rounded-xl border border-forest/15 bg-cream/60 p-4">
    <div><h3 className="font-display text-2xl text-forest">Prévisualisation privée</h3><p className="text-sm text-ink/60">Aucun objet publié pour cet aperçu. Dates en Europe/Paris ; stockage en UTC.</p></div>
    {p && <div className="grid gap-2 text-sm">
      <h4 className="font-semibold text-forest">{p.label || "Promotion à nommer"} · {p.code || "Code à préciser"}</h4>
      <dl className="grid gap-2 sm:grid-cols-2">
        <Info label="Type / valeur" value={`${p.promotionType ? typeLabels[p.promotionType] : p.discountType} · ${p.discountValue}${p.discountType === "percent" ? " %" : " €"}${p.discountType === "free_shipping" ? " · livraison postale offerte" : ""}`} />
        <Info label="Application" value={p.autoApply ? "Automatique dans le panier" : "Code à saisir"} />
        <Info label="Produits / catégories" value={`${products(p.productIds)} · ${p.categories?.join(", ") || p.eligibleCategory || "Toutes catégories"}`} />
        <Info label="Minimum / catégorie" value={`${p.minimumOrder} € · minimum ciblé ${p.minEligibleSubtotal || 0} €`} />
        <Info label="Seuil / offert" value={`${p.paidThresholdAmount || 0} € payés · ${p.maxGiftAmount || 0} € offerts`} />
        <Info label="Plafond / limite" value={`${p.maxDiscountAmount || "Sans plafond"} · ${p.maxUses || "Illimitée"}`} />
        <Info label="Cumul / priorité" value={`${p.stackable ? "Cumulable" : "Non cumulable"} · ${p.priority ?? 10}`} />
        <Info label="Période" value={`${formatMarketingDate(p.startsAt)} → ${formatMarketingDate(p.endsAt, "end")}`} />
      </dl>
      {p.promotionType === "tiered_product_gift" && <><Info label="Paliers cadeaux" value={p.giftTiers?.map((tier) => `${tier.minimumSubtotal} € → ${tier.quantityGrams} g`).join(" ; ") || "Aucun palier"} /><Info label="Cadeaux" value={`${products(p.giftProductIds)} · ${p.giftSelectionMode || "customer_choice"} · défaut ${p.defaultGiftProductId || "aucun"}`} /><Info label="Qualification" value={`${p.qualifyingScope || "cart_subtotal"} · ${p.qualifyingCategories?.join(", ") || ""} · ${products(p.qualifyingProductIds)}`} /></>}
      <p>Impact prévu : application par le moteur actuel aux commandes éligibles pendant la période confirmée. Les compteurs d'utilisation restent inchangés.</p>
      {(p.isTemplate || p.isArchived) && <p className="text-amber-900">Modèle ou archive : activation bloquée.</p>}
    </div>}
    {b && <div className="grid gap-3">
      <div className={`${b.type === "top_bar" ? "border-b px-4 py-3 shadow-sm" : "rounded-lg border px-4 py-4"} ${b.variant === "promo" ? "border-champagne/50 bg-[#f8efd9]" : b.variant === "delivery" ? "border-forest/15 bg-forest/5" : b.variant === "warning" ? "border-champagne/50 bg-[#fff8eb]" : b.variant === "info" ? "border-forest/10 bg-cream" : "border-forest/10 bg-ivory"}`}>
        {b.variant === "promo" && <span className="rounded-full border border-champagne/40 px-2 py-1 text-xs font-semibold text-forest">Offre</span>}
        <strong className="mt-2 block text-sm text-forest">{b.title || "Titre de bannière"}</strong><p className="mt-1 text-sm leading-6 text-ink/70">{b.message || "Message de bannière"}</p>
        {shownCode && <p className="mt-2 text-xs font-semibold text-forest">Code : {shownCode}</p>}
        {b.buttonLabel && <span className="btn-secondary mt-3 inline-flex min-h-9 px-3 py-2 text-xs">{b.buttonLabel}</span>}
        {b.dismissible && <span className="ml-3 text-forest/60" aria-label="Bannière refermable">×</span>}
      </div>
      <p className="text-sm">{b.type} · {(b.placements || [b.placement]).join(", ")} · priorité {b.priority} · {b.variant} · CTA {b.buttonUrl || "aucun"}</p>
      <p className="text-sm">{formatMarketingDate(b.startsAt)} → {formatMarketingDate(b.endsAt, "end")}</p>
      {(b.linkedCouponId || b.linkedPromoCode || kind === "campaign") && <p className="text-sm font-semibold">{kind === "campaign" ? "Promotion préparée avec la bannière ; activation commune requise." : `Promotion liée : ${linkedState}.`}</p>}
      {visibility && <p className="text-sm text-amber-900">Après confirmation {kind === "campaign" ? "de la campagne" : "de la bannière"} : {visibility.visible ? "affichage possible selon le placement" : visibility.label}. La visibilité dépend aussi de la promotion liée.</p>}
    </div>}
    {c && <div className="grid gap-2 text-sm"><h4 className="font-semibold text-forest">{c.title}</h4><p>{c.description}</p><Info label="Période" value={`${formatMarketingDate(c.startAt)} → ${formatMarketingDate(c.endAt, "end")}`} /><Info label="Tirage prévu" value={formatMarketingDate(c.drawAt)} /><Info label="Récompense" value={`${c.prizeValue} € · bon Verdanza · expiration ${c.prizeExpirationDays} jours`} /><p>{c.eligibilityConditions}</p><p>Règlement : {c.rulesUrl || c.rulesText || "À compléter"}</p><p>La confirmation ouvre ou programme le concours. Le tirage, le gagnant, le coupon protégé et l'invitation nécessitent leurs actions dédiées.</p></div>}
  </section>;
}
function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-semibold uppercase text-forest/60">{label}</dt><dd className="break-words">{value}</dd></div>; }
