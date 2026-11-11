import assert from "node:assert/strict";
import "./testWithdrawalContact";
import { validateWithdrawalBody, receiveWithdrawal } from "../api/_server/withdrawal";
import { buildMerchantReturnPolicyJsonLd, buildReturnPolicyOrganizationJsonLd, buildHomeJsonLd } from "../src/lib/structuredData";
import { returnPolicySections } from "../src/config/returnPolicy";

const policy = JSON.parse(JSON.stringify(buildMerchantReturnPolicyJsonLd()));
assert.equal(policy.applicableCountry, "FR");
assert.equal(policy.returnPolicyCategory, "https://schema.org/MerchantReturnFiniteReturnWindow");
assert.equal(policy.merchantReturnDays, 14);
assert.equal(policy.returnMethod, "https://schema.org/ReturnByMail");
assert.equal(policy.returnFees, "https://schema.org/ReturnFeesCustomerResponsibility");
assert.equal(policy.merchantReturnLink, "https://verdanza.fr/retours");
assert.ok(!("returnShippingFeesAmount" in policy), "customer-paid postage is not a merchant-charged flat fee");
assert.ok(!("returnAddress" in policy) && !("returnPolicyCountry" in policy), "do not invent the private return location");
const organization = JSON.parse(JSON.stringify(buildReturnPolicyOrganizationJsonLd()));
assert.equal(organization.hasMerchantReturnPolicy.itemDefectReturnFees, "https://schema.org/FreeReturn");
const home = JSON.parse(JSON.stringify(buildHomeJsonLd()));
assert.deepEqual(home["@graph"].find((node: Record<string, unknown>) => node["@type"] === "OnlineStore").hasMerchantReturnPolicy, organization.hasMerchantReturnPolicy);
const copy = returnPolicySections("contact@verdanza.fr").flatMap((section) => section.items).join("\n");
assert.match(copy, /simple zip.*à elle seule/);
assert.match(copy, /14 jours suivants/);
assert.match(copy, /première de ces dates/);
assert.match(copy, /ne dépend pas d’une autorisation/);
assert.doesNotMatch(copy, /politique finale|au cas par cas|produits ouverts.*exclus/i);

const input = { name: "Client Exemple", email: "client@example.test", contract: "Commande TEST-123", items: "", confirmed: true };
const details = validateWithdrawalBody(input);
assert.equal(details.items, "totalité de la commande");
for (const invalid of [null, { ...input, confirmed: false }, { ...input, email: "invalid" }, { ...input, contract: "" }, { ...input, name: "x" }, { ...input, items: "x".repeat(1001) }]) {
  assert.throws(() => validateWithdrawalBody(invalid));
}
const events: string[] = [];
const fixture = {
  now: () => new Date("2026-11-11T12:30:00.000Z"), createId: () => "withdrawal-fixture",
  notifyMerchant: async () => { events.push("merchant"); return { status: "sent" }; },
  acknowledgeCustomer: async () => { events.push("customer"); return { status: "sent" }; },
};
const result = await receiveWithdrawal(details, fixture);
assert.deepEqual(events, ["merchant", "customer"]);
assert.equal(result.accepted, true);
assert.equal(result.receiptEmailSent, true);
assert.match(result.receipt.text, /2026-11-11T12:30:00.000Z/);
assert.match(result.receipt.text, /Commande TEST-123/);
assert.match(result.receipt.text, /client@example.test/);
for (const status of ["skipped", "failed", "partial"]) {
  let acknowledgements = 0;
  await assert.rejects(() => receiveWithdrawal(details, {
    ...fixture, notifyMerchant: async () => ({ status }),
    acknowledgeCustomer: async () => { acknowledgements++; return { status: "sent" }; },
  }));
  assert.equal(acknowledgements, 0, "never acknowledge an undelivered declaration");
}
for (const acknowledgeCustomer of [async () => ({ status: "failed" }), async () => { throw new Error("fixture failure"); }]) {
  const received = await receiveWithdrawal(details, { ...fixture, acknowledgeCustomer });
  assert.equal(received.accepted, true, "customer email failure must not erase a received declaration");
  assert.equal(received.receiptEmailSent, false);
  assert.equal(received.receipt.id, "withdrawal-fixture");
}
console.log("PASS return policy: consistent 14-day policy, customer/defect fees, private address, validated confirmation, timestamped receipt and delivery failure handling (mocks only).");
