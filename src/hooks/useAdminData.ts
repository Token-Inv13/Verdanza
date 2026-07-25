import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../lib/firebase";
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
  const [productCostsSource, setProductCostsSource] = useState<"firestore" | "empty" | "error">("empty");
  const [productCostsError, setProductCostsError] = useState("");
  const [supplierPurchases, setSupplierPurchases] = useState<SupplierPurchase[]>([]);
  const [supplierPurchasesSource, setSupplierPurchasesSource] = useState<"firestore" | "empty" | "error">("empty");
  const [supplierPurchasesError, setSupplierPurchasesError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(!auth);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    if (auth && !isAuthReady) return;
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
      getProductCostsAdmin()
        .then((result) => ({ result, error: "" }))
        .catch((error) => ({
          result: null,
          error: error instanceof Error ? error.message : "Couts produits indisponibles.",
        })),
      getSupplierPurchasesAdmin()
        .then((result) => ({ result, error: "" }))
        .catch((error) => ({
          result: null,
          error: error instanceof Error ? error.message : "Achats fournisseurs indisponibles.",
        })),
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
    if (productCostResult.result) {
      setProductCosts(productCostResult.result.costs);
      setProductCostsSource(productCostResult.result.source);
      setProductCostsError("");
    } else {
      setProductCostsSource("error");
      setProductCostsError(productCostResult.error);
    }
    if (supplierPurchaseResult.result) {
      setSupplierPurchases(supplierPurchaseResult.result.purchases);
      setSupplierPurchasesSource(supplierPurchaseResult.result.source);
      setSupplierPurchasesError("");
    } else {
      setSupplierPurchasesSource("error");
      setSupplierPurchasesError(supplierPurchaseResult.error);
    }
    setIsLoading(false);
  }, [isAuthReady]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!auth) return undefined;
    return onAuthStateChanged(auth, () => {
      setIsAuthReady(true);
    });
  }, []);

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
    productCostsError,
    supplierPurchases,
    supplierPurchasesSource,
    supplierPurchasesError,
    isLoading,
    refresh,
  };
}
