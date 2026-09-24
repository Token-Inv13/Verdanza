import { Link, useNavigate } from "react-router-dom";
import { useId, useState, type MouseEvent } from "react";
import { ShoppingBag } from "lucide-react";
import { useCart } from "../context/CartContext";
import { publicProductStockLabel } from "../lib/cartStock";
import {
  formatProductPrice,
  productPurchaseOptionLabel,
  resolveProductPurchaseOptions,
} from "../lib/productPurchaseOptions";
import { resolveProductCardPresentation } from "../lib/productPresentation";
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
  const formatSelectId = useId();
  const { addItem, addFixedPriceOption, items } = useCart();
  const [selectedPurchaseOptionId, setSelectedPurchaseOptionId] = useState("gram");
  const stockLabel = publicProductStockLabel(product);
  const presentation = resolveProductCardPresentation(product);
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
  const productUrl = `/produits/${product.slug}`;
  const titleId = `product-card-title-${product.id}`;

  function handleCardClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, select, textarea, label, [role='button']")) return;
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
      className="product-card-v2 group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-[0.9rem] border border-champagne/45 bg-ivory shadow-[0_12px_34px_rgba(11,61,46,0.07)] focus-within:ring-2 focus-within:ring-champagne/60"
      aria-labelledby={titleId}
      onClick={handleCardClick}
    >
      <div className="relative border-b border-champagne/35 bg-gradient-to-b from-ivory to-cream/35 px-5 pb-4 pt-5">
        <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-forest/60">
          {presentation.categoryLabel}
        </span>
        <Link
          id={titleId}
          to={productUrl}
          className="mt-1.5 block font-display text-[1.8rem] leading-[1.05] text-forest"
          onClick={() => trackSelectItem(product, itemListId, itemListName)}
        >
          {product.name}
        </Link>
        <div className="relative mt-3 aspect-[4/3] overflow-hidden rounded-[0.7rem] border border-forest/[0.08] bg-[#fcfbf7]">
          <Link
            to={productUrl}
            className="block h-full w-full px-4 py-3"
            onClick={() => trackSelectItem(product, itemListId, itemListName)}
          >
            <ProductImage
              variant="card"
              src={product.image}
              alt={productImageAlt(product)}
              loading={priorityImage ? "eager" : "lazy"}
              fetchPriority={priorityImage ? "high" : "auto"}
              className="product-card-v2__image mx-auto h-full w-full object-contain"
            />
          </Link>
          {product.qualitySealEnabled && (
            <QualityBadge
              variant="compact"
              className="pointer-events-none absolute left-2.5 top-2.5 z-10 bg-forest"
            />
          )}
          <FavoriteButton product={product} className="absolute right-2.5 top-2.5 z-20" />
        </div>
        <ul
          className="mt-2.5 flex min-h-5 flex-wrap justify-center gap-x-1.5 gap-y-0 text-center text-[0.72rem] leading-5 text-forest/65"
          aria-label={`Profil aromatique : ${presentation.aromaProfile.join(", ")}`}
        >
          {presentation.aromaProfile.map((aroma, index) => (
            <li key={aroma} className="inline-flex items-center whitespace-nowrap">
              {index > 0 && <span className="mr-1.5 text-champagne" aria-hidden="true">·</span>}
              {aroma}
            </li>
          ))}
        </ul>
        <div className="mt-3 border-t border-champagne/30 pt-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-baseline gap-2">
              <span className="block text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ink/45">
                Intensité
              </span>
              <span className="block text-xs font-semibold text-forest">
                {presentation.intensityLabel}
              </span>
            </div>
            <span
              className="flex gap-1.5"
              role="img"
              aria-label={`Intensité ${presentation.intensityLabel.toLowerCase()}`}
            >
              {[1, 2, 3].map((level) => (
                <span
                  key={level}
                  aria-hidden="true"
                  className={`h-2.5 w-2.5 rounded-full border border-champagne ${
                    level <= presentation.intensityLevel ? "bg-forest" : "bg-ivory"
                  }`}
                />
              ))}
            </span>
          </div>
          {presentation.appearance.length > 0 && (
            <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.68rem] leading-5 text-forest/65">
              {presentation.appearance.map((value, index) => (
                <div key={value} className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-champagne" aria-hidden="true" />
                  <dt className="sr-only">{index === 0 ? "Aspect" : "Détail"}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4" data-floating-help-suppress>
        <div className="flex items-end justify-between gap-3">
          <div>
            <span className="block text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ink/45">
              Prix
            </span>
            <span className="mt-1 block font-display text-2xl leading-none text-forest">
              {selectedPurchaseOption?.fixedPriceOptionId
                ? `${formatProductPrice(selectedPurchaseOption.totalPrice)} · ${selectedPurchaseOption.quantityGrams} g`
                : `${formatProductPrice(product.price)}/g`}
            </span>
            {selectedPurchaseOption?.fixedPriceOptionId && (
              <span className="mt-1 block text-[0.68rem] text-forest/55">
                {formatProductPrice(selectedPurchaseOption.totalPrice / selectedPurchaseOption.quantityGrams)}/g
              </span>
            )}
          </div>
          <span
            className={`text-right text-xs font-semibold ${
              selectedPurchaseOption ? "text-forest/65" : "text-red-700"
            }`}
          >
            {purchaseAvailabilityLabel}
          </span>
        </div>

        {purchaseOptions.length > 1 && (
          <div className="mt-3">
            <label
              htmlFor={formatSelectId}
              className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ink/45"
            >
              Format
            </label>
            <select
              id={formatSelectId}
              value={selectedPurchaseOption?.id ?? ""}
              onChange={(event) => setSelectedPurchaseOptionId(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border border-forest/15 bg-ivory px-3 text-sm text-forest outline-none transition focus:border-champagne focus:ring-2 focus:ring-champagne/30"
              aria-label={`Choisir le format de ${product.name}`}
            >
              {!selectedPurchaseOption && <option value="" disabled>Aucun format disponible</option>}
              {purchaseOptions.map((option) => (
                <option key={option.id} value={option.id} disabled={!option.available}>
                  {productPurchaseOptionLabel(option)}
                  {!option.available ? " · indisponible" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-auto pt-2.5">
          <button
            type="button"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-forest px-4 py-2.5 text-sm font-semibold text-ivory transition-colors hover:bg-[#082f24] focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-forest/35"
            aria-label={selectedPurchaseOption
              ? `Ajouter ${selectedPurchaseOption.quantityGrams} g de ${product.name} au panier`
              : `${product.name} : ${purchaseAvailabilityLabel}`}
            disabled={!selectedPurchaseOption}
            onClick={handleAddToCart}
          >
            <ShoppingBag size={17} />
            {selectedPurchaseOption ? "Ajouter au panier" : purchaseAvailabilityLabel}
          </button>
        </div>
      </div>
    </article>
  );
}
