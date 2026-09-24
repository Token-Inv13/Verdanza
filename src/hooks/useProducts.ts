import { useEffect, useState } from "react";
import {
  getEditorialFallbackProducts,
  getProductsWithFallback,
  type PublicProductCatalogResult,
} from "../services/productsService";

export function useProducts() {
  const [catalog, setCatalog] = useState<PublicProductCatalogResult>(() => ({
    products: getEditorialFallbackProducts(),
    source: "local",
    status: "degraded",
    commerceAvailable: false,
  }));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    getProductsWithFallback()
      .then((result) => {
        if (!isMounted) return;
        setCatalog(result);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  return {
    ...catalog,
    commerceUnavailable: !catalog.commerceAvailable,
    isLoading,
  };
}
