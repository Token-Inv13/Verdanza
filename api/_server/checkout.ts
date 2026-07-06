import { FieldValue } from "firebase-admin/firestore";
import type {
  Address,
  DeliveryMethod,
  DeliveryZone,
  OrderItem,
  Product,
  Coupon,
} from "../../src/types/index.js";

const fallbackDeliveryZones: DeliveryZone[] = [
  {
    id: "postal-france",
    name: "Livraison postale en France",
    method: "postal",
    isActive: true,
    fee: 0,
    minimumOrder: 0,
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
    minimumOrder: 30,
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

export type CheckoutRequestBody = {
  items: CheckoutRequestItem[];
  deliveryMethod: DeliveryMethod;
  deliveryZone?: string;
  deliverySlot?: string;
  couponCode?: string;
  authToken?: string;
  customerMessage?: string;
  complianceAccepted?: boolean;
  customer: CheckoutCustomerInput;
};

export type PricedCheckout = {
  orderItems: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  discountAmount: number;
  couponCode?: string;
  total: number;
  deliveryZoneName?: string;
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

  return body as CheckoutRequestBody;
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

    if (!product.isActive) {
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
    });
  }

  const subtotal = roundMoney(
    orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
  );
  const { fee, zoneName } = await resolveDeliveryFee(db, body, subtotal);
  const coupon = body.couponCode
    ? await resolveCoupon(db, body.couponCode, subtotal, fee, orderItems)
    : null;
  const beforeDiscount = roundMoney(subtotal + fee);
  const discountAmount = coupon
    ? Math.min(coupon.discountAmount, Math.max(0, beforeDiscount - 0.5))
    : 0;
  const total = roundMoney(beforeDiscount - discountAmount);

  return {
    orderItems,
    subtotal,
    deliveryFee: fee,
    discountAmount,
    couponCode: coupon?.code,
    total,
    deliveryZoneName: zoneName,
  };
}

async function resolveCoupon(
  db: FirebaseFirestore.Firestore,
  rawCode: string,
  subtotal: number,
  deliveryFee: number,
  orderItems: OrderItem[],
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

  const discountAmount =
    coupon.discountType === "percent"
      ? roundMoney(eligibleSubtotal * (Number(coupon.discountValue || 0) / 100))
      : coupon.discountType === "fixed"
        ? roundMoney(Number(coupon.discountValue || 0))
        : roundMoney(deliveryFee);

  if (discountAmount <= 0) {
    throw new Error("Code promo sans remise applicable.");
  }

  return {
    code,
    discountAmount,
  };
}

async function resolveDeliveryFee(
  db: FirebaseFirestore.Firestore,
  body: CheckoutRequestBody,
  subtotal: number,
) {
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

    const minimumOrder = selectedZone.minimumOrderAmount ?? selectedZone.minimumOrder ?? 0;
    if (minimumOrder > 0 && subtotal < minimumOrder) {
      throw new Error(
        `Livraison postale disponible a partir de ${minimumOrder.toFixed(0)} EUR d'achat.`,
      );
    }

    return { fee: selectedZone.fee, zoneName: selectedZone.name };
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

  const minimumOrder = selectedZone.minimumOrderAmount ?? selectedZone.minimumOrder ?? 30;
  if (subtotal < minimumOrder) {
    throw new Error(
      `Livraison locale disponible a partir de ${minimumOrder.toFixed(0)} EUR d'achat.`,
    );
  }
  return { fee: selectedZone.fee, zoneName: selectedZone.name };
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
): Record<string, unknown> {
  const paymentProvider = "manual";
  const paymentInstructions = paymentInstructionsFor();
  const orderStatus = "contact_required";
  const orderType = isPreorderActive() ? "preorder" : "order";

  return {
    orderType,
    customerId: customerId ?? null,
    customerEmail: body.customer.email,
    customerPhone: body.customer.phone,
    customerName: `${body.customer.firstName} ${body.customer.lastName}`,
    items: priced.orderItems,
    subtotal: priced.subtotal,
    deliveryFee: priced.deliveryFee,
    discountAmount: priced.discountAmount,
    couponCode: priced.couponCode ?? null,
    total: priced.total,
    paymentProvider,
    paymentStatus: "to_confirm",
    paymentReference: null,
    paymentInstructions,
    customerMessage: body.customerMessage?.trim() || "",
    orderStatus,
    deliveryMethod: body.deliveryMethod,
    deliveryAddress: body.customer.address,
    deliveryZone: priced.deliveryZoneName ?? body.deliveryZone ?? null,
    deliverySlot: body.deliverySlot ?? null,
    trackingNumber: "",
    statusHistory: [
      {
        status: orderStatus,
        changedAt: new Date().toISOString(),
        changedBy: "system",
        note:
          orderType === "preorder"
            ? "Precommande transmise. Client a contacter pour confirmer disponibilites, livraison et reglement."
            : "Commande transmise. Client a contacter pour confirmer disponibilites, livraison et reglement.",
      },
    ],
    emails: {},
    internalNote: "",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
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

export function isPreorderActive() {
  const enabled = (process.env.VITE_PREORDER_MODAL_ENABLED ?? "true").toLowerCase();
  if (["false", "0", "off", "no"].includes(enabled)) return false;

  const openingDate =
    process.env.VITE_OPENING_DATE || "2026-07-16T11:00:00+02:00";
  const openingTime = Date.parse(openingDate);
  if (!Number.isFinite(openingTime)) return true;

  return Date.now() < openingTime;
}
