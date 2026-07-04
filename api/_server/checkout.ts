import { FieldValue } from "firebase-admin/firestore";
import type {
  Address,
  DeliveryMethod,
  DeliveryZone,
  OrderItem,
  Product,
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
  authToken?: string;
  customer: CheckoutCustomerInput;
};

export type PricedCheckout = {
  orderItems: OrderItem[];
  subtotal: number;
  deliveryFee: number;
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
  const total = roundMoney(subtotal + fee);

  return {
    orderItems,
    subtotal,
    deliveryFee: fee,
    total,
    deliveryZoneName: zoneName,
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
    const selectedZone = zone?.isActive ? zone : fallbackZone;

    if (!selectedZone || selectedZone.method !== "postal" || !selectedZone.isActive) {
      throw new Error("Livraison postale indisponible pour le moment.");
    }

    const minimumOrder = selectedZone.minimumOrder ?? 0;
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

  if (!selectedZone || selectedZone.method !== "local_express" || !selectedZone.isActive) {
    throw new Error("Zone de livraison locale indisponible.");
  }

  const minimumOrder = selectedZone.minimumOrder ?? 30;
  if (subtotal < minimumOrder) {
    throw new Error(
      `Livraison locale disponible a partir de ${minimumOrder.toFixed(0)} EUR d'achat.`,
    );
  }
  return { fee: selectedZone.fee, zoneName: selectedZone.name };
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
  return {
    customerId: customerId ?? null,
    customerEmail: body.customer.email,
    customerPhone: body.customer.phone,
    customerName: `${body.customer.firstName} ${body.customer.lastName}`,
    items: priced.orderItems,
    subtotal: priced.subtotal,
    deliveryFee: priced.deliveryFee,
    total: priced.total,
    paymentStatus: "pending",
    orderStatus: "pending",
    deliveryMethod: body.deliveryMethod,
    deliveryAddress: body.customer.address,
    deliveryZone: priced.deliveryZoneName ?? body.deliveryZone ?? null,
    deliverySlot: body.deliverySlot ?? null,
    stripeSessionId: null,
    stripePaymentIntentId: null,
    stripeEventIds: [],
    statusHistory: [
      {
        status: "pending",
        changedAt: new Date().toISOString(),
        changedBy: "system",
        note: "Commande creee avant paiement.",
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
