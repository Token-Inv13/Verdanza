import { useCallback, useEffect, useState } from "react";
import { getDeliveryZonesWithFallback } from "../services/deliveryZonesService";
import { getAdminCustomersWithFallback } from "../services/adminCustomersService";
import { getCouponsWithFallback } from "../services/couponsService";
import { getPromoBannersWithFallback } from "../services/promoBannersService";
import {
  defaultBillingSettings,
  getBillingSettings,
  getInvoicesWithFallback,
} from "../services/invoicesService";
import { getAdminOrdersWithFallback, type AdminOrderRow } from "../services/ordersService";
import { getAdminProductsWithFallback } from "../services/productsService";
import { getProductCostsAdmin } from "../services/productCostsService";
import { getSupplierPurchasesAdmin } from "../services/supplierPurchasesService";
import type { BillingSettings, Coupon, CustomerProfile, DeliveryZone, Invoice, Product, ProductCost, PromoBanner, SupplierPurchase } from "../types";

export function useAdminData() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productSource, setProductSource] = useState<"firestore" | "local">("local");
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [orderSource, setOrderSource] = useState<"firestore" | "empty">("empty");
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [deliverySource, setDeliverySource] = useState<"firestore" | "local">("local");
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponSource, setCouponSource] = useState<"firestore" | "empty">("empty");
  const [promoBanners, setPromoBanners] = useState<PromoBanner[]>([]);
  const [promoBannerSource, setPromoBannerSource] = useState<"firestore" | "empty">("empty");
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [customerSource, setCustomerSource] = useState<"firestore" | "empty">("empty");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceSource, setInvoiceSource] = useState<"firestore" | "empty">("empty");
  const [billingSettings, setBillingSettings] = useState<BillingSettings>(defaultBillingSettings);
  const [billingSource, setBillingSource] = useState<"firestore" | "local">("local");
  const [productCosts, setProductCosts] = useState<ProductCost[]>([]);
  const [productCostsSource, setProductCostsSource] = useState<"firestore" | "empty">("empty");
  const [supplierPurchases, setSupplierPurchases] = useState<SupplierPurchase[]>([]);
  const [supplierPurchasesSource, setSupplierPurchasesSource] = useState<"firestore" | "empty">("empty");
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const [
      productResult,
      orderResult,
      deliveryResult,
      couponResult,
      promoBannerResult,
      customerResult,
      invoiceResult,
      billingResult,
      productCostResult,
      supplierPurchaseResult,
    ] = await Promise.all([
      getAdminProductsWithFallback(),
      getAdminOrdersWithFallback(),
      getDeliveryZonesWithFallback(),
      getCouponsWithFallback(),
      getPromoBannersWithFallback(),
      getAdminCustomersWithFallback(),
      getInvoicesWithFallback(),
      getBillingSettings(),
      getProductCostsAdmin().catch((error) => {
        console.warn("Unable to load product costs", error);
        return { costs: [], source: "empty" as const };
      }),
      getSupplierPurchasesAdmin().catch((error) => {
        console.warn("Unable to load supplier purchases", error);
        return { purchases: [], source: "empty" as const };
      }),
    ]);
    setProducts(productResult.products);
    setProductSource(productResult.source);
    setOrders(orderResult.orders);
    setOrderSource(orderResult.source);
    setDeliveryZones(deliveryResult.zones);
    setDeliverySource(deliveryResult.source);
    setCoupons(couponResult.coupons);
    setCouponSource(couponResult.source);
    setPromoBanners(promoBannerResult.banners);
    setPromoBannerSource(promoBannerResult.source);
    setCustomers(customerResult.customers);
    setCustomerSource(customerResult.source);
    setInvoices(invoiceResult.invoices);
    setInvoiceSource(invoiceResult.source);
    setBillingSettings(billingResult.settings);
    setBillingSource(billingResult.source);
    setProductCosts(productCostResult.costs);
    setProductCostsSource(productCostResult.source);
    setSupplierPurchases(supplierPurchaseResult.purchases);
    setSupplierPurchasesSource(supplierPurchaseResult.source);
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
    promoBanners,
    promoBannerSource,
    customers,
    customerSource,
    invoices,
    invoiceSource,
    billingSettings,
    billingSource,
    productCosts,
    productCostsSource,
    supplierPurchases,
    supplierPurchasesSource,
    isLoading,
    refresh,
  };
}
