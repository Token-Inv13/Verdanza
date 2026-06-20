import { useCallback, useEffect, useState } from "react";
import { getDeliveryZonesWithFallback } from "../services/deliveryZonesService";
import { getAdminOrdersWithFallback, type AdminOrderRow } from "../services/ordersService";
import { getAdminProductsWithFallback } from "../services/productsService";
import type { DeliveryZone, Product } from "../types";

export function useAdminData() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productSource, setProductSource] = useState<"firestore" | "local">("local");
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [orderSource, setOrderSource] = useState<"firestore" | "mock">("mock");
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [deliverySource, setDeliverySource] = useState<"firestore" | "local">("local");
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const [productResult, orderResult, deliveryResult] = await Promise.all([
      getAdminProductsWithFallback(),
      getAdminOrdersWithFallback(),
      getDeliveryZonesWithFallback(),
    ]);
    setProducts(productResult.products);
    setProductSource(productResult.source);
    setOrders(orderResult.orders);
    setOrderSource(orderResult.source);
    setDeliveryZones(deliveryResult.zones);
    setDeliverySource(deliveryResult.source);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    products,
    productSource,
    orders,
    orderSource,
    deliveryZones,
    deliverySource,
    isLoading,
    refresh,
  };
}
