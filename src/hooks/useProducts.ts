import { useEffect, useState } from "react";
import { getProductsWithFallback } from "../services/productsService";
import { products as localProducts } from "../data/products";
import type { Product } from "../types";

export function useProducts() {
  const [products, setProducts] = useState<Product[]>(() =>
    localProducts.filter((product) => product.isActive),
  );
  const [source, setSource] = useState<"firestore" | "local">("local");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    getProductsWithFallback()
      .then((result) => {
        if (!isMounted) return;
        setProducts(result.products);
        setSource(result.source);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  return { products, source, isLoading };
}
