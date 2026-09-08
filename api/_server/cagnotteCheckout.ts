import crypto from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type {
  CagnotteUseAcceptance,
  CheckoutRequestBody,
  PricedCheckout,
} from "./checkout.js";
import { readCagnotteWallet } from "./cagnotteLedger.js";
import {
  createCagnotteReservationIntent,
} from "./cagnotteReservations.js";
import type {
  CagnotteReservationIntent,
  CagnotteReservationProgram,
} from "./cagnotteReservationTypes.js";
import type { CagnotteAccrualProgram } from "./cagnotteLedgerTypes.js";
import { cagnotteCalculationForPricedCheckout } from "./cagnotteOrders.js";
import type { CagnotteCheckoutQuote } from "../../src/types/cagnotte.js";

export const CAGNOTTE_CHECKOUT_QUOTE_VERSION = "cagnotte-checkout-quote-v1" as const;

export class CagnotteCheckoutError extends Error {
  constructor(
    readonly code:
      | "AUTH_REQUIRED"
      | "RESERVATIONS_DISABLED"
      | "ACCEPTANCE_REQUIRED"
      | "QUOTE_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "CagnotteCheckoutError";
  }
}

export type { CagnotteCheckoutQuote } from "../../src/types/cagnotte.js";

export async function readAvailableCagnotteCents(
  db: Firestore,
  beneficiaryId: string,
  transaction?: Transaction,
) {
  const reference = db.collection("cagnotteWallets").doc(beneficiaryId);
  const snapshot = transaction ? await transaction.get(reference) : await reference.get();
  if (!snapshot.exists) return 0;
  return readCagnotteWallet(snapshot.data(), beneficiaryId).availableCents;
}

export function prepareCagnotteCheckoutQuote(input: {
  body: CheckoutRequestBody;
  priced: PricedCheckout;
  beneficiaryId: string;
  availableCents: number;
  accrualProgram: CagnotteAccrualProgram | null;
  reservationProgram: CagnotteReservationProgram | null;
  createdAtEpochMs: number;
  firebaseProjectId?: string | null;
}): { quote: CagnotteCheckoutQuote; calculationIntent: CagnotteReservationIntent } {
  const requestedCents = input.body.cagnotteUse?.requestedCents ?? 0;
  const calculationIntent = createCagnotteReservationIntent(
    {
      orderId: "checkout-quote",
      beneficiaryId: input.beneficiaryId,
      createdAtEpochMs: input.createdAtEpochMs,
      calculation: cagnotteCalculationForPricedCheckout(
        input.priced,
        requestedCents,
        input.availableCents,
      ),
    },
    input.reservationProgram,
    input.firebaseProjectId,
  );
  if (!calculationIntent) {
    throw new CagnotteCheckoutError(
      "RESERVATIONS_DISABLED",
      "L’utilisation de la cagnotte est désactivée.",
    );
  }
  const snapshot = calculationIntent.order.snapshot;
  const quoteWithoutFingerprint = {
    quoteVersion: CAGNOTTE_CHECKOUT_QUOTE_VERSION,
    currency: "EUR" as const,
    productsAfterDiscountsCents: snapshot.eligibleCents,
    deliveryCents: eurosToExactCents(input.priced.deliveryFee),
    requestedCagnotteCents: requestedCents,
    proposedCagnotteCents: snapshot.appliedCagnotteCents,
    cagnotteCapCents: snapshot.cagnotteCapCents,
    payableCents:
      snapshot.productsPaidCents + eurosToExactCents(input.priced.deliveryFee),
    estimatedLoyaltyCents: snapshot.loyaltyCents,
    loyaltyAccrualStatus: input.accrualProgram?.newAccrualsEnabled === true ? "estimated" as const : "suspended" as const,
    limitationReasons: snapshot.limitationReasons,
    compatibility: snapshot.compatibility,
  };
  const quoteFingerprint = sha256({
    beneficiaryId: input.beneficiaryId,
    ...commercialConditions(input.body, input.priced),
    ...quoteWithoutFingerprint,
  });
  return {
    quote: { ...quoteWithoutFingerprint, quoteFingerprint },
    calculationIntent,
  };
}

export function assertAcceptedCagnotteQuote(
  quote: CagnotteCheckoutQuote,
  acceptance: CagnotteUseAcceptance | undefined,
) {
  if (!acceptance) {
    throw new CagnotteCheckoutError(
      "ACCEPTANCE_REQUIRED",
      "Le montant proposé doit être accepté avant la création de la commande.",
    );
  }
  if (
    acceptance.quoteVersion !== quote.quoteVersion ||
    acceptance.quoteFingerprint !== quote.quoteFingerprint ||
    acceptance.acceptedCagnotteCents !== quote.proposedCagnotteCents ||
    acceptance.acceptedPayableCents !== quote.payableCents
  ) {
    throw new CagnotteCheckoutError(
      "QUOTE_CONFLICT",
      "Les conditions ont changé : un nouveau devis est requis.",
    );
  }
}

function commercialConditions(body: CheckoutRequestBody, priced: PricedCheckout) {
  return {
    requested: body.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      purchaseMode: item.purchaseMode || "gram",
      fixedPriceOptionId: item.fixedPriceOptionId || "",
    })),
    delivery: {
      method: body.deliveryMethod,
      zone: body.deliveryZone || "",
      slot: body.deliverySlot || "",
      resolvedZoneId: priced.deliveryZoneId || "",
      fee: priced.deliveryFee,
      status: priced.deliveryFeeStatus,
      postalFreeShippingApplied: priced.postalFreeShippingApplied,
    },
    couponCode: (body.couponCode || "").trim().toLowerCase(),
    promotionSelections: body.promotionSelections || [],
    lines: priced.orderItems.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      purchaseMode: item.purchaseMode || "gram",
      fixedPriceOptionId: item.fixedPriceOptionId || "",
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      isGift: item.isGift === true,
      promotionId: item.promotionId || "",
    })),
    discounts: {
      discountAmount: priced.discountAmount,
      promotionDiscountTotal: priced.promotionDiscountTotal,
      appliedPromotions: priced.appliedPromotions.map((promotion) => ({
        id: promotion.id,
        couponId: promotion.couponId || "",
        type: promotion.type,
        discountAmount: promotion.discountAmount,
        giftProductId: promotion.giftProductId || "",
        giftTierId: promotion.giftTierId || "",
        giftQuantityGrams: promotion.giftQuantityGrams || 0,
      })),
    },
  };
}

function eurosToExactCents(value: number) {
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents < 0 || Math.abs(value - cents / 100) > 1e-9) {
    throw new Error("Montant serveur invalide.");
  }
  return cents;
}

function sha256(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
