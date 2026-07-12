import type { Order, OrderItem, ProductCategory } from "../../src/types/index.js";

export type Ga4PurchaseResult =
  | { status: "sent" }
  | { status: "failed"; code: string };

export type Ga4ServerConfig = {
  measurementId: string;
  apiSecret: string;
  host: string;
};

export type Ga4PurchasePayload = {
  client_id: string;
  timestamp_micros?: number;
  consent: {
    ad_user_data: "DENIED";
    ad_personalization: "DENIED";
  };
  events: [
    {
      name: "purchase";
      params: {
        transaction_id: string;
        currency: "EUR";
        value: number;
        shipping: number;
        coupon?: string;
        session_id?: string;
        engagement_time_msec: 1;
        items: Ga4PurchaseItem[];
      };
    },
  ];
};

type Ga4PurchaseItem = {
  item_id: string;
  item_name: string;
  item_category: string;
  item_variant?: string;
  price: number;
  discount?: number;
  quantity: number;
};

export function getGa4ServerConfig(env: NodeJS.ProcessEnv = process.env): Ga4ServerConfig | null {
  const measurementId = env.GA4_MEASUREMENT_ID?.trim();
  const apiSecret = env.GA4_API_SECRET?.trim();
  const host = (env.GA4_MP_HOST?.trim() || "region1.google-analytics.com").replace(/^https?:\/\//, "");
  if (!measurementId || !apiSecret || !/^[A-Z0-9-]{4,32}$/.test(measurementId)) return null;
  if (!/^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{8,256}$/.test(apiSecret)) return null;
  if (!/^[A-Za-z0-9.-]+(?::\d+)?$/.test(host)) return null;
  return { measurementId, apiSecret, host };
}

export function buildGa4PurchasePayload(order: Order): Ga4PurchasePayload | null {
  if (!isPurchaseEligible(order)) return null;
  const items = buildPurchaseItems(order);
  if (!items.length) return null;
  const paidAtMs = order.paidAt ? Date.parse(order.paidAt) : NaN;
  return {
    client_id: order.analytics.clientId,
    timestamp_micros: Number.isFinite(paidAtMs) ? paidAtMs * 1000 : undefined,
    consent: {
      ad_user_data: "DENIED",
      ad_personalization: "DENIED",
    },
    events: [
      {
        name: "purchase",
        params: {
          transaction_id: order.id,
          currency: "EUR",
          value: roundMoney(netProductValue(order)),
          shipping: roundMoney(Number(order.deliveryFee || 0)),
          coupon: order.couponCode || order.promoCode || undefined,
          session_id: order.analytics.sessionId,
          engagement_time_msec: 1,
          items,
        },
      },
    ],
  };
}

export async function sendGa4Purchase(
  order: Order,
  config = getGa4ServerConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<Ga4PurchaseResult> {
  if (!config) return { status: "failed", code: "ga4_config_missing" };
  const payload = buildGa4PurchasePayload(order);
  if (!payload) return { status: "failed", code: "purchase_not_eligible" };
  return sendGa4Payload(config, payload, fetchImpl);
}

export async function sendGa4Payload(
  config: Ga4ServerConfig,
  payload: Ga4PurchasePayload,
  fetchImpl: typeof fetch = fetch,
): Promise<Ga4PurchaseResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const origin = config.host.startsWith("http://") || config.host.startsWith("https://")
    ? config.host
    : `https://${config.host}`;
  const url = `${origin}/mp/collect?measurement_id=${encodeURIComponent(
    config.measurementId,
  )}&api_secret=${encodeURIComponent(config.apiSecret)}`;

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (response.ok) return { status: "sent" };
    return { status: "failed", code: `ga4_http_${response.status}` };
  } catch (error) {
    return {
      status: "failed",
      code: error instanceof Error && error.name === "AbortError" ? "ga4_timeout" : "ga4_network",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function isPurchaseEligible(order: Order): order is Order & {
  analytics: NonNullable<Order["analytics"]> & { clientId: string };
} {
  return (
    order.paymentStatus === "paid" &&
    order.analytics?.consentGrantedAtSubmission === true &&
    !order.analytics.consentRevokedAt &&
    order.analytics.purchaseStatus !== "sent" &&
    Boolean(order.analytics.clientId && /^[A-Za-z0-9._-]{1,128}$/.test(order.analytics.clientId))
  );
}

export function netProductValue(order: Order) {
  const productSubtotal = roundMoney(
    (order.items || []).reduce(
      (sum, item) => sum + Number(item.unitPrice || 0) * Number(item.quantity || 0),
      0,
    ),
  );
  const productDiscount = Math.min(Number(order.discountAmount || 0), productSubtotal);
  return roundMoney(Math.max(0, productSubtotal - productDiscount));
}

function buildPurchaseItems(order: Order): Ga4PurchaseItem[] {
  const productSubtotal = roundMoney(
    (order.items || []).reduce(
      (sum, item) => sum + Number(item.unitPrice || 0) * Number(item.quantity || 0),
      0,
    ),
  );
  const productDiscount = Math.min(Number(order.discountAmount || 0), productSubtotal);
  const discounts = allocateDiscount(order.items || [], productDiscount);

  return (order.items || [])
    .map<Ga4PurchaseItem | null>((item, index) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = roundMoney(Number(item.unitPrice || 0));
      if (!item.productId || !item.name || quantity <= 0 || unitPrice <= 0) return null;
      const unitDiscount = quantity > 0 ? roundMoney(discounts[index] / quantity) : 0;
      return {
        item_id: item.slug || item.productId,
        item_name: item.name,
        item_category: itemCategoryLabel(item.category),
        item_variant: item.cultureType,
        price: unitPrice,
        discount: unitDiscount > 0 ? unitDiscount : undefined,
        quantity,
      };
    })
    .filter((item): item is Ga4PurchaseItem => Boolean(item));
}

function allocateDiscount(items: OrderItem[], discount: number) {
  const cents = Math.round(discount * 100);
  if (cents <= 0 || !items.length) return items.map(() => 0);
  const subtotalCents = items.reduce(
    (sum, item) => sum + Math.round(Number(item.unitPrice || 0) * 100) * Number(item.quantity || 0),
    0,
  );
  if (subtotalCents <= 0) return items.map(() => 0);
  let allocated = 0;
  return items.map((item, index) => {
    if (index === items.length - 1) return roundMoney((cents - allocated) / 100);
    const lineCents = Math.round(Number(item.unitPrice || 0) * 100) * Number(item.quantity || 0);
    const share = Math.floor((cents * lineCents) / subtotalCents);
    allocated += share;
    return roundMoney(share / 100);
  });
}

function itemCategoryLabel(category?: ProductCategory) {
  if (category === "flowers") return "Fleur CBD";
  if (category === "resins") return "Résine CBD";
  if (category === "oils") return "Huile CBD";
  if (category === "packs") return "Pack CBD";
  return "CBD";
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
