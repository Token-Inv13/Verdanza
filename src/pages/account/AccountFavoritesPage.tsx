import { Link } from "react-router-dom";
import { ShoppingBag, Trash2 } from "lucide-react";
import { ProductImage } from "../../components/ProductImage";
import { useCart } from "../../context/CartContext";
import { useFavorites } from "../../context/FavoritesContext";
import { useProducts } from "../../hooks/useProducts";

export function AccountFavoritesPage() {
  const { favorites, isLoading, toggleFavorite } = useFavorites();
  const { products } = useProducts();
  const { addItem } = useCart();

  if (isLoading) {
    return <p className="text-forest/70">Chargement de vos favoris...</p>;
  }

  return (
    <section className="rounded-lg border border-forest/10 bg-ivory p-6">
      <h2 className="font-display text-3xl text-forest">Mes favoris</h2>
      {!favorites.length && (
        <div className="mt-5 rounded-md border border-forest/10 bg-cream p-5">
          <p className="text-forest">Vous n’avez encore aucun produit en favori.</p>
          <Link to="/boutique" className="btn-primary mt-4 inline-flex">
            Parcourir la boutique
          </Link>
        </div>
      )}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {favorites.map((favorite) => {
          const product = products.find((entry) => entry.id === favorite.productId);
          const canOrder = Boolean(
            product &&
              product.isActive &&
              product.stock > 0 &&
              !product.comingSoon &&
              product.stockStatus !== "coming_soon",
          );
          return (
            <article
              key={favorite.id}
              className="rounded-lg border border-forest/10 bg-cream p-4"
            >
              <ProductImage
                variant="card"
                src={product?.image || favorite.productImage}
                alt={favorite.productName}
                loading="lazy"
                className="h-36 w-full object-contain"
              />
              <p className="mt-3 text-xs uppercase tracking-[0.14em] text-champagne">
                {favorite.productCategory === "flowers" ? "Fleur CBD" : "Résine CBD"}
              </p>
              <h3 className="mt-1 font-display text-2xl text-forest">
                {favorite.productName}
              </h3>
              {product && (
                <p className="mt-2 font-display text-xl text-forest">
                  {product.price.toFixed(2).replace(".", ",")} EUR/g
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {product && (
                  <Link to={`/produits/${product.slug}`} className="btn-secondary">
                    Voir le produit
                  </Link>
                )}
                {canOrder && product && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => addItem(product.id)}
                  >
                    <ShoppingBag size={16} /> Ajouter
                  </button>
                )}
                {product && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Retirer ${product.name} des favoris`}
                    onClick={() => void toggleFavorite(product)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
