import type {
  AppliedPromotion,
  CartItem,
  CouponDiscountType,
  DeliveryFeeStatus,
  DeliveryMethod,
  Address,
  GiftPromotionQuote,
  PromotionSelection,
} from "../types";
import type { CagnotteCheckoutQuote, CagnotteUseRequest } from "../types/cagnotte";
import { getFirebaseIdToken } from "../lib/firebaseAuth";

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
  giftPromotions?: GiftPromotionQuote[];
  promotionConflictMessage?: string;
  cagnotteUse?: CagnotteCheckoutQuote;
};

export class QuoteHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "QuoteHttpError";
  }
}

export async function quoteOrder(input: {
  items: CartItem[];
  deliveryMethod: DeliveryMethod;
  deliveryZone?: string;
  address?: Address;
  couponCode?: string;
  email?: string;
  promotionSelections?: PromotionSelection[];
  cagnotteUse?: Pick<CagnotteUseRequest, "requestedCents">;
}, dependencies: {
  getToken?: typeof getFirebaseIdToken;
  fetch?: typeof fetch;
} = {}) {
  const requestedCents = input.cagnotteUse?.requestedCents ?? 0;
  const authToken = requestedCents > 0
    ? await (dependencies.getToken ?? getFirebaseIdToken)()
    : undefined;
  if (requestedCents > 0 && !authToken) {
    throw new QuoteHttpError("AUTH_REQUIRED", 401, "Votre session a expiré. Reconnectez-vous pour utiliser votre cagnotte.");
  }
  const response = await (dependencies.fetch ?? fetch)("/api/quote-order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: input.items,
      deliveryMethod: input.deliveryMethod,
      deliveryZone: input.deliveryZone,
      address: input.address,
      couponCode: input.couponCode?.trim() || undefined,
      email: input.email?.trim() || undefined,
      promotionSelections: input.promotionSelections,
      ...(requestedCents > 0 ? { authToken, cagnotteUse: { requestedCents } } : {}),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as
    | OrderQuote
    | { code?: string; error?: string };

  if (!response.ok) {
    const errorPayload = payload as { code?: string; error?: string };
    throw new QuoteHttpError(
      errorPayload.code || "QUOTE_UNAVAILABLE",
      response.status,
      errorPayload.error || "Le devis serveur est indisponible.",
    );
  }

  return payload as OrderQuote;
}

export function formatEuro(value: number) {
  return `${value.toFixed(2).replace(".", ",")} EUR`;
}
