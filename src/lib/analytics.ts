import type { BlogArticle } from "../types/blog";
import type { DeliveryMethod, PreferredPaymentMethod, Product } from "../types";
import { ga4MeasurementId } from "./googleTagManager";

type Primitive = string | number | boolean | null | undefined;

export type Ga4Item = {
  item_id: string;
  item_name: string;
  item_category: "Fleur CBD" | "Résine CBD" | "CBD";
  item_variant?: string;
  price?: number;
  quantity?: number;
};

export type AnalyticsPayload = Record<string, Primitive | Ga4Item[]>;
type AnalyticsCartLine = { product: Product; quantity: number; quantityGrams?: number };

export type AnalyticsEventName =
  | "page_view"
  | "view_item_list"
  | "select_item"
  | "view_item"
  | "add_to_cart"
  | "remove_from_cart"
  | "view_cart"
  | "add_to_wishlist"
  | "begin_checkout"
  | "add_shipping_info"
  | "add_payment_info"
  | "payment_method_selected"
  | "order_submitted"
  | "login"
  | "sign_up"
  | "cta_click"
  | "contact_click"
  | "delivery_method_selected"
  | "local_delivery_zone_selected"
  | "blog_article_view"
  | "blog_read_progress";

let analyticsAllowed = false;

const blockedPayloadKeys = [
  "email",
  "phone",
  "telephone",
  "firstName",
  "lastName",
  "displayName",
  "address",
  "line1",
  "line2",
  "postalCode",
  "city",
  "firebase_uid",
  "uid",
  "customerId",
  "customerName",
  "customerEmail",
  "customerPhone",
  "message",
];

export function setAnalyticsConsentAllowed(allowed: boolean) {
  analyticsAllowed = allowed;
}

export function hasAnalyticsConsent() {
  return analyticsAllowed;
}

export type Ga4MeasurementContext = {
  consentGranted: true;
  consentCapturedAt: string;
  clientId: string;
  sessionId?: string;
};

export async function getGa4MeasurementContext(): Promise<Ga4MeasurementContext | null> {
  if (typeof window === "undefined" || !analyticsAllowed || !window.gtag) return null;
  const clientId = await getGtagValue("client_id", 900);
  if (!clientId || !isSafeGa4Id(clientId)) return null;
  const sessionId = await getGtagValue("session_id", 500);
  return {
    consentGranted: true,
    consentCapturedAt: new Date().toISOString(),
    clientId,
    sessionId: sessionId && isSafeGa4Id(sessionId) ? sessionId : undefined,
  };
}

export function trackEvent(event: AnalyticsEventName, payload: AnalyticsPayload = {}) {
  if (typeof window === "undefined" || !analyticsAllowed) return;
  if (containsBlockedKey(payload)) return;
  window.gtag?.("event", event, {
    send_to: ga4MeasurementId,
    ...payload,
  });
}

export function trackPageView(path: string, title: string) {
  const url = new URL(path || "/", "https://verdanza.fr");
  trackEvent("page_view", {
    page_location: url.toString(),
    page_path: `${url.pathname}${url.search}`,
    page_title: title,
  });
}

export function trackCtaClick(input: {
  ctaId: string;
  ctaLocation: string;
  destinationPath: string;
  ctaCategory?: string;
}) {
  trackEvent("cta_click", {
    cta_id: input.ctaId,
    cta_location: input.ctaLocation,
    destination_path: sanitizeDestinationPath(input.destinationPath),
    page_path: typeof window === "undefined" ? undefined : window.location.pathname,
    cta_category: input.ctaCategory,
  });
}

export function productToGa4Item(product: Product, quantity = 1): Ga4Item {
  return {
    item_id: product.slug || product.id,
    item_name: product.name,
    item_category:
      product.category === "flowers"
        ? "Fleur CBD"
        : product.category === "resins"
          ? "Résine CBD"
          : "CBD",
    item_variant: product.cultureType && product.cultureType !== "A renseigner" ? product.cultureType : undefined,
    price: roundMoney(product.price),
    quantity,
  };
}

export function trackViewItemList(
  itemListId: string,
  itemListName: string,
  products: Product[],
) {
  trackEvent("view_item_list", {
    item_list_id: itemListId,
    item_list_name: itemListName,
    items: products.map((product) => productToGa4Item(product)),
  });
}

export function trackSelectItem(product: Product, itemListId?: string, itemListName?: string) {
  trackEvent("select_item", {
    item_list_id: itemListId,
    item_list_name: itemListName,
    items: [productToGa4Item(product)],
  });
}

export function trackViewItem(product: Product) {
  trackEvent("view_item", {
    currency: "EUR",
    value: roundMoney(product.price),
    items: [productToGa4Item(product)],
  });
}

export function trackAddToCart(product: Product, quantity = 1) {
  trackEvent("add_to_cart", {
    currency: "EUR",
    value: roundMoney(product.price * quantity),
    items: [productToGa4Item(product, quantity)],
  });
}

export function trackRemoveFromCart(product: Product, quantity = 1) {
  trackEvent("remove_from_cart", {
    currency: "EUR",
    value: roundMoney(product.price * quantity),
    items: [productToGa4Item(product, quantity)],
  });
}

export function trackViewCart(lines: AnalyticsCartLine[], value: number) {
  if (!lines.length) return;
  trackEvent("view_cart", {
    currency: "EUR",
    value: roundMoney(value),
    items: lines.map((line) => productToGa4Item(line.product, analyticsLineQuantity(line))),
  });
}

