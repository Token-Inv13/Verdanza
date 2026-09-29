import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../lib/firebase";
import { assertOrdinaryCustomerAdminMutationAllowed } from "../lib/productionFixtureMarker";
import { collections } from "./collections";
import { mutateAdminCustomer, readAdminCustomers } from "./adminCustomersV2Service";
import type { Coupon, CustomerProfile } from "../types";
import type { CustomerMetadata, CustomerSummary } from "../types/adminCustomers";

// Retained for the other admin sections. Clients V2 uses its bounded server list.
export async function getAdminCustomersWithFallback() {
  if (!db) return { customers: [], source: "empty" as const };
  try {
    const snapshot = await getDocs(query(collection(db, collections.customers), orderBy("updatedAt", "desc")));
    const customers = snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }) as CustomerProfile);
    return { customers, source: customers.length ? "firestore" as const : "empty" as const };
  } catch (error) { console.warn("Unable to load Firestore customers", error); return { customers: [], source: "empty" as const }; }
}
async function state(customer: CustomerProfile) {
  assertOrdinaryCustomerAdminMutationAllowed(customer);
  return readAdminCustomers<CustomerMetadata>("adminCustomerMetadata", { customerId: customer.id });
}
// Compatibility entrypoints also use the authenticated server, never browser writes.
export async function adjustCustomerLoyalty(customer: CustomerProfile, points: number, note: string, mode: "add" | "remove" | "set" = "add", reason = "Correction historique") {
  const meta = await state(customer);
  const targetPoints = mode === "set" ? points : customer.loyaltyPoints + points;
  return mutateAdminCustomer({ kind: "points", customerId: customer.id, expectedRevision: meta.revision, expectedPoints: customer.loyaltyPoints, targetPoints, reason: note ? reason + " — " + note : reason });
}
export async function updateCustomerInternalNote(customer: CustomerProfile, note: string) {
  const meta = await state(customer);
  return mutateAdminCustomer({ kind: "metadata", customerId: customer.id, expectedRevision: meta.revision, note, tags: meta.tags });
}
export async function updateCustomerAdminStatus(customer: CustomerProfile, data: { status?: CustomerProfile["status"]; archived?: boolean; hidden?: boolean }) {
  const meta = await state(customer);
  const { customer: current } = await readAdminCustomers<CustomerSummary>("adminCustomerSummary", { customerId: customer.id });
  const archived = data.archived ?? (data.status ? data.status === "archived" : current.archived);
  return mutateAdminCustomer({ kind: "status", customerId: customer.id, expectedRevision: meta.revision, expectedStatus: current.status, expectedArchived: current.archived, expectedHidden: current.hidden,
    status: archived ? "archived" : data.status && data.status !== "archived" ? data.status : current.status && current.status !== "archived" ? current.status : "active", archived, hidden: data.hidden ?? current.hidden, reason: "Modification depuis un ancien contrôle admin" });
}
export async function assignPromoToCustomer(customer: CustomerProfile, coupon: Coupon, note: string) {
  const meta = await state(customer);
  return mutateAdminCustomer({ kind: "promo", customerId: customer.id, expectedRevision: meta.revision, couponId: coupon.id, reason: note || "Attribution pour suivi interne" });
}
