import { FieldValue } from "firebase-admin/firestore";
import { orderPayload, priceCheckout, type CheckoutRequestBody, type PricedCheckout } from "./checkout.js";
import { CheckoutRequestConflictError, checkoutRequestDocument, checkoutRequestsCollection, orderSideEffectsCollection, orderSideEffectsDocument, validateCheckoutRequestId } from "./orderSideEffects.js";
import { fixedPriceEffectiveUnitPrice, fixedPriceLineTotal, resolveFixedPriceOptions } from "../../src/lib/fixedPriceOptions.js";
import type { Order, Product } from "../../src/types/index.js";
import { promotionAvailability } from "../../src/lib/promotionDates.js";
import { normalizeGiftTiers, qualifyingGiftSubtotal } from "../../src/lib/tieredProductGifts.js";
import { assertContestPrizeRedeemable, contestCollections } from "./contests.js";
import { buildCagnotteOrderEnrollment, cagnotteCalculationForPricedCheckout, canEnrollCagnotteOrder } from "./cagnotteOrders.js";
import { CAGNOTTE_SERVER_PROGRAM } from "./cagnotteProgram.js";
import type { CagnotteAccrualProgram } from "./cagnotteLedgerTypes.js";
import type { CagnotteReservationProgram } from "./cagnotteReservationTypes.js";
import {
  assertAcceptedCagnotteQuote,
  prepareCagnotteCheckoutQuote,
  readAvailableCagnotteCents,
} from "./cagnotteCheckout.js";
import {
  CAGNOTTE_RESERVATION_PROGRAM,
  createCagnotteReservationIntent,
  prepareCagnotteReservationOperation,
} from "./cagnotteReservations.js";

