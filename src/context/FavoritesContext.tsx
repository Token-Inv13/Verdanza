import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "./AuthContext";
import {
  addFavorite,
  getUserFavorites,
  removeFavorite,
} from "../services/favoritesService";
import type { Product, ProductFavorite } from "../types";

type FavoritesContextValue = {
  favorites: ProductFavorite[];
  favoriteIds: Set<string>;
  isLoading: boolean;
  toggleFavorite: (product: Product) => Promise<"added" | "removed">;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<ProductFavorite[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setFavorites([]);
      return undefined;
    }
    setIsLoading(true);
    getUserFavorites(user.uid)
      .then((items) => {
        if (!cancelled) setFavorites(items);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const toggleFavorite = useCallback(
    async (product: Product) => {
      if (!user) throw new Error("Connectez-vous pour enregistrer ce produit dans vos favoris.");
      const exists = favorites.some((favorite) => favorite.productId === product.id);
      if (exists) {
        await removeFavorite(user.uid, product.id);
        setFavorites((current) =>
          current.filter((favorite) => favorite.productId !== product.id),
        );
        return "removed" as const;
      }
      await addFavorite(user.uid, product);
      setFavorites((current) => [
        ...current,
        {
          id: `${user.uid}_${product.id}`,
          userId: user.uid,
          productId: product.id,
          productName: product.name,
          productCategory: product.category,
          productImage: product.image,
        },
      ]);
      return "added" as const;
    },
    [favorites, user],
  );

  const value = useMemo(
    () => ({
      favorites,
      favoriteIds: new Set(favorites.map((favorite) => favorite.productId)),
      isLoading,
      toggleFavorite,
    }),
    [favorites, isLoading, toggleFavorite],
  );

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useFavorites() {
  const context = useContext(FavoritesContext);
  if (!context) throw new Error("useFavorites must be used inside FavoritesProvider");
  return context;
}
