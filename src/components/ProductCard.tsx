import { Link, useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import type { MouseEvent } from "react";
import { useState } from "react";
import { useCart } from "../context/CartContext";
import { publicProductStockLabel } from "../lib/cartStock";
import {
  productPurchaseCtaLabel,
  productPurchaseOptionLabel,
  resolveProductPurchaseOptions,
} from "../lib/productPurchaseOptions";
import type { Product } from "../types";
import { trackAddToCart, trackSelectItem } from "../lib/analytics";
import { FavoriteButton } from "./FavoriteButton";
import { ProductImage } from "./ProductImage";
import { QualityBadge } from "./QualityBadge";

function productImageAlt(product: Product) {
  return product.imageAlt || `${product.name} - ${
    product.category === "flowers" ? "Fleur CBD" : "Résine CBD"
  } Verdanza`;
}

export function ProductCard({
  product,
  priorityImage = false,
  itemListId,
  itemListName,
}: {
  product: Product;
  priorityImage?: boolean;
  itemListId?: string;
  itemListName?: string;
}) {
  const navigate = useNavigate();
  const { addItem, addFixedPriceOption, items } = useCart();
  const [selectedPurchaseOptionId, setSelectedPurchaseOptionId] = useState("gram");
  const stockLabel = publicProductStockLabel(product);
  const purchaseOptions = resolveProductPurchaseOptions(product, items);
  const selectedPurchaseOption =
    purchaseOptions.find(
      (option) => option.id === selectedPurchaseOptionId && option.available,
    ) || purchaseOptions.find((option) => option.available);
  const purchaseAvailabilityLabel = selectedPurchaseOption
    ? stockLabel
    : stockLabel !== "Disponible"
      ? stockLabel
      : "Stock déjà réservé dans votre panier";
  const hasKnownCbd = product.cbdRate && product.cbdRate !== "Non communiqué";
  const secondaryFact =
    product.cbgRate && product.cbgRate !== "Non communiqué"
      ? { label: "CBG", value: product.cbgRate }
      : product.cbnRate
        ? { label: "CBN", value: product.cbnRate }
        : { label: "Origine", value: product.origin };
  const primaryFact = hasKnownCbd
    ? { label: "CBD", value: product.cbdRate }
    : { label: product.category === "flowers" ? "Culture" : "Type", value: product.cultureType };
  const productUrl = `/produits/${product.slug}`;

  function handleCardClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, select, textarea, [role='button']")) return;
    trackSelectItem(product, itemListId, itemListName);
    navigate(productUrl);
  }

  function handleAddToCart() {
    if (!selectedPurchaseOption) return;
    if (selectedPurchaseOption.fixedPriceOptionId) {
      addFixedPriceOption(product.id, selectedPurchaseOption.fixedPriceOptionId);
    } else {
      addItem(product.id);
    }
    trackAddToCart(product, selectedPurchaseOption.quantityGrams);
  }

  return (
    <article
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border border-forest/10 bg-ivory shadow-sm transition hover:-translate-y-1 hover:shadow-soft focus-within:ring-2 focus-within:ring-champagne/60"
      onClick={handleCardClick}
    >
      <FavoriteButton product={product} className="absolute right-3 top-3 z-10" />
      <Link
        to={productUrl}
        className="block aspect-square bg-cream p-6"
        onClick={() => trackSelectItem(product, itemListId, itemListName)}
      >
        <ProductImage
          variant="card"
          src={product.image}
          alt={productImageAlt(product)}
          loading={priorityImage ? "eager" : "lazy"}
          fetchPriority={priorityImage ? "high" : "auto"}
          className="mx-auto h-full w-full object-contain transition group-hover:scale-105"
        />
      </Link>
      <div className="flex flex-1 flex-col space-y-3 p-5">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-champagne">
                {product.category === "flowers" ? "Fleur CBD" : "Résine CBD"}
              </span>
              {product.cultureType === "Hydroponique" && (
                <span className="tag">Hydroponique</span>
              )}
            </div>
            {product.qualitySealEnabled && <QualityBadge variant="compact" />}
          </div>
          <Link
            to={productUrl}
            className="mt-1 block font-display text-2xl text-forest"
            onClick={() => trackSelectItem(product, itemListId, itemListName)}
          >
            {product.name}
          </Link>
        </div>
        <p className="min-h-14 text-sm leading-6 text-ink/70">
          {product.shortDescription}
        </p>
        <dl className="grid grid-cols-3 gap-2 text-xs text-forest/75">
          <div>
            <dt className="text-ink/45">{primaryFact.label}</dt>
            <dd>{primaryFact.value}</dd>
          </div>
          <div>
            <dt className="text-ink/45">{secondaryFact.label}</dt>
            <dd>{secondaryFact.value}</dd>
          </div>
          <div>
            <dt className="text-ink/45">THC</dt>
            <dd>{product.thcRate}</dd>
          </div>
        </dl>
        <div className="mt-auto space-y-3">
          {purchaseOptions.length > 0 && (
            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-forest/55">
                Format
              </legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {purchaseOptions.map((option) => {
                  const selected = option.id === selectedPurchaseOption?.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={`relative min-h-10 rounded-md border px-2 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 ${
                        selected
                          ? "border-forest/55 bg-sage/25 text-forest shadow-[inset_0_0_0_1px_rgba(11,61,46,0.08)]"
                          : "border-forest/15 bg-ivory text-forest hover:border-forest/30 hover:bg-sage/10"
                      } disabled:cursor-not-allowed disabled:border-forest/10 disabled:bg-cream/50 disabled:text-ink/35 disabled:opacity-100 disabled:hover:border-forest/10 disabled:hover:bg-cream/50`}
                      aria-pressed={selected}
                      disabled={!option.available}
                      title={option.available ? undefined : "Stock insuffisant pour ce format"}
                      onClick={() => setSelectedPurchaseOptionId(option.id)}
                    >
                      {selected && (
                        <Check
                          size={13}
                          className="absolute right-1.5 top-1.5 text-forest/70"
                          aria-hidden="true"
                        />
                      )}
                      {productPurchaseOptionLabel(option)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
          <button
            type="button"
            className="btn-primary min-h-11 w-full px-3 py-2.5 disabled:cursor-not-allowed disabled:bg-forest/45 disabled:text-ivory/80"
            disabled={!selectedPurchaseOption}
            onClick={handleAddToCart}
          >
            {selectedPurchaseOption
              ? `Ajouter ${productPurchaseCtaLabel(selectedPurchaseOption)}`
              : stockLabel !== "Disponible"
                ? stockLabel
                : "Stock restant insuffisant"}
          </button>
          <p className="text-xs font-semibold text-forest/65">{purchaseAvailabilityLabel}</p>
        </div>
      </div>
    </article>
  );
}
