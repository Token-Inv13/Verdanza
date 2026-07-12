import { FieldValue } from "firebase-admin/firestore";
import type {
  Address,
  DeliveryMethod,
  DeliveryZone,
  OrderItem,
  Product,
  Coupon,
  PreferredPaymentMethod,
  DeliveryFeeStatus,
} from "../../src/types/index.js";
import {
  effectiveLocalDeliveryMinimum,
  effectivePostalDeliveryMinimum,
  isPostalShippingFree,
  POSTAL_FREE_SHIPPING_THRESHOLD,
} from "../../src/config/deliveryRules.js";

const preferredPaymentMethods: PreferredPaymentMethod[] = [
  "card_payment_link",
  "cash_on_delivery",
  "bank_transfer",
  "local_delivery_payment",
  "confirm_with_verdanza",
];

const fallbackDeliveryZones: DeliveryZone[] = [
  {
    id: "postal-france",
    name: "Livraison postale en France",
    method: "postal",
    isActive: true,
    fee: 0,
    minimumOrder: 15,
    estimatedDelay: "Expedition suivie en France",
    slots: ["Expedition suivie"],
  },
  ...[
    "Aix-en-Provence centre",
    "Les Milles",
    "Puyricard",
    "Luynes",
    "Venelles",
    "Eguilles",
    "Bouc-Bel-Air",
    "Gardanne",
    "Meyreuil",
    "Le Tholonet",
  ].map<DeliveryZone>((name, index) => ({
    id: `local-${index + 1}`,
    name,
    method: "local_express",
    isActive: true,
    fee: 0,
    minimumOrder: 20,
    estimatedDelay: "Livraison express 7j/7 de 11h00 a 01h00",
    slots: ["11:00-14:00", "14:00-18:00", "18:00-22:00", "22:00-01:00"],
  })),
];

export type CheckoutRequestItem = {
  productId: string;
  quantity: number;
};

export type CheckoutCustomerInput = {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  address: Address;
};

export type CheckoutAnalyticsContext = {
  consentGranted: true;
  consentCapturedAt: string;
  clientId: string;
  sessionId?: string;
};

export type CheckoutRequestBody = {
  items: CheckoutRequestItem[];
  deliveryMethod: DeliveryMethod;
  deliveryZone?: string;
  deliverySlot?: string;
  couponCode?: string;
  authToken?: string;
  customerMessage?: string;
  preferredPaymentMethod?: PreferredPaymentMethod;
  complianceAccepted?: boolean;
  analyticsContext?: CheckoutAnalyticsContext;
  customer: CheckoutCustomerInput;
};

export type PricedCheckout = {
  orderItems: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  discountAmount: number;
  couponCode?: string;
  couponId?: string;
  discountType?: Coupon["discountType"];
  discountValue?: number;
  promoApplied: boolean;
  subtotalBeforeDiscount: number;
  totalAfterDiscount: number;
  total: number;
  deliveryZoneName?: string;
  deliveryMinimumApplied: number;
  postalFreeShippingApplied: boolean;
  deliveryFeeStatus: DeliveryFeeStatus;
  deliveryNote: string;
};

export function parseCheckoutBody(value: unknown): CheckoutRequestBody {
  if (!value || typeof value !== "object") {
    throw new Error("Payload checkout invalide.");
  }
  const body = value as Partial<CheckoutRequestBody>;

  if (!Array.isArray(body.items) || !body.items.length) {
    throw new Error("Le panier est vide.");
  }
  if (body.deliveryMethod !== "postal" && body.deliveryMethod !== "local_express") {
    throw new Error("Mode de livraison invalide.");
  }
  if (
    body.preferredPaymentMethod &&
    !preferredPaymentMethods.includes(body.preferredPaymentMethod)
  ) {
    throw new Error("Mode de reglement invalide.");
  }
  if (
    body.deliveryMethod === "postal" &&
    (body.preferredPaymentMethod === "local_delivery_payment" ||
      body.preferredPaymentMethod === "cash_on_delivery")
  ) {
    throw new Error("Paiement a la livraison locale indisponible en livraison postale.");
  }
  if (body.preferredPaymentMethod === "bank_transfer") {
    throw new Error("Virement bancaire pas encore disponible.");
  }
  if (!body.customer?.email || !body.customer.phone) {
    throw new Error("Email et telephone client requis.");
  }
  if (body.complianceAccepted !== true) {
    throw new Error("Confirmation de majorite et conformite requise.");
  }
  if (
    !body.customer.firstName ||
    !body.customer.lastName ||
    !body.customer.address?.line1 ||
    !body.customer.address.postalCode ||
    !body.customer.address.city
  ) {
    throw new Error("Adresse client incomplete.");
  }

  const analyticsContext = parseAnalyticsContext(body.analyticsContext);
  return {
    ...(body as CheckoutRequestBody),
    preferredPaymentMethod: normalizePreferredPaymentMethod(body.preferredPaymentMethod),
    analyticsContext,
  };
}

