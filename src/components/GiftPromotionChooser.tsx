import type { GiftPromotionQuote } from "../types";
import { tieredGiftProgressMessage } from "../lib/tieredProductGifts";

export function GiftPromotionChooser({
  promotions,
  onSelect,
}: {
  promotions: GiftPromotionQuote[];
  onSelect: (promotionId: string, productId: string) => void;
}) {
  if (!promotions.length) return null;
  return (
    <div className="grid min-w-0 gap-4" aria-live="polite">
      {promotions.map((promotion) => {
        const selected = promotion.availableProducts.find(
          (product) => product.productId === promotion.selectedProductId,
        );
        return (
          <section
            key={promotion.promotionId}
            className="min-w-0 rounded-lg border border-champagne/40 bg-ivory p-4"
          >
            <p className="font-semibold text-forest">{promotion.label}</p>
            <p className="mt-1 text-sm leading-6 text-forest/75">
              {tieredGiftProgressMessage(promotion)}
            </p>
            {promotion.selectionAdjusted && (
              <p className="mt-2 text-xs text-amber-800">
                Votre précédent choix n’était plus disponible. Une référence disponible a été sélectionnée.
              </p>
            )}
            {promotion.unlockedQuantityGrams > 0 && !promotion.unavailable && (
              <div className="mt-4 grid min-w-0 auto-rows-fr grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-3">
                {promotion.availableProducts.map((product) => {
                  const isSelected = product.productId === promotion.selectedProductId;
                  return (
                    <button
                      key={product.productId}
                      type="button"
                      className={`flex h-full min-w-0 flex-col overflow-hidden rounded-lg border p-3 text-left transition ${
                        isSelected
                          ? "border-forest bg-cream ring-2 ring-forest/15"
                          : "border-forest/15 bg-white hover:border-forest/40"
                      }`}
                      onClick={() => onSelect(promotion.promotionId, product.productId)}
                      aria-pressed={isSelected}
                    >
                      <img
                        src={product.image}
                        alt=""
                        className="aspect-square w-full rounded-md object-cover"
                      />
                      <strong className="mt-2 block min-w-0 break-words text-sm leading-tight text-forest [overflow-wrap:anywhere]">
                        {product.name}
                      </strong>
                      <span className="mt-1 block text-xs leading-4 text-ink/55">
                        <span className="block">
                          {promotion.unlockedQuantityGrams} g offert
                          {promotion.unlockedQuantityGrams > 1 ? "s" : ""}
                        </span>
                        <span className="block break-words [overflow-wrap:anywhere]">
                          Stock disponible : {product.availableStock} g
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {selected && promotion.unlockedQuantityGrams > 0 && (
              <div className="mt-4 flex min-w-0 items-start justify-between gap-3 rounded-md bg-forest px-3 py-2 text-sm text-ivory">
                <span className="min-w-0 break-words leading-5 [overflow-wrap:anywhere]">
                  {selected.name} — cadeau promotion — {promotion.unlockedQuantityGrams} g
                </span>
                <strong className="shrink-0 whitespace-nowrap">0,00 €</strong>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
