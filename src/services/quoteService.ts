import type { CartItem, CouponDiscountType, DeliveryFeeStatus, DeliveryMethod } from "../types";

export type OrderQuote = {
  subtotal: number;
  subtotalBeforeDiscount: number;
  deliveryFee: number;
  deliveryFeeStatus: DeliveryFeeStatus;
  deliveryNote: string;
  discountAmount: number;
  couponCode?: string;
  promoApplied: boolean;
  discountType?: CouponDiscountType;
  discountValue?: number;
  postalFreeShippingApplied: boolean;
  total: number;
};

export async function quoteOrder(input: {
  items: CartItem[];
  deliveryMethod: DeliveryMethod;
  deliveryZone?: string;
  couponCode?: string;
}) {
  const response = await fetch("/api/quote-order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: input.items,
      deliveryMethod: input.deliveryMethod,
      deliveryZone: input.deliveryZone,
      couponCode: input.couponCode?.trim() || undefined,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as
    | OrderQuote
    | { error?: string };

  if (!response.ok) {
    throw new Error("error" in payload && payload.error ? payload.error : "Code promo invalide.");
  }

  return payload as OrderQuote;
}

export function formatEuro(value: number) {
  return `${value.toFixed(2).replace(".", ",")} EUR`;
}