export async function commitCheckoutOrder(input: {
  db: FirebaseFirestore.Firestore;
  body: CheckoutRequestBody;
  priced: PricedCheckout;
  checkoutRequestId: string;
  payloadFingerprint: string;
  customerId?: string;
  analyticsRevocationTokenHash?: string;
  orderId?: string;
  accrualProgram?: CagnotteAccrualProgram | null;
  reservationProgram?: CagnotteReservationProgram | null;
  firebaseProjectId?: string | null;
  nowEpochMs?: number;
}) {
  const {
    db,
    body,
    priced,
    checkoutRequestId,
    payloadFingerprint,
    customerId,
    analyticsRevocationTokenHash,
  } = input;
  const normalizedRequestId = validateCheckoutRequestId(checkoutRequestId);
  const orderRef = input.orderId
    ? db.collection("orders").doc(input.orderId)
    : db.collection("orders").doc();
  const requestRef = db.collection(checkoutRequestsCollection).doc(normalizedRequestId);
  const sideEffectsRef = db.collection(orderSideEffectsCollection).doc(orderRef.id);
  const operationEpochMs = input.nowEpochMs ?? Date.now();
  const accrualProgram = input.accrualProgram === undefined
    ? CAGNOTTE_SERVER_PROGRAM
    : input.accrualProgram;
  const reservationProgram = input.reservationProgram === undefined
    ? CAGNOTTE_RESERVATION_PROGRAM
    : input.reservationProgram;

  return db.runTransaction(async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (requestSnapshot.exists) {
      const existing = requestSnapshot.data() || {};
      if (existing.payloadFingerprint !== payloadFingerprint || !existing.orderId) {
        throw new CheckoutRequestConflictError();
      }
      if (existing.cagnotteBeneficiaryId) {
        const original = await transaction.get(db.collection("orders").doc(String(existing.orderId)));
        if (existing.cagnotteBeneficiaryId !== customerId || !original.exists ||
          original.data()?.cagnotte?.beneficiaryId !== customerId || original.data()?.customerId !== customerId) {
          throw new CheckoutRequestConflictError();
        }
      }
      return { created: false, orderId: String(existing.orderId) };
    }

    const positiveUseRequested = Number(body.cagnotteUse?.requestedCents || 0) > 0;
    const committedPrice = positiveUseRequested
      ? await priceCheckout(transactionalReader(db, transaction), body)
      : priced;
    let reservationIntent: ReturnType<typeof createCagnotteReservationIntent> = null;
    if (positiveUseRequested) {
      if (!customerId) throw new Error("Authentification requise pour utiliser la cagnotte.");
      if (!reservationProgram) throw new Error("L’utilisation de la cagnotte est désactivée.");
      const availableCents = await readAvailableCagnotteCents(db, customerId, transaction);
      const preparedQuote = prepareCagnotteCheckoutQuote({
        body,
        priced: committedPrice,
        beneficiaryId: customerId,
        availableCents,
        accrualProgram,
        reservationProgram: reservationProgram ?? null,
        createdAtEpochMs: operationEpochMs,
        firebaseProjectId: input.firebaseProjectId,
      });
      assertAcceptedCagnotteQuote(preparedQuote.quote, body.cagnotteUse?.acceptance);
      reservationIntent = createCagnotteReservationIntent({
        orderId: orderRef.id,
        beneficiaryId: customerId,
        createdAtEpochMs: operationEpochMs,
        calculation: cagnotteCalculationForPricedCheckout(
          committedPrice,
          body.cagnotteUse!.requestedCents,
          availableCents,
        ),
      }, reservationProgram ?? null, input.firebaseProjectId);
      if (!reservationIntent) throw new Error("L’utilisation de la cagnotte est désactivée.");
    }

    const couponRef = committedPrice.couponId
      ? db.collection("coupons").doc(committedPrice.couponId)
      : null;
    const couponSnapshot = couponRef ? await transaction.get(couponRef) : null;
    const contestPrizeId = String(couponSnapshot?.data()?.contestPrizeId || "");
    const contestPrizeRef = contestPrizeId
      ? db.collection(contestCollections.prizes).doc(contestPrizeId)
      : null;
    const contestPrizeSnapshot = contestPrizeRef
      ? await transaction.get(contestPrizeRef)
      : null;
    const automaticCouponReads = await Promise.all(
      committedPrice.appliedPromotions
        .filter((promotion) => promotion.couponId && promotion.couponId !== committedPrice.couponId)
        .map(async (promotion) => {
          const promotionRef = db.collection("coupons").doc(promotion.couponId as string);
          const promotionSnapshot = await transaction.get(promotionRef);
          return { couponSnapshot: promotionSnapshot };
        }),
    );
    const productReads = await Promise.all(
      Array.from(new Set(committedPrice.orderItems.map((item) => item.productId))).map(
        async (productId) => {
          const productRef = db.collection("products").doc(productId);
          const productSnapshot = await transaction.get(productRef);
          return { productId, productRef, productSnapshot };
        },
      ),
    );

    if (couponRef && couponSnapshot) {
      const coupon = couponSnapshot.data();
      if (!couponSnapshot.exists || promotionAvailability(coupon || {}) !== "active") {
        throw new Error("Code promo invalide.");
      }
    }
    if (contestPrizeRef && contestPrizeSnapshot) {
      if (!contestPrizeSnapshot.exists) throw new Error("Code promo concours invalide.");
      const prize = contestPrizeSnapshot.data() || {};
      assertContestPrizeRedeemable(prize, {
        couponId: couponRef?.id || "",
        email: body.customer.email,
      });
    }
    for (const { couponSnapshot: automaticSnapshot } of automaticCouponReads) {
      const coupon = automaticSnapshot.data();
      if (
        !automaticSnapshot.exists ||
        promotionAvailability(coupon || {}) !== "active"
      ) {
        throw new Error("Promotion automatique invalide.");
      }
      const appliedGift = priced.appliedPromotions.find(
        (promotion) =>
          promotion.type === "tiered_product_gift" &&
          promotion.couponId === automaticSnapshot.id,
      );
      if (appliedGift) {
        assertTieredGiftStillMatchesCoupon(
          { id: automaticSnapshot.id, ...coupon } as import("../../src/types/index.js").Coupon,
          priced.orderItems,
          appliedGift,
        );
      }
    }

    const payload = orderPayload(
      { ...body, checkoutRequestId: normalizedRequestId }, committedPrice, customerId, analyticsRevocationTokenHash,
    );
    const enrollment = reservationIntent && reservationIntent.amountCents > 0
      ? {
          schemaVersion: 1 as const,
          beneficiaryId: reservationIntent.order.beneficiaryId,
          programVersion: reservationIntent.order.programVersion,
          calculationVersion: reservationIntent.order.snapshot.calculationVersion,
          createdAtEpochMs: reservationIntent.order.createdAtEpochMs,
          snapshot: reservationIntent.order.snapshot,
          accrualEnrollment: canEnrollCagnotteOrder(
            accrualProgram,
            customerId,
            operationEpochMs,
            input.firebaseProjectId,
          ) ? "enrolled" as const : "not_enrolled" as const,
        }
      : buildCagnotteOrderEnrollment(
          payload,
          customerId,
          accrualProgram,
          operationEpochMs,
          input.firebaseProjectId,
        );
    if (enrollment) payload.cagnotte = enrollment;
    if (reservationIntent && reservationIntent.amountCents > 0) {
      payload.cagnotteReservationIntent = reservationIntent;
      payload.paymentAmount = reservationIntent.order.snapshot.productsPaidCents / 100 + committedPrice.deliveryFee;
    }

    const stockWrites: (() => void)[] = [];
    for (const { productId, productRef, productSnapshot } of productReads) {
      const matchingItems = committedPrice.orderItems.filter((item) => item.productId === productId);
      const requestedQuantity = matchingItems.reduce(
        (sum, item) => sum + Number(item.quantity || 0),
        0,
      );
      const productName = matchingItems[0]?.name || productId;
      if (!productSnapshot.exists) {
        throw new Error(`Produit indisponible : ${productName}.`);
      }

      const data = productSnapshot.data();
      const stock = Number(data?.stock ?? 0);
      if (data?.isActive !== true) {
        throw new Error(`Produit indisponible : ${productName}.`);
      }
      if (stock < requestedQuantity) {
        const giftItem = matchingItems.find((item) => item.isGift);
        throw new Error(
          giftItem
            ? `Le cadeau ${productName} n'est plus disponible. Actualisez le devis et choisissez une autre référence.`
            : `Stock insuffisant pour ${productName}.`,
        );
      }
      for (const item of matchingItems.filter((entry) => entry.purchaseMode === "fixed_price")) {
        const product = { id: productSnapshot.id, ...data } as Product;
        assertFixedPriceOrderItemStillMatchesProduct(item, product);
      }

      stockWrites.push(() => transaction.update(productRef, {
        stock: stock - requestedQuantity,
        updatedAt: FieldValue.serverTimestamp(),
      }));
      for (const item of matchingItems) {
        stockWrites.push(() => transaction.set(db.collection("stockMovements").doc(), {
          productId: item.productId,
          productName: item.name,
          type: item.isGift ? "promotion_gift" : "sale",
          quantity: -item.quantity,
          note: item.isGift
            ? `Cadeau promotion ${item.promotionLabel || item.promotionId || "Verdanza"} - commande ${orderRef.id}`
            : `Commande manuelle ${orderRef.id}`,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: "manual-checkout",
          orderId: orderRef.id,
          ...(item.isGift && item.promotionId ? { promotionId: item.promotionId } : {}),
        }));
      }
    }

    const reservationPlan = reservationIntent && reservationIntent.amountCents > 0
      ? await prepareCagnotteReservationOperation({
          db,
          transaction,
          action: "reserve",
          intent: reservationIntent,
          program: reservationProgram as CagnotteReservationProgram,
          firebaseProjectId: input.firebaseProjectId,
          recordedAtEpochMs: operationEpochMs,
        })
      : null;

    // Every product, commercial condition and wallet fact has been read before writes.
    reservationPlan?.write();
    for (const write of stockWrites) write();

    if (committedPrice.couponCode) {
      transaction.set(
        db.collection("coupons").doc(committedPrice.couponId || committedPrice.couponCode.toLowerCase()),
        {
          usedCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    for (const promotion of committedPrice.appliedPromotions) {
      if (!promotion.couponId || promotion.couponId === committedPrice.couponId) continue;
      transaction.set(
        db.collection("coupons").doc(promotion.couponId),
        {
          usedCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    if (contestPrizeRef && contestPrizeSnapshot) {
      const prize = contestPrizeSnapshot.data() || {};
      transaction.update(contestPrizeRef, {
        status: "redeemed",
        redeemedAt: FieldValue.serverTimestamp(),
        orderId: orderRef.id,
      });
      transaction.set(db.collection(contestCollections.audits).doc(), {
        action: "prize_redeemed",
        contestId: String(prize.contestId || ""),
        drawId: String(prize.drawId || ""),
        prizeId: contestPrizeRef.id,
        actorType: "checkout",
        actorId: orderRef.id,
        metadata: {
          orderId: orderRef.id,
          couponId: couponRef?.id || "",
        },
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    transaction.set(
      orderRef,
      payload,
    );
    transaction.set(
      requestRef,
      checkoutRequestDocument(orderRef.id, payloadFingerprint, enrollment?.beneficiaryId),
    );
    transaction.set(sideEffectsRef, orderSideEffectsDocument(orderRef.id));
    return { created: true, orderId: orderRef.id };
  });
}

/** Read-only Firestore facade: every get performed by the existing pricing engine joins the transaction. */
function transactionalReader(
  db: FirebaseFirestore.Firestore,
  transaction: FirebaseFirestore.Transaction,
): FirebaseFirestore.Firestore {
  const wrap = <T extends object>(target: T): T => new Proxy(target, {
    get(current, key, receiver) {
      if (key === "get") return () => transaction.get(current as never);
      const value = Reflect.get(current, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = Reflect.apply(value, current, args);
        return result && typeof result === "object" ? wrap(result) : result;
      };
    },
  });
  return new Proxy(db, {
    get(current, key, receiver) {
      if (key === "collection") {
        return (path: string) => wrap(current.collection(path));
      }
      return Reflect.get(current, key, receiver);
    },
  });
}

function assertTieredGiftStillMatchesCoupon(
  coupon: import("../../src/types/index.js").Coupon,
  orderItems: Order["items"],
  appliedGift: import("../../src/types/index.js").AppliedPromotion,
) {
  if (coupon.promotionType !== "tiered_product_gift") {
    throw new Error("La promotion cadeau a été modifiée. Actualisez le devis.");
  }
  const paidItems = orderItems.filter((item) => !item.isGift);
  const qualifyingSubtotal = qualifyingGiftSubtotal(coupon, paidItems);
  const tier = [...normalizeGiftTiers(coupon.giftTiers || [])]
    .reverse()
    .find((entry) => qualifyingSubtotal >= entry.minimumSubtotal);
  if (
    !tier ||
    tier.id !== appliedGift.giftTierId ||
    tier.quantityGrams !== appliedGift.giftQuantityGrams ||
    !appliedGift.giftProductId ||
    !coupon.giftProductIds?.includes(appliedGift.giftProductId)
  ) {
    throw new Error("La promotion cadeau a été modifiée. Actualisez le devis.");
  }
}

export function assertFixedPriceOrderItemStillMatchesProduct(
  item: Order["items"][number],
  product: Product,
) {
  if (item.purchaseMode !== "fixed_price") return;
  const option = resolveFixedPriceOptions(product).find(
    (entry) => entry.id === item.fixedPriceOptionId,
  );
  if (!option) {
    throw new Error(`Format prix fixe indisponible pour ${item.name}.`);
  }
  const expectedQuantity = Number(item.fixedPriceQuantity || 0);
  const expectedTotal = fixedPriceLineTotal(option, expectedQuantity);
  if (
    option.quantityGrams !== item.fixedPriceGrams ||
    option.totalPrice !== item.fixedPriceTotal ||
    expectedTotal !== item.lineTotal ||
    fixedPriceEffectiveUnitPrice(option) !== item.unitPrice
  ) {
    throw new Error(`Format prix fixe modifie pour ${item.name}.`);
  }
}
