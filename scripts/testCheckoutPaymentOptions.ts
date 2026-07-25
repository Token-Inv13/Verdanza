import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCheckoutBody } from "../api/_server/checkout.js";
import type { CheckoutRequestBody } from "../api/_server/checkout.js";

const checkoutSource = readFileSync("src/pages/CheckoutPage.tsx", "utf8");

assert.doesNotMatch(
  checkoutSource,
  /<option\s+value="confirm_with_verdanza"/,
  "checkout select must not expose confirm_with_verdanza",
);
assert.match(
  checkoutSource,
  /bank_transfer:\s*"Virement bancaire"/,
  "bank transfer label must be exactly Virement bancaire",
);
assert.doesNotMatch(
  checkoutSource,
  /Virement bancaire\s*\([^)]*disponible[^)]*\)/i,
  "bank transfer label must not include availability wording",
);
assert.match(
  checkoutSource,
  /<option value="bank_transfer" disabled>/,
  "bank transfer option must stay disabled",
);
assert.match(
  checkoutSource,
  /useState<CheckoutSelectablePaymentMethod>\("card_payment_link"\)/,
  "card payment link must be the default selected method",
);
assert.match(
  checkoutSource,
  /setPreferredPaymentMethod\("card_payment_link"\);\s*\}, \[deliveryMethod\]\);/,
  "changing delivery method must reset payment selection to card payment link",
);

const cashOptionIndex = checkoutSource.indexOf('<option value="cash_on_delivery">');
assert.notEqual(cashOptionIndex, -1, "local cash option must remain available");
assert.notEqual(
  checkoutSource.lastIndexOf("{isLocalDelivery &&", cashOptionIndex),
  -1,
  "cash option must be guarded by local delivery mode",
);

const baseBody: CheckoutRequestBody = {
  items: [{ productId: "product-1", quantity: 1 }],
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

assert.equal(
  parseCheckoutBody(baseBody).preferredPaymentMethod,
  "card_payment_link",
  "card payment link must be accepted for postal delivery",
);
assert.equal(
  parseCheckoutBody({
    ...baseBody,
    deliveryMethod: "local_express",
    deliveryZone: "local-aix",
  }).preferredPaymentMethod,
  "card_payment_link",
  "card payment link must be accepted for local delivery",
);
assert.equal(
  parseCheckoutBody({
    ...baseBody,
    deliveryMethod: "local_express",
    deliveryZone: "local-aix",
    preferredPaymentMethod: "cash_on_delivery",
  }).preferredPaymentMethod,
  "cash_on_delivery",
  "cash must be accepted only for local delivery",
);

assert.throws(
  () => parseCheckoutBody({ ...baseBody, preferredPaymentMethod: "cash_on_delivery" }),
  /livraison postale/,
  "cash must be rejected for postal delivery",
);
assert.throws(
  () => parseCheckoutBody({ ...baseBody, preferredPaymentMethod: "bank_transfer" }),
  /Virement bancaire/,
  "bank transfer must remain non-selectable server-side",
);
assert.throws(
  () => parseCheckoutBody({ ...baseBody, preferredPaymentMethod: "confirm_with_verdanza" }),
  /Mode de reglement invalide/,
  "confirm_with_verdanza must be rejected for new orders",
);
assert.throws(
  () =>
    parseCheckoutBody({
      ...baseBody,
      deliveryMethod: "local_express",
      deliveryZone: "local-aix",
      preferredPaymentMethod: "local_delivery_payment",
    }),
  /Mode de reglement invalide/,
  "legacy local_delivery_payment alias must not be selectable for new orders",
);

console.log("Checkout payment option tests passed.");
