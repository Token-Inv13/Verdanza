import { useCallback, useEffect, useState } from "react";
import { getDeliveryZonesWithFallback } from "../services/deliveryZonesService";
import { getAdminCustomersWithFallback } from "../services/adminCustomersService";
import { getCouponsWithFallback } from "../services/couponsService";
import {
  defaultBillingSettings,
  getBillingSettings,
  getInvoicesWithFallback,
} from "../services/invoicesService";
import { getAdminOrdersWithFallback, type AdminOrderRow } from "../services/ordersService";
import { getAdminProductsWithFallback } from "../services/productsService";
import type { BillingSettings, Coupon, CustomerProfile, DeliveryZone, Invoice, Product } from "../types";

export function useAdminData() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productSource, setProductSource] = useState<"firestore" | "local">("local");
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [orderSource, setOrderSource] = useState<"firestore" | "empty">("empty");
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [deliverySource, setDeliverySource] = useState<"firestore" | "local">("local");
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponSource, setCouponSource] = useState<"firestore" | "empty">("empty");
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [customerSource, setCustomerSource] = useState<"firestore" | "empty">("empty");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceSource, setInvoiceSource] = useState<"firestore" | "empty">("empty");
  const [billingSettings, setBillingSettings] = useState<BillingSettings>(defaultBillingSettings);
  const [billingSource, setBillingSource] = useState<"firestore" | "local">("local");
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const [
      productResult,
      orderResult,
      deliveryResult,
      couponResult,
      customerResult,
      invoiceResult,
      billingResult,
    ] = await Promise.all([
      getAdminProductsWithFallback(),
      getAdminOrdersWithFallback(),
      getDeliveryZonesWithFallback(),
      getCouponsWithFallback(),
      getAdminCustomersWithFallback(),
      getInvoicesWithFallback(),
      getBillingSettings(),
    ]);
    setProducts(productResult.products);
    setProductSource(productResult.source);
    setOrders(orderResult.orders);
    setOrderSource(orderResult.source);
    setDeliveryZones(deliveryResult.zones);
    setDeliverySource(deliveryResult.source);
    setCoupons(couponResult.coupons);
    setCouponSource(couponResult.source);
    setCustomers(customerResult.customers);
    setCustomerSource(customerResult.source);
    setInvoices(invoiceResult.invoices);
    setInvoiceSource(invoiceResult.source);
    setBillingSettings(billingResult.settings);
    setBillingSource(billingResult.source);
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
    coupons,
    couponSource,
    customers,
    customerSource,
    invoices,
    invoiceSource,
    billingSettings,
    billingSource,
    isLoading,
    refresh,
  };
}
