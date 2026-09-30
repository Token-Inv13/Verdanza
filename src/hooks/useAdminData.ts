import { useCallback, useEffect, useRef, useState } from "react";
import { loadFirebaseAuthApi } from "../lib/firebaseAuth";
import { getAdminDeliveryZones } from "../services/deliveryZonesService";
import { getAdminCustomersWithFallback } from "../services/adminCustomersService";
import { getCouponsWithFallback } from "../services/couponsService";
import { getPromoBannersWithFallback } from "../services/promoBannersService";
import {
  defaultBillingSettings,
  getBillingSettings,
  getInvoicesWithFallback,
} from "../services/invoicesService";
import { getAdminOrder, getAdminOrdersWithFallback, type AdminOrderRow } from "../services/ordersService";
import { getAdminProductsWithFallback } from "../services/productsService";
import { getProductCostsAdmin } from "../services/productCostsService";
import { getSupplierPurchasesAdmin } from "../services/supplierPurchasesService";
import type { BillingSettings, Coupon, CustomerProfile, DeliveryZone, Invoice, Product, ProductCost, PromoBanner, SupplierPurchase } from "../types";

import type { StockSnapshot } from "../types/adminStock";

type ReadSource = "loading" | "firestore" | "empty" | "local" | "error";
type ReadKey = "products" | "orders" | "delivery" | "coupons" | "banners" | "customers" | "invoices" | "billing" | "costs" | "purchases";
type ReadErrors = Partial<Record<ReadKey, string>>;
async function captured<T>(promise: Promise<T>, message: string): Promise<{ result: T; error: "" } | { result: null; error: string }> {
  try { return { result: await promise, error: "" }; }
  catch { return { result: null, error: message }; }
}

export function useAdminData(clientsView = false) {
  const [products, setProducts] = useState<Product[]>([]);
  const [productSource, setProductSource] = useState<ReadSource>("loading");
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [orderSource, setOrderSource] = useState<ReadSource>("loading");
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [deliverySource, setDeliverySource] = useState<ReadSource>("loading");
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponSource, setCouponSource] = useState<ReadSource>("loading");
  const [promoBanners, setPromoBanners] = useState<PromoBanner[]>([]);
  const [promoBannerSource, setPromoBannerSource] = useState<ReadSource>("loading");
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [customerSource, setCustomerSource] = useState<ReadSource>("loading");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceSource, setInvoiceSource] = useState<ReadSource>("loading");
  const [billingSettings, setBillingSettings] = useState<BillingSettings>(defaultBillingSettings);
  const [billingSource, setBillingSource] = useState<ReadSource>("loading");
  const [productCosts, setProductCosts] = useState<ProductCost[]>([]);
  const [productCostsSource, setProductCostsSource] = useState<ReadSource>("loading");
  const [productCostsError, setProductCostsError] = useState("");
  const [supplierPurchases, setSupplierPurchases] = useState<SupplierPurchase[]>([]);
  const [supplierPurchasesSource, setSupplierPurchasesSource] = useState<ReadSource>("loading");
  const [supplierPurchasesError, setSupplierPurchasesError] = useState("");
  const [readErrors, setReadErrors] = useState<ReadErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setIsLoading(true);
    if (!isAuthReady) return;
    if (clientsView) {
      const couponResult = await captured(getCouponsWithFallback(), "Promotions associées aux clients indisponibles.");
      if (version !== requestVersion.current) return;
      setCoupons(couponResult.result?.coupons ?? []);
      setCouponSource(couponResult.result?.source ?? "error");
      setReadErrors(couponResult.error ? { coupons: couponResult.error } : {});
      setIsLoading(false);
      return;
    }
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
      captured(getAdminProductsWithFallback(), "Produits indisponibles."),
      captured(getAdminOrdersWithFallback(), "Commandes indisponibles."),
      captured(getAdminDeliveryZones(), "Zones de livraison indisponibles."),
      captured(getCouponsWithFallback(), "Promotions indisponibles."),
      captured(getPromoBannersWithFallback(), "Bannières indisponibles."),
      captured(getAdminCustomersWithFallback(), "Clients indisponibles."),
      captured(getInvoicesWithFallback(), "Factures indisponibles."),
      captured(getBillingSettings(), "Paramètres de facturation indisponibles."),
      captured(getProductCostsAdmin(), "Coûts produits indisponibles."),
      captured(getSupplierPurchasesAdmin(), "Achats fournisseurs indisponibles."),
    ]);
    if (version !== requestVersion.current) return;
    setProducts(productResult.result?.products ?? []);
    setProductSource(productResult.result?.source ?? "error");
    setOrders(orderResult.result?.orders ?? []);
    setOrderSource(orderResult.result?.source ?? "error");
    setDeliveryZones(deliveryResult.result?.zones ?? []);
    setDeliverySource(deliveryResult.result?.source ?? "error");
    setCoupons(couponResult.result?.coupons ?? []);
    setCouponSource(couponResult.result?.source ?? "error");
    setPromoBanners(promoBannerResult.result?.banners ?? []);
    setPromoBannerSource(promoBannerResult.result?.source ?? "error");
    setCustomers(customerResult.result?.customers ?? []);
    setCustomerSource(customerResult.result?.source ?? "error");
    setInvoices(invoiceResult.result?.invoices ?? []);
    setInvoiceSource(invoiceResult.result?.source ?? "error");
    setBillingSettings(billingResult.result?.settings ?? defaultBillingSettings);
    setBillingSource(billingResult.result?.source ?? "error");
    setProductCosts(productCostResult.result?.costs ?? []);
    setProductCostsSource(productCostResult.result?.source ?? "error");
    setProductCostsError(productCostResult.error);
    setSupplierPurchases(supplierPurchaseResult.result?.purchases ?? []);
    setSupplierPurchasesSource(supplierPurchaseResult.result?.source ?? "error");
    setSupplierPurchasesError(supplierPurchaseResult.error);
    setReadErrors(Object.fromEntries([
      ["products", productResult.error], ["orders", orderResult.error], ["delivery", deliveryResult.error],
      ["coupons", couponResult.error], ["banners", promoBannerResult.error], ["customers", customerResult.error],
      ["invoices", invoiceResult.error], ["billing", billingResult.error], ["costs", productCostResult.error],
      ["purchases", supplierPurchaseResult.error],
    ].filter((entry) => entry[1])) as ReadErrors);
    setIsLoading(false);
  }, [isAuthReady, clientsView]);

  const applyStockSnapshot = useCallback((snapshot: StockSnapshot) => {
    setProducts((current) => current.map((product) => product.id === snapshot.productId
      ? { ...product, stock: snapshot.stock, lowStockThreshold: snapshot.lowStockThreshold } : product));
  }, []);

  const refreshOrder = useCallback(async (orderId: string) => {
    const order = await getAdminOrder(orderId);
    if (!order) return;
    setOrders((current) => current.map((entry) => entry.id === orderId ? order : entry));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void loadFirebaseAuthApi().then(({ auth, firebaseAuth }) => {
      if (cancelled) return;
      if (!auth) {
        setIsAuthReady(true);
        return;
      }

      unsubscribe = firebaseAuth.onAuthStateChanged(auth, () => {
        setIsAuthReady(true);
      });
    }).catch(() => { if (!cancelled) setIsAuthReady(true); });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
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
    readErrors,
    isLoading,
    refresh,
    refreshOrder,
    applyStockSnapshot,
  };
}