export async function priceCheckout(
  db: FirebaseFirestore.Firestore,
  body: CheckoutRequestBody,
): Promise<PricedCheckout> {
  const orderItems: OrderItem[] = [];

  for (const item of body.items) {
    if (
      !item.productId ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 20
    ) {
      throw new Error("Quantite produit invalide.");
    }

    const productRef = db.collection("products").doc(item.productId);
    const productSnapshot = await productRef.get();
    if (!productSnapshot.exists) {
      throw new Error("Ce produit n'est plus disponible.");
    }

    const product = {
      id: productSnapshot.id,
      ...productSnapshot.data(),
    } as Product;

    if (
      !product.isActive ||
      product.comingSoon === true ||
      product.stockStatus === "coming_soon"
    ) {
      throw new Error(`Produit inactif refuse : ${product.name}.`);
    }
    if (product.stock < item.quantity) {
      throw new Error(`Stock insuffisant pour ${product.name}.`);
    }
    if (!Number.isFinite(product.price) || product.price <= 0) {
      throw new Error(`Prix produit invalide pour ${product.name}.`);
    }

    orderItems.push({
      productId: product.id,
      name: product.name,
      quantity: item.quantity,
      unitPrice: product.price,
      slug: product.slug,
      category: product.category,
      cultureType: product.cultureType,
    });
  }

  const subtotal = roundMoney(
    orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
  );
  const delivery = await resolveDeliveryFee(db, body, subtotal);
  const coupon = body.couponCode
    ? await resolveCoupon(
        db,
        body.couponCode,
        subtotal,
        orderItems,
        body.deliveryMethod,
      )
    : null;
  const effectiveDelivery =
    coupon?.freeShippingApplied && body.deliveryMethod === "postal"
      ? {
          ...delivery,
          fee: 0,
          postalFreeShippingApplied: true,
          deliveryFeeStatus: "free" as DeliveryFeeStatus,
          deliveryNote: "Livraison postale offerte par code promo.",
        }
      : delivery;
  const beforeDiscount = roundMoney(subtotal + effectiveDelivery.fee);
  const discountAmount = coupon
    ? Math.min(coupon.discountAmount, Math.max(0, beforeDiscount))
    : 0;
  const total = roundMoney(beforeDiscount - discountAmount);

  return {
    orderItems,
    subtotal,
    subtotalBeforeDiscount: beforeDiscount,
    deliveryFee: effectiveDelivery.fee,
    discountAmount,
    couponCode: coupon?.code,
    couponId: coupon?.id,
    discountType: coupon?.discountType,
    discountValue: coupon?.discountValue,
    promoApplied: Boolean(coupon),
    totalAfterDiscount: total,
    total,
    deliveryZoneName: effectiveDelivery.zoneName,
    deliveryMinimumApplied: effectiveDelivery.minimumApplied,
    postalFreeShippingApplied: effectiveDelivery.postalFreeShippingApplied,
    deliveryFeeStatus: effectiveDelivery.deliveryFeeStatus,
    deliveryNote: effectiveDelivery.deliveryNote,
  };
}

async function resolveCoupon(
  db: FirebaseFirestore.Firestore,
  rawCode: string,
  subtotal: number,
  orderItems: OrderItem[],
  deliveryMethod: DeliveryMethod,
) {
  const code = rawCode.trim().toUpperCase().replace(/\s+/g, "");
  if (!code) return null;

  const couponSnapshot = await db.collection("coupons").doc(code.toLowerCase()).get();
  if (!couponSnapshot.exists) {
    throw new Error("Code promo invalide.");
  }

  const coupon = { id: couponSnapshot.id, ...couponSnapshot.data() } as Coupon;
  const now = Date.now();
  const startsAt = coupon.startsAt ? Date.parse(coupon.startsAt) : 0;
  const endsAt = coupon.endsAt ? Date.parse(coupon.endsAt) : 0;
  const allowedProductIds = coupon.productIds ?? [];
  const allowedCategories = coupon.categories ?? [];

  if (!coupon.isActive) throw new Error("Code promo inactif.");
  if (coupon.isArchived) throw new Error("Code promo invalide.");
  if (startsAt && now < startsAt) throw new Error("Code promo pas encore actif.");
  if (endsAt && now > endsAt) throw new Error("Code promo expire.");
  if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
    throw new Error("Code promo deja utilise au maximum.");
  }
  if (subtotal < Number(coupon.minimumOrder || 0)) {
    throw new Error(
      `Code promo disponible a partir de ${Number(coupon.minimumOrder).toFixed(0)} EUR d'achat.`,
    );
  }

  let eligibleSubtotal = subtotal;
  if (allowedProductIds.length || allowedCategories.length) {
    eligibleSubtotal = 0;
    for (const item of orderItems) {
      const productSnapshot = await db.collection("products").doc(item.productId).get();
      const product = {
        id: productSnapshot.id,
        ...productSnapshot.data(),
      } as Product;
      const productAllowed =
        allowedProductIds.includes(item.productId) ||
        allowedCategories.includes(product.category);
      if (productAllowed) {
        eligibleSubtotal += item.unitPrice * item.quantity;
      }
    }
  }

  if (eligibleSubtotal <= 0 && coupon.discountType !== "free_shipping") {
    throw new Error("Code promo non applicable a ce panier.");
  }
  if (coupon.discountType === "free_shipping" && deliveryMethod !== "postal") {
    throw new Error("Ce code promo est reserve a la livraison postale.");
  }

  const discountAmount =
    coupon.discountType === "percent"
      ? roundMoney(eligibleSubtotal * (Number(coupon.discountValue || 0) / 100))
      : coupon.discountType === "fixed"
        ? roundMoney(Number(coupon.discountValue || 0))
        : 0;

  if (discountAmount <= 0 && coupon.discountType !== "free_shipping") {
    throw new Error("Code promo sans remise applicable.");
  }

  return {
    id: coupon.id,
    code,
    discountType: coupon.discountType,
    discountValue: Number(coupon.discountValue || 0),
    discountAmount,
    freeShippingApplied: coupon.discountType === "free_shipping",
  };
}

