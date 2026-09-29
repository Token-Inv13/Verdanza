export const settingsFixture = {
  billingSource: "firestore" as "firestore" | "local",
  deliveryEmpty: false,
  aiState: "disabled" as "disabled" | "missing_configuration" | "ready",
  failure: "" as "" | "billing" | "delivery" | "ai",
  reads: 0,
};

export async function getBillingSettings() {
  settingsFixture.reads++;
  if (settingsFixture.failure === "billing") throw new Error("Fixture billing refusal");
  return { source: settingsFixture.billingSource, settings: { isManuallyValidated: true, vatMode: "franchise" } };
}
export async function getAdminDeliveryZones() {
  settingsFixture.reads++;
  if (settingsFixture.failure === "delivery") throw new Error("Fixture delivery refusal");
  return { source: settingsFixture.deliveryEmpty ? "empty" : "firestore", zones: settingsFixture.deliveryEmpty ? [] : [{ id: "fixture-zone" }] };
}
export async function getMarketingAiStatus() {
  settingsFixture.reads++;
  if (settingsFixture.failure === "ai") throw new Error("Fixture AI refusal");
  return { state: settingsFixture.aiState, configured: settingsFixture.aiState === "ready", maxProposals: 3 };
}
