import { Link } from "react-router-dom";
import { ShoppingBag } from "lucide-react";
import { useCart } from "../context/CartContext";
import type { Product } from "../types";
import { trackEvent } from "../lib/analytics";

function productImageAlt(product: Product) {
  return `${product.name} - ${
    product.category === "flowers" ? "Fleur CBD" : "Résine CBD"
  } Verdanza`;
}

export function ProductCard({ product }: { product: Product }) {
  const { addItem } = useCart();

  return (
    <article className="group overflow-hidden rounded-lg border border-forest/10 bg-ivory shadow-sm transition hover:-translate-y-1 hover:shadow-soft">
      <Link to={`/produits/${product.slug}`} className="block bg-cream p-6">
        <img
          src={product.image}
          alt={productImageAlt(product)}
          className="mx-auto h-48 w-full object-contain transition group-hover:scale-105"
        />
      </Link>
      <div className="space-y-4 p-5">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-champagne">
            {product.category === "flowers" ? "Fleur CBD" : "Resine CBD"}
          </p>
          <Link
            to={`/produits/${product.slug}`}
            className="mt-1 block font-display text-2xl text-forest"
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
            <dt className="text-ink/45">CBG</dt>
            <dd>{product.cbgRate}</dd>
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
          <button
            className="icon-button"
            aria-label={`Ajouter ${product.name} au panier`}
            onClick={() => {
              addItem(product.id);
              trackEvent("add_to_cart", {
                productId: product.id,
                productName: product.name,
                price: product.price,
              });
            }}
            title="Ajouter au panier"
          >
            <ShoppingBag size={18} />
          </button>
        </div>
      </div>
    </article>
  );
}