async function resolveDeliveryFee(
  db: FirebaseFirestore.Firestore,
  body: CheckoutRequestBody,
  subtotal: number,
): Promise<{
  fee: number;
  zoneName: string;
  minimumApplied: number;
  postalFreeShippingApplied: boolean;
  deliveryFeeStatus: DeliveryFeeStatus;
  deliveryNote: string;
}> {
  if (body.deliveryMethod === "postal") {
    const zone = await getDeliveryZone(db, body.deliveryZone ?? "postal-france");
    const fallbackZone = fallbackDeliveryZones.find(
      (entry) => entry.id === (body.deliveryZone ?? "postal-france"),
    );
    const selectedZone = isDeliveryZoneAvailable(zone) ? zone : fallbackZone;

    if (
      !selectedZone ||
      selectedZone.method !== "postal" ||
      !isDeliveryZoneAvailable(selectedZone)
    ) {
      throw new Error("Livraison postale indisponible pour le moment.");
    }

    const minimumOrder = effectivePostalDeliveryMinimum(
      selectedZone.minimumOrderAmount ?? selectedZone.minimumOrder,
    );
    if (subtotal < minimumOrder) {
      throw new Error("Le minimum de commande pour la livraison postale est de 15 €.");
    }

    const freeShipping = isPostalShippingFree(subtotal);
    return {
      fee: freeShipping ? 0 : selectedZone.fee,
      zoneName: selectedZone.name,
      minimumApplied: minimumOrder,
      postalFreeShippingApplied: freeShipping,
      deliveryFeeStatus: freeShipping ? "free" : "to_confirm",
      deliveryNote: freeShipping
        ? "Livraison postale offerte."
        : `Frais postaux confirmés avec le client après validation. Livraison postale offerte à partir de ${POSTAL_FREE_SHIPPING_THRESHOLD} € d'achat.`,
    };
  }

  if (!body.deliveryZone) {
    throw new Error("Zone de livraison locale requise.");
  }

  const zone = await getDeliveryZone(db, body.deliveryZone);
  const fallbackZone = fallbackDeliveryZones.find(
    (entry) => entry.id === body.deliveryZone || entry.name === body.deliveryZone,
  );
  const selectedZone = zone ?? fallbackZone;

  if (
    !selectedZone ||
    selectedZone.method !== "local_express" ||
    !isDeliveryZoneAvailable(selectedZone)
  ) {
    throw new Error(
      "La zone de livraison sélectionnée n’est actuellement pas disponible. Veuillez choisir une autre zone ou contacter Verdanza.",
    );
  }

  const minimumOrder = effectiveLocalDeliveryMinimum(
    selectedZone.minimumOrderAmount ?? selectedZone.minimumOrder,
  );
  if (subtotal < minimumOrder) {
    throw new Error("Le minimum de commande pour la livraison locale est de 20 €.");
  }
  return {
    fee: selectedZone.fee,
    zoneName: selectedZone.name,
    minimumApplied: minimumOrder,
    postalFreeShippingApplied: false,
    deliveryFeeStatus: selectedZone.fee > 0 ? "configured" : "free",
    deliveryNote: "Livraison locale Aix-en-Provence et alentours, 7j/7 de 11h à 01h, à partir de 20 € d'achat.",
  };
}

