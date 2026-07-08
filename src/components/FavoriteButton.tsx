import { useState } from "react";
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
  const isFavorite = favoriteIds.has(product.id);

  async function handleClick() {
    if (!user) {
      setMessage("Connectez-vous pour enregistrer ce produit dans vos favoris.");
      return;
    }
    try {
      const result = await toggleFavorite(product);
      setMessage(result === "added" ? "Ajouté aux favoris." : "Retiré des favoris.");
    } catch {
      setMessage("Impossible de modifier les favoris. Réessayez.");
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        className={`icon-button bg-ivory/95 ${isFavorite ? "text-red-700" : "text-forest"}`}
        aria-label={
          isFavorite
            ? `Retirer ${product.name} des favoris`
            : `Ajouter ${product.name} aux favoris`
        }
        aria-pressed={isFavorite}
        title={isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
        onClick={() => void handleClick()}
      >
        <Heart size={18} fill={isFavorite ? "currentColor" : "none"} />
      </button>
      {message && (
        <p className="mt-2 max-w-56 text-xs leading-5 text-forest">{message}</p>
      )}
    </div>
  );
}
