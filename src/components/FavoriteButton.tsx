import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Heart } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useFavorites } from "../context/FavoritesContext";
import type { Product } from "../types";

export function FavoriteButton({
  product,
  className = "",
}: {
  product: Product;
  className?: string;
}) {
  const { user } = useAuth();
  const { favoriteIds, toggleFavorite } = useFavorites();
  const [message, setMessage] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const isFavorite = favoriteIds.has(product.id);

  useEffect(() => {
    if (!message) return undefined;
    const timeout = window.setTimeout(() => setMessage(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [message]);

  async function handleClick() {
    if (!user) {
      setMessage("Connectez-vous pour ajouter ce produit à vos favoris.");
      return;
    }
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      const result = await toggleFavorite(product);
      setMessage(result === "added" ? "Ajouté aux favoris." : "Retiré des favoris.");
    } catch {
      setMessage("Impossible de modifier les favoris. Réessayez.");
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <>
      <div className={`h-11 w-11 ${className}`}>
        <button
          type="button"
          className={`icon-button h-11 w-11 px-0 shadow-sm ${
            isFavorite
              ? "border-champagne bg-champagne text-forest hover:bg-champagne"
              : "bg-ivory/95 text-forest"
          }`}
          aria-label={
            isFavorite
              ? `Retirer ${product.name} des favoris`
              : `Ajouter ${product.name} aux favoris`
          }
          aria-pressed={isFavorite}
          disabled={isUpdating}
          title={isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
          onClick={() => void handleClick()}
        >
          <Heart size={18} fill={isFavorite ? "currentColor" : "none"} />
        </button>
      </div>
      {message &&
        createPortal(
          <div
            className="fixed bottom-5 left-1/2 z-[100] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-md border border-champagne/40 bg-forest px-4 py-3 text-center text-sm font-medium text-ivory shadow-soft"
            role="status"
            aria-live="polite"
          >
            {message}
          </div>,
          document.body,
        )}
    </>
  );
}
