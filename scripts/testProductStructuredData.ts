import assert from "node:assert/strict";
import { products } from "../src/data/products";
import { availableProductStock, isProductOrderable, publicProductStockLabel } from "../src/lib/cartStock";
import { buildHomeJsonLd, buildProductJsonLd } from "../src/lib/structuredData";

const fixture = { ...products[0], isActive: true, stock: 8 };
const offer = (product = fixture) => JSON.parse(JSON.stringify(buildProductJsonLd(product))).offers;

const details = offer().shippingDetails;
assert.equal(details["@type"], "OfferShippingDetails");
assert.equal(details.shippingDestination.addressCountry, "FR");
assert.equal(details.shippingSettingsLink, "https://verdanza.fr/livraison-postale");
assert.deepEqual(details.shippingRate, { "@type": "MonetaryAmount", maxValue: 5.49, currency: "EUR" });
assert.ok(!("value" in details.shippingRate), "do not claim a flat fee for a basket eligible for free delivery");
assert.deepEqual(details.deliveryTime.handlingTime, { "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "DAY" });
assert.deepEqual(details.deliveryTime.transitTime, { "@type": "QuantitativeValue", minValue: 2, maxValue: 2, unitCode: "DAY" });

const home = JSON.parse(JSON.stringify(buildHomeJsonLd()));
const service = home["@graph"].find((node: { "@type": string }) => node["@type"] === "OnlineStore").hasShippingService;
assert.equal(service["@type"], "ShippingService");
for (const [subtotal, expectedFee] of [[0, null], [14.99, null], [15, 5.49], [49.99, 5.49], [50, 0], [100, 0]] as const) {
  const matching = service.shippingConditions.filter((condition: { orderValue: { minValue?: number; maxValue?: number } }) =>
    subtotal >= (condition.orderValue.minValue ?? 0) && subtotal <= (condition.orderValue.maxValue ?? Infinity),
  );
  assert.equal(matching.length, 1, `${subtotal} EUR must have exactly one shipping condition`);
  assert.equal(matching[0].shippingDestination.addressCountry, "FR");
  if (expectedFee === null) assert.equal(matching[0].doesNotShip, true);
  else assert.equal(matching[0].shippingRate.value, expectedFee);
}

const unverified = { ...fixture, stockVerified: false };
assert.equal(availableProductStock(unverified), 0, "stale positive stock must remain non-commercial");
assert.equal(isProductOrderable(unverified), false);
assert.equal(publicProductStockLabel(unverified), "Disponibilité à confirmer");
assert.ok(!("availability" in offer(unverified)), "unknown stock must not be declared as zero stock");
assert.equal(offer().availability, "https://schema.org/InStock");
assert.equal(offer({ ...fixture, stock: 0 }).availability, "https://schema.org/OutOfStock");
assert.equal(offer({ ...fixture, isActive: false }).availability, "https://schema.org/OutOfStock");
for (const product of [fixture, unverified, { ...fixture, stock: 0 }]) {
  const schema = JSON.parse(JSON.stringify(buildProductJsonLd(product)));
  assert.ok(!("review" in schema) && !("aggregateRating" in schema) && !("brand" in schema));
  assert.ok(!("hasMerchantReturnPolicy" in schema.offers), "do not invent a return policy");
}

console.log("PASS product structured data: shipping minimum/free threshold boundaries, 2–3 day delivery, unverified/available/sold-out/inactive stock and no invented identifiers or returns.");
