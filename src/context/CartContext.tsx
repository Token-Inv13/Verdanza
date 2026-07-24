import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  availableProductStock,
  isProductOrderable,
} from "../lib/cartStock";
import { getProductsWithFallback } from "../services/productsService";
import type { CartItem, Product } from "../types";

type CartLine = CartItem & {
  product: Product;
  lineTotal: number;
};

type CartContextValue = {
  items: CartItem[];
  lines: CartLine[];
  itemCount: number;
  subtotal: number;
  addItem: (productId: string) => void;
  decrementItem: (productId: string) => void;
  setItemQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const storageKey = "verdanza-cart";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? (JSON.parse(stored) as CartItem[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    let cancelled = false;
    getProductsWithFallback()
      .then((result) => {
        if (!cancelled) setCatalog(result.products);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const addItem = useCallback((productId: string) => {
    const product = catalog.find((entry) => entry.id === productId);
    if (!isProductOrderable(product)) {
      return;
    }
    const maxQuantity = availableProductStock(product);
    setItems((current) => {
      const existing = current.find((item) => item.productId === productId);
      if (!existing) return [...current, { productId, quantity: 1 }];
      return current.map((item) =>
        item.productId === productId
          ? { ...item, quantity: Math.min(item.quantity + 1, maxQuantity) }
          : item,
      );
    });
  }, [catalog]);

  const decrementItem = useCallback((productId: string) => {
    setItems((current) =>
      current
        .map((item) =>
          item.productId === productId
            ? { ...item, quantity: item.quantity - 1 }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }, []);

  const setItemQuantity = useCallback(
    (productId: string, quantity: number) => {
      const product = catalog.find((entry) => entry.id === productId);
      const maxQuantity = isProductOrderable(product) ? availableProductStock(product) : 0;
      const nextQuantity = Math.min(Math.max(0, Math.floor(quantity)), maxQuantity);

      setItems((current) => {
        if (nextQuantity <= 0) {
          return current.filter((item) => item.productId !== productId);
        }
        const existing = current.find((item) => item.productId === productId);
        if (!existing) return [...current, { productId, quantity: nextQuantity }];
        return current.map((item) =>
          item.productId === productId ? { ...item, quantity: nextQuantity } : item,
        );
      });
    },
    [catalog],
  );

  const removeItem = useCallback((productId: string) => {
    setItems((current) => current.filter((item) => item.productId !== productId));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const value = useMemo<CartContextValue>(() => {
    const lines = items
      .map((item) => {
        const product = catalog.find((entry) => entry.id === item.productId);
        if (!product) return null;
        return {
          ...item,
          product,
          lineTotal: product.price * item.quantity,
        };
      })
      .filter((line): line is CartLine => Boolean(line));

    return {
      items,
      lines,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: lines.reduce((sum, line) => sum + line.lineTotal, 0),
      addItem,
      decrementItem,
      setItemQuantity,
      removeItem,
      clearCart,
    };
  }, [addItem, catalog, clearCart, decrementItem, items, removeItem, setItemQuantity]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside CartProvider");
  return context;
}
