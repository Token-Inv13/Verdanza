import { Link } from "react-router-dom";
import { ShoppingBag } from "lucide-react";
import { useCart } from "../context/CartContext";
import type { Product } from "../types";
import { trackAddToCart, trackSelectItem } from "../lib/analytics";
import { FavoriteButton } from "./FavoriteButton";
import { ProductImage } from "./ProductImage";

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
  const { addItem } = useCart();
  const isComingSoon = product.comingSoon || product.stockStatus === "coming_soon";
  const secondaryFact =
    product.cbgRate && product.cbgRate !== "Non communiqué"
      ? { label: "CBG", value: product.cbgRate }
      : product.cbnRate
        ? { label: "CBN", value: product.cbnRate }
        : { label: "Origine", value: product.origin };

  return (
    <article className="group relative overflow-hidden rounded-lg border border-forest/10 bg-ivory shadow-sm transition hover:-translate-y-1 hover:shadow-soft">
      <FavoriteButton product={product} className="absolute right-3 top-3 z-10" />
      <Link
        to={`/produits/${product.slug}`}
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-champagne">
              {product.category === "flowers" ? "Fleur CBD" : "Résine CBD"}
            </span>
            {product.productTier && <span className="tag">{product.productTier}</span>}
            {product.cultureType === "Hydroponique" && (
              <span className="tag">Hydroponique</span>
            )}
          </div>
          <Link
            to={`/produits/${product.slug}`}
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
            <dt className="text-ink/45">CBD</dt>
            <dd>{product.cbdRate}</dd>
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
          {!isComingSoon && (
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
        {isComingSoon && (
          <p className="rounded-md border border-champagne/35 bg-cream px-3 py-2 text-sm font-semibold text-forest">
            {product.stockLabel || "En arrivage chez Verdanza"}
          </p>
        )}
      </div>
    </article>
  );
}
