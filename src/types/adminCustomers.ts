export const customerStatuses = ["new", "active", "loyal", "watch", "archived"] as const;
export type CustomerStatus = typeof customerStatuses[number];
export type CustomerIdentity = { id: string; uid: string; name: string; email: string; phone: string; status: CustomerStatus | null; archived: boolean; hidden: boolean; createdAt: string | null; points: number | null; historicalOrderCount: number | null; historicalOrderedCents: number | null; historicalNote: string; hasNote: boolean; hasPromo: boolean; promos?: { code: string; isActive: boolean; assignedAt: string | null }[]; tags: string[] };
export type CustomerMetrics = { count: number | null; orderedCents: number | null; paidCents: number | null; refundedCents: number | null; netCents: number | null; averageCents: number | null; complete: boolean; lastOrderAt: string | null };
export type CustomerSummary = { customer: CustomerIdentity; metrics: CustomerMetrics; lastActivityAt: string | null; activityScope: string };
export type CustomerOrder = { id: string; reference: string; date: string | null; status: string | null; paymentStatus: string | null; totalCents: number | null; paidCents: number | null; cagnotteCents: number | null; refundedCents: number | null; confidence: "confirmed" | "probable"; match: "uid" | "email" | "phone"; refundUnknown: boolean };
export type CustomerPage<T> = { items: T[]; nextCursor: string | null };
export type CustomerActivityItem = { id: string; kind: "orders" | "favorites" | "reviews" | "comments"; date: string | null; summary: string; href: string | null };
export type CustomerReferralRelation = { id: string; sponsorUid: string | null; refereeUid: string | null; state: string | null; orderId: string | null; rewardCents: number | null; compartment: string | null; date: string | null; reason: string | null };
export type CustomerReferralPage = CustomerPage<CustomerReferralRelation> & { mode: "off" | "drain" | "active"; code: string | null; sponsor: CustomerReferralRelation | null };
export type CustomerAudit = { id: string; action: string; adminUid: string; date: string | null; reason: string; before: Record<string, unknown>; after: Record<string, unknown> };
export type CustomerMetadata = { revision: number; note: string; tags: string[]; updatedAt: string | null; updatedBy: string | null; audit: CustomerPage<CustomerAudit> };
export type CustomerLegacyLoyalty = CustomerPage<{ id: string; points: number | null; reason: string; date: string | null }> & { points: number | null; source?: "movements" | "profile_history" | "none" };
export type CustomerMutation = { customerId: string; expectedRevision: number } & (
  { kind: "metadata"; note: string; tags: string[] } |
  { kind: "status"; status: CustomerStatus; archived: boolean; hidden: boolean; expectedStatus: CustomerStatus | null; expectedArchived: boolean; expectedHidden: boolean; reason: string } |
  { kind: "points"; expectedPoints: number; targetPoints: number; reason: string } |
  { kind: "promo"; couponId: string; reason: string }
);
