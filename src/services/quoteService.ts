import type {
  AppliedPromotion,
  CartItem,
  CouponDiscountType,
  DeliveryFeeStatus,
  DeliveryMethod,
  Address,
} from "../types";

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
  promotionDiscountTotal?: number;
  appliedPromotions?: AppliedPromotion[];
  promotionProgressMessages?: string[];
  subtotalBeforePromotion?: number;
  subtotalAfterPromotion?: number;
  postalFreeShippingApplied: boolean;
  total: number;
};

export async function quoteOrder(input: {
  items: CartItem[];
  deliveryMethod: DeliveryMethod;
  deliveryZone?: string;
  address?: Address;
  couponCode?: string;
  email?: string;
}) {
  const response = await fetch("/api/quote-order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: input.items,
      deliveryMethod: input.deliveryMethod,
      deliveryZone: input.deliveryZone,
      address: input.address,
      couponCode: input.couponCode?.trim() || undefined,
      email: input.email?.trim() || undefined,
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