function isDeliveryZoneAvailable(zone?: DeliveryZone | null) {
  if (!zone) return false;
  return (
    zone.isActive !== false &&
    zone.isOpen !== false &&
    (zone.status || "open") === "open" &&
    zone.isArchived !== true
  );
}

async function getDeliveryZone(
  db: FirebaseFirestore.Firestore,
  zoneId: string,
): Promise<DeliveryZone | null> {
  const snapshot = await db.collection("deliveryZones").doc(zoneId).get();
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...snapshot.data() } as DeliveryZone;
}

export function orderPayload(
  body: CheckoutRequestBody,
  priced: PricedCheckout,
  customerId?: string,
  analyticsRevocationTokenHash?: string,
): Record<string, unknown> {
  const paymentProvider = "manual";
  const paymentInstructions = paymentInstructionsFor();
  const preferredPaymentMethod =
    normalizePreferredPaymentMethod(body.preferredPaymentMethod) ||
    (body.deliveryMethod === "local_express" ? "confirm_with_verdanza" : "card_payment_link");
  const orderStatus = "contact_required";

  return {
    orderType: "order",
    customerId: customerId ?? null,
    customerEmail: body.customer.email,
    customerPhone: body.customer.phone,
    customerName: `${body.customer.firstName} ${body.customer.lastName}`,
    items: priced.orderItems,
    subtotal: priced.subtotal,
    subtotalBeforeDiscount: priced.subtotalBeforeDiscount,
    deliveryFee: priced.deliveryFee,
    discountAmount: priced.discountAmount,
    couponCode: priced.couponCode ?? null,
    promoCode: priced.couponCode ?? null,
    promoId: priced.couponId ?? null,
    discountType: priced.discountType ?? null,
    discountValue: priced.discountValue ?? null,
    totalAfterDiscount: priced.totalAfterDiscount,
    promoApplied: priced.promoApplied,
    total: priced.total,
    paymentProvider,
    paymentStatus: "to_confirm",
    paymentReference: null,
    paymentInstructions,
    preferredPaymentMethod,
    paymentLinkUrl: "",
    paymentLinkSent: false,
    paymentLinkSentAt: null,
    paymentLinkSentBy: null,
    paymentLinkChannel: null,
    customerMessage: body.customerMessage?.trim() || "",
    orderStatus,
    deliveryMethod: body.deliveryMethod,
    deliveryAddress: body.customer.address,
    deliveryZone: priced.deliveryZoneName ?? body.deliveryZone ?? null,
    deliverySlot: body.deliverySlot ?? null,
    deliveryMinimumApplied: priced.deliveryMinimumApplied,
    postalFreeShippingApplied: priced.postalFreeShippingApplied,
    deliveryFeeStatus: priced.deliveryFeeStatus,
    deliveryNote: priced.deliveryNote,
    trackingNumber: "",
    statusHistory: [
      {
        status: orderStatus,
        changedAt: new Date().toISOString(),
        changedBy: "system",
        note:
          "Commande transmise. Client a contacter pour confirmer disponibilites, livraison et reglement.",
      },
    ],
    emails: {},
    analytics:
      body.analyticsContext?.consentGranted && body.analyticsContext.clientId
        ? {
            consentGrantedAtSubmission: true,
            consentCapturedAt: body.analyticsContext.consentCapturedAt,
            clientId: body.analyticsContext.clientId,
            sessionId: body.analyticsContext.sessionId,
            revocationTokenHash: analyticsRevocationTokenHash,
            purchaseStatus: "pending",
            purchaseAttempts: 0,
          }
        : {
            consentGrantedAtSubmission: false,
            purchaseStatus: "not_eligible",
          },
    internalNote: "",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function normalizePreferredPaymentMethod(method?: PreferredPaymentMethod) {
  if (method === "local_delivery_payment") return "cash_on_delivery";
  return method;
}

function parseAnalyticsContext(value: unknown): CheckoutAnalyticsContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const context = value as Partial<CheckoutAnalyticsContext>;
  if (context.consentGranted !== true) return undefined;
  if (!context.clientId || !isSafeGa4Id(context.clientId)) return undefined;
  const capturedAt =
    typeof context.consentCapturedAt === "string" &&
    Number.isFinite(Date.parse(context.consentCapturedAt))
      ? context.consentCapturedAt
      : new Date().toISOString();
  return {
    consentGranted: true,
    consentCapturedAt: capturedAt,
    clientId: context.clientId,
    sessionId:
      context.sessionId && isSafeGa4Id(context.sessionId)
        ? context.sessionId
        : undefined,
  };
}

function isSafeGa4Id(value: string) {
  return /^[A-Za-z0-9._-]{1,128}$/.test(value);
}

export function cents(value: number) {
  return Math.round(value * 100);
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function paymentInstructionsFor() {
  return "Verdanza vous contactera rapidement par telephone ou par email pour confirmer les disponibilites, la livraison et le reglement.";
}
