import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { priceCheckout, type CheckoutRequestBody } from "../api/_server/checkout.js";
import {
  effectivePostalDeliveryMinimum,
  postalDeliveryFee,
  POSTAL_DELIVERY_FEE,
  POSTAL_DELIVERY_MINIMUM,
  POSTAL_FREE_SHIPPING_THRESHOLD,
} from "../src/config/deliveryRules.js";

assert.equal(POSTAL_DELIVERY_FEE, 5.49);
assert.equal(POSTAL_FREE_SHIPPING_THRESHOLD, 50);
assert.equal(POSTAL_DELIVERY_MINIMUM, 15);
assert.equal(effectivePostalDeliveryMinimum(60), 15, "Firestore must not override the postal minimum");
assert.equal(postalDeliveryFee(49.99), 5.49);
assert.equal(postalDeliveryFee(50), 0);

const configuredQuote = await priceCheckout(stalePostalDatabase(0, 60), checkoutBody(2));
assert.equal(configuredQuote.subtotal, 20);
assert.equal(configuredQuote.deliveryFee, 5.49, "a stale Firestore fee must be ignored");
assert.equal(configuredQuote.deliveryMinimumApplied, 15, "a stale Firestore minimum must be ignored");
assert.equal(configuredQuote.deliveryFeeStatus, "configured");
assert.equal(configuredQuote.postalFreeShippingApplied, false);
assert.equal(configuredQuote.total, 25.49);
assert.match(configuredQuote.deliveryNote, /5,49 €/);
assert.match(configuredQuote.deliveryNote, /2 à 3 jours ouvrés/);
assert.match(configuredQuote.deliveryNote, /Suivi Colissimo inclus/);
assert.match(configuredQuote.deliveryNote, /Préparation sous 24 h ouvrées/);

const freeQuote = await priceCheckout(stalePostalDatabase(5.99, 15), checkoutBody(5));
assert.equal(freeQuote.subtotal, 50);
assert.equal(freeQuote.deliveryFee, 0);
assert.equal(freeQuote.deliveryFeeStatus, "free");
assert.equal(freeQuote.postalFreeShippingApplied, true);
assert.equal(freeQuote.total, 50);

const overseasBody = checkoutBody(2);
overseasBody.customer.address.postalCode = "97100";
await assert.rejects(
  () => priceCheckout(stalePostalDatabase(5.49, 15), overseasBody),
  /France métropolitaine/,
);

const publicFlowFiles = [
  "src/pages/CartPage.tsx",
  "src/pages/CheckoutPage.tsx",
  "src/pages/CheckoutSuccessPage.tsx",
  "src/pages/DeliveryPage.tsx",
  "src/data/deliveryZones.ts",
  "api/_server/checkout.ts",
  "api/_server/email.ts",
];
const obsoletePostalCopy = [
  /frais postaux? (?:à|a) confirmer/i,
  /frais postaux? confirmés? .*après validation/i,
  /livraison postale offerte .*60\s*(?:€|EUR)/i,
  /offerte à partir de 60\s*(?:€|EUR)/i,
];

for (const file of publicFlowFiles) {
  const source = readFileSync(file, "utf8");
  for (const pattern of obsoletePostalCopy) {
    assert.doesNotMatch(source, pattern, `${file} still contains obsolete postal copy`);
  }
}

console.log("Postal delivery tests passed.");

function checkoutBody(quantity: number): CheckoutRequestBody {
  return {
    items: [{ productId: "product-postal", quantity }],
    deliveryMethod: "postal",
    deliveryZone: "postal-france",
    preferredPaymentMethod: "card_payment_link",
    complianceAccepted: true,
    customer: {
      email: "client@example.com",
      phone: "0600000000",
      firstName: "Client",
      lastName: "Test",
      address: {
        firstName: "Client",
        lastName: "Test",
        line1: "1 rue Test",
        postalCode: "13090",
        city: "Aix-en-Provence",
        country: "France",
      },
    },
  };
}

function stalePostalDatabase(fee: number, minimumOrder: number) {
  const products = {
    "product-postal": {
      id: "product-postal",
      slug: "product-postal",
      name: "Produit postal",
      category: "flowers",
      cultureType: "greenhouse",
      isActive: true,
      stock: 100,
      price: 10,
    },
  };
  const deliveryZones = {
    "postal-france": {
      id: "postal-france",
      name: "Ancienne livraison postale",
      method: "postal",
      isActive: true,
      fee,
      minimumOrder,
      minimumOrderAmount: minimumOrder,
      estimatedDelay: "Ancienne configuration",
      slots: [],
    },
  };
  const collections: Record<string, Record<string, Record<string, unknown>>> = {
    products,
    deliveryZones,
    coupons: {},
  };

  return {
    collection(name: string) {
      const entries = collections[name] ?? {};
      return {
        doc(id: string) {
          return {
            async get() {
              const value = entries[id];
              return { id, exists: Boolean(value), data: () => value };
            },
          };
        },
        async get() {
          return {
            docs: Object.entries(entries).map(([id, value]) => ({
              id,
              data: () => value,
            })),
          };
        },
      };
    },
  } as unknown as FirebaseFirestore.Firestore;
}
