import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { isProductOrderable } from "../lib/cartStock";
import { remainingProductStock } from "../lib/productPurchaseOptions";
import {
  cartItemKey,
  fixedPriceEffectiveUnitPrice,
  fixedPriceLineTotal,
  fixedPriceQuantityGrams,
  normalizeCartItems,
  positiveInteger,
  resolveFixedPriceOptions,
  sameCartLine,
} from "../lib/fixedPriceOptions";
import { getProductsWithFallback } from "../services/productsService";
import type { CartItem, FixedPriceOption, Product } from "../types";

type CartLine = CartItem & {
  lineKey: string;
  product: Product;
  quantityGrams: number;
  lineTotal: number;
  unitPrice: number;
  fixedPriceOption?: FixedPriceOption;
};

type CartContextValue = {
  items: CartItem[];
  lines: CartLine[];
  cartWarnings: string[];
  hasBlockingCartIssues: boolean;
  itemCount: number;
  subtotal: number;
  addItem: (productId: string) => void;
  addFixedPriceOption: (productId: string, fixedPriceOptionId: string) => void;
  incrementLine: (lineKey: string) => void;
  decrementLine: (lineKey: string) => void;
  setLineQuantity: (lineKey: string, quantity: number) => void;
  removeLine: (lineKey: string) => void;
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
      return stored ? normalizeCartItems(JSON.parse(stored)) : [];
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
    if (!product || !isProductOrderable(product)) {
      return;
    }
    setItems((current) => {
      if (remainingProductStock(product, current) < 1) return current;
      const target = { productId, quantity: 1, purchaseMode: "gram" as const };
      const existing = current.find((item) => sameCartLine(item, target));
      if (!existing) return [...current, target];
      return current.map((item) =>
        sameCartLine(item, target)
          ? { ...item, quantity: item.quantity + 1 }
          : item,
      );
    });
  }, [catalog]);

  const addFixedPriceOption = useCallback((productId: string, fixedPriceOptionId: string) => {
    const product = catalog.find((entry) => entry.id === productId);
    if (!product || !isProductOrderable(product)) return;
    const option = resolveFixedPriceOptions(product).find(
      (entry) => entry.id === fixedPriceOptionId,
    );
    if (!option) return;
    const target = {
      productId,
      quantity: 1,
      purchaseMode: "fixed_price" as const,
      fixedPriceOptionId,
    };
    setItems((current) => {
      if (remainingProductStock(product, current) < option.quantityGrams) return current;
      const existing = current.find((item) => sameCartLine(item, target));
      if (!existing) return [...current, target];
      return current.map((item) =>
        sameCartLine(item, target)
          ? { ...item, quantity: item.quantity + 1 }
          : item,
      );
    });
  }, [catalog]);

  const updateLineQuantity = useCallback((
    lineKey: string,
    updater: (current: CartItem) => number,
  ) => {
    setItems((current) =>
      current
        .map((item) => {
          if (cartItemKey(item) !== lineKey) return item;
          const product = catalog.find((entry) => entry.id === item.productId);
          const requested = positiveInteger(updater(item));
          if (!product || !isProductOrderable(product) || requested <= 0) return null;
          const availableForLine = remainingProductStock(product, current, lineKey);
          if (item.purchaseMode === "fixed_price") {
            const option = resolveFixedPriceOptions(product).find(
              (entry) => entry.id === item.fixedPriceOptionId,
            );
            if (!option) return null;
            const maxQuantity = Math.floor(availableForLine / option.quantityGrams);
            const nextQuantity = Math.min(requested, maxQuantity);
            return nextQuantity > 0 ? { ...item, quantity: nextQuantity } : null;
          }
          return {
            ...item,
            quantity: Math.min(requested, availableForLine),
            purchaseMode: "gram" as const,
          };
        })
        .filter((item): item is CartItem => Boolean(item)),
    );
  }, [catalog]);

  const incrementLine = useCallback((lineKey: string) => {
    updateLineQuantity(lineKey, (item) => item.quantity + 1);
  }, [updateLineQuantity]);

  const decrementLine = useCallback((lineKey: string) => {
    updateLineQuantity(lineKey, (item) => item.quantity - 1);
  }, [updateLineQuantity]);

  const setLineQuantity = useCallback((lineKey: string, quantity: number) => {
    updateLineQuantity(lineKey, () => quantity);
  }, [updateLineQuantity]);

  const removeLine = useCallback((lineKey: string) => {
    setItems((current) => current.filter((item) => cartItemKey(item) !== lineKey));
  }, []);

  const decrementItem = useCallback((productId: string) => {
    const target = { productId, purchaseMode: "gram" as const };
    setItems((current) =>
      current
        .map((item) =>
          sameCartLine(item, target)
            ? { ...item, quantity: item.quantity - 1 }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }, []);

  const setItemQuantity = useCallback(
    (productId: string, quantity: number) => {
      const product = catalog.find((entry) => entry.id === productId);
      const requested = Math.max(0, Math.floor(quantity));
      const target = { productId, purchaseMode: "gram" as const };

      setItems((current) => {
        const maxQuantity = product && isProductOrderable(product)
          ? remainingProductStock(product, current, cartItemKey(target))
          : 0;
        const nextQuantity = Math.min(requested, maxQuantity);
        if (nextQuantity <= 0) {
          return current.filter((item) => !sameCartLine(item, target));
        }
        const existing = current.find((item) => sameCartLine(item, target));
        if (!existing) return [...current, { productId, quantity: nextQuantity, purchaseMode: "gram" }];
        return current.map((item) =>
          sameCartLine(item, target) ? { ...item, quantity: nextQuantity } : item,
        );
      });
    },
    [catalog],
  );

  const removeItem = useCallback((productId: string) => {
    const target = { productId, purchaseMode: "gram" as const };
    setItems((current) => current.filter((item) => !sameCartLine(item, target)));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const value = useMemo<CartContextValue>(() => {
    const cartWarnings = catalog.length === 0 ? [] : items.flatMap((item) => {
      if (item.purchaseMode !== "fixed_price") return [];
      const product = catalog.find((entry) => entry.id === item.productId);
      if (!product) return ["Un format prix fixe de votre panier n'est plus disponible."];
      const fixedPriceOption = resolveFixedPriceOptions(product).find(
        (entry) => entry.id === item.fixedPriceOptionId,
      );
      return fixedPriceOption
        ? []
        : [
            `Le format choisi pour ${product.name} n'est plus disponible. Retirez la ligne et selectionnez a nouveau un format.`,
          ];
    });
    const lines = items
      .map((item): CartLine | null => {
        const product = catalog.find((entry) => entry.id === item.productId);
        if (!product) return null;
        if (item.purchaseMode === "fixed_price") {
          const fixedPriceOption = resolveFixedPriceOptions(product).find(
            (entry) => entry.id === item.fixedPriceOptionId,
          );
          if (!fixedPriceOption) return null;
          const quantity = positiveInteger(item.quantity);
          const quantityGrams = fixedPriceQuantityGrams(fixedPriceOption, quantity);
          return {
            ...item,
            lineKey: cartItemKey(item),
            product,
            quantity,
            quantityGrams,
            lineTotal: fixedPriceLineTotal(fixedPriceOption, quantity),
            unitPrice: fixedPriceEffectiveUnitPrice(fixedPriceOption),
            fixedPriceOption,
          };
        }
        return {
          ...item,
          purchaseMode: "gram" as const,
          lineKey: cartItemKey(item),
          product,
          quantityGrams: item.quantity,
          lineTotal: product.price * item.quantity,
          unitPrice: product.price,
        };
      })
      .filter((line): line is CartLine => Boolean(line));

    return {
      items,
      lines,
      cartWarnings,
      hasBlockingCartIssues: cartWarnings.length > 0,
      itemCount: lines.reduce((sum, line) => sum + line.quantityGrams, 0),
      subtotal: lines.reduce((sum, line) => sum + line.lineTotal, 0),
      addItem,
      addFixedPriceOption,
      incrementLine,
      decrementLine,
      setLineQuantity,
      removeLine,
      decrementItem,
      setItemQuantity,
      removeItem,
      clearCart,
    };
  }, [
    addFixedPriceOption,
    addItem,
    catalog,
    clearCart,
    decrementItem,
    decrementLine,
    incrementLine,
    items,
    removeItem,
    removeLine,
    setItemQuantity,
    setLineQuantity,
  ]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside CartProvider");
  return context;
}