export function trackAddToWishlist(product: Product) {
  trackEvent("add_to_wishlist", {
    currency: "EUR",
    value: roundMoney(product.price),
    items: [productToGa4Item(product)],
  });
}

export function trackBeginCheckout(lines: AnalyticsCartLine[], value: number) {
  if (!lines.length) return;
  trackEvent("begin_checkout", {
    currency: "EUR",
    value: roundMoney(value),
    items: lines.map((line) => productToGa4Item(line.product, analyticsLineQuantity(line))),
  });
}

export function trackAddShippingInfo(
  lines: AnalyticsCartLine[],
  value: number,
  shippingTier: DeliveryMethod,
) {
  if (!lines.length) return;
  trackEvent("add_shipping_info", {
    currency: "EUR",
    value: roundMoney(value),
    shipping_tier: shippingTier,
    items: lines.map((line) => productToGa4Item(line.product, analyticsLineQuantity(line))),
  });
  trackEvent("delivery_method_selected", {
    delivery_method: shippingTier,
  });
}

export function trackLocalDeliveryZoneSelected(zoneId: string, zoneName: string) {
  trackEvent("local_delivery_zone_selected", {
    zone_id: zoneId,
    zone_name: zoneName,
  });
}

export function trackAddPaymentInfo(
  lines: AnalyticsCartLine[],
  value: number,
  paymentMethod: string,
) {
  if (!lines.length) return;
  trackEvent("add_payment_info", {
    currency: "EUR",
    value: roundMoney(value),
    payment_method: paymentMethod,
    items: lines.map((line) => productToGa4Item(line.product, analyticsLineQuantity(line))),
  });
}

export function trackPaymentMethodSelected(
  lines: AnalyticsCartLine[],
  value: number,
  preferredPaymentMethod: PreferredPaymentMethod,
  deliveryMethod: DeliveryMethod,
) {
  if (!lines.length) return;
  trackEvent("payment_method_selected", {
    preferred_payment_method: preferredPaymentMethod,
    delivery_method: deliveryMethod,
    currency: "EUR",
    value: roundMoney(value),
    items: lines.map((line) => productToGa4Item(line.product, analyticsLineQuantity(line))),
  });
}

export function trackOrderSubmitted(input: {
  transactionId: string;
  lines: AnalyticsCartLine[];
  value: number;
  coupon?: string;
  shippingTier: DeliveryMethod;
  paymentMethod: string;
}) {
  if (!input.lines.length) return;
  const dedupeKey = `verdanza:analytics:order_submitted:${input.transactionId}`;
  if (typeof window !== "undefined" && window.sessionStorage.getItem(dedupeKey) === "true") return;
  trackEvent("order_submitted", {
    transaction_id: input.transactionId,
    currency: "EUR",
    value: roundMoney(input.value),
    coupon: input.coupon,
    shipping_tier: input.shippingTier,
    preferred_payment_method: input.paymentMethod,
    items: input.lines.map((line) => productToGa4Item(line.product, analyticsLineQuantity(line))),
  });
  if (typeof window !== "undefined" && analyticsAllowed) {
    window.sessionStorage.setItem(dedupeKey, "true");
  }
}

export function trackLogin(method: string) {
  trackEvent("login", { method });
}

export function trackSignUp(method: string) {
  trackEvent("sign_up", { method });
}

export function trackContactClick(contactMethod: string, linkLocation: string) {
  trackEvent("contact_click", {
    contact_method: contactMethod,
    link_location: linkLocation,
  });
}

export function trackBlogArticleView(article: BlogArticle) {
  trackEvent("blog_article_view", {
    article_slug: article.slug,
    article_title: article.title,
    article_category: article.category,
  });
}

export function trackBlogReadProgress(article: BlogArticle, threshold: 25 | 50 | 75 | 90) {
  trackEvent("blog_read_progress", {
    article_slug: article.slug,
    article_title: article.title,
    article_category: article.category,
    progress_percent: threshold,
  });
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function analyticsLineQuantity(line: AnalyticsCartLine) {
  return Number(line.quantityGrams ?? line.quantity ?? 0);
}

function sanitizeDestinationPath(path: string) {
  try {
    const url = new URL(path, "https://verdanza.fr");
    return url.pathname;
  } catch {
    return path.startsWith("/") ? path.split("?")[0].split("#")[0] : undefined;
  }
}

function containsBlockedKey(payload: AnalyticsPayload) {
  return Object.keys(payload).some((key) =>
    blockedPayloadKeys.some((blocked) => key.toLowerCase().includes(blocked.toLowerCase())),
  );
}

function getGtagValue(fieldName: "client_id" | "session_id", timeoutMs: number) {
  return new Promise<string | null>((resolve) => {
    let resolved = false;
    const timeout = window.setTimeout(() => {
      if (resolved) return;
      resolved = true;
      resolve(null);
    }, timeoutMs);

    window.gtag?.("get", ga4MeasurementId, fieldName, (value: unknown) => {
      if (resolved) return;
      resolved = true;
      window.clearTimeout(timeout);
      resolve(typeof value === "string" || typeof value === "number" ? String(value) : null);
    });
  });
}

function isSafeGa4Id(value: string) {
  return /^[A-Za-z0-9._-]{1,128}$/.test(value);
}
