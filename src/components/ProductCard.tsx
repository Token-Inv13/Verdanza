import { Link, useNavigate } from "react-router-dom";
import type { KeyboardEvent, MouseEvent } from "react";
import { ShoppingBag } from "lucide-react";
import { useCart } from "../context/CartContext";
import { isProductOrderable, publicProductStockLabel } from "../lib/cartStock";
import type { Product } from "../types";
import { trackAddToCart, trackSelectItem } from "../lib/analytics";
import { FavoriteButton } from "./FavoriteButton";
import { ProductImage } from "./ProductImage";
import { QualityBadge } from "./QualityBadge";

function productImageAlt(product: Product) {
  return `${product.name} - ${
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
  const { addItem } = useCart();
  const isOrderable = isProductOrderable(product);
  const stockLabel = publicProductStockLabel(product);
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

  function handleCardKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    trackSelectItem(product, itemListId, itemListName);
    navigate(productUrl);
  }

  return (
    <article
      className="group relative cursor-pointer overflow-hidden rounded-lg border border-forest/10 bg-ivory shadow-sm transition hover:-translate-y-1 hover:shadow-soft focus-within:ring-2 focus-within:ring-champagne/60"
      role="link"
      tabIndex={0}
      aria-label={`Voir la fiche ${product.name}`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
    >
      <FavoriteButton product={product} className="absolute right-3 top-3 z-10" />
      <Link
        to={productUrl}
        className="block bg-cream p-6"
        onClick={() => trackSelectItem(product, itemListId, itemListName)}
      >
        <ProductImage
          variant="card"
          src={product.image}
          alt={productImageAlt(product)}
          loading={priorityImage ? "eager" : "lazy"}
          fetchPriority={priorityImage ? "high" : "auto"}
          className="mx-auto h-48 w-full object-contain transition group-hover:scale-105"
        />
      </Link>
      <div className="space-y-4 p-5">
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
        <div className="flex items-center justify-between gap-3">
          <span className="font-display text-2xl text-forest">
            {product.price.toFixed(2).replace(".", ",")} EUR/g
          </span>
          {isOrderable && (
            <button
              className="icon-button"
              aria-label={`Ajouter ${product.name} au panier`}
              onClick={() => {
                addItem(product.id);
                trackAddToCart(product);
              }}
              title="Ajouter au panier"
            >
              <ShoppingBag size={18} />
            </button>
          )}
        </div>
        {isOrderable ? (
          <p className="text-xs font-semibold text-forest/65">
            {stockLabel}
          </p>
        ) : (
          <p className="rounded-md border border-champagne/35 bg-cream px-3 py-2 text-sm font-semibold text-forest">
            {stockLabel}
          </p>
        )}
      </div>
    </article>
  );
}
