import { presentOrderFinancing, exactEuroCents, type OrderFinancingSource } from "./orderFinancing.js";
import { customerStatuses, type CustomerIdentity, type CustomerMetrics, type CustomerOrder } from "../types/adminCustomers.js";

export const available = (value: unknown): string => typeof value === "string" && value.trim() ? value.trim() : "Non disponible";
export const centsLabel = (value: number | null): string => value === null ? "Non disponible" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value / 100);
export function knownInteger(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
export function knownDate(value: unknown): string | null {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") return knownDate(value.toDate().toISOString());
  return null;
}
export function dateLabel(value: string | null): string { return value ? new Date(value).toLocaleString("fr-FR") : "Non disponible"; }
export function customerStatus(value: unknown): CustomerIdentity["status"] { return customerStatuses.includes(value as CustomerIdentity["status"] & string) ? value as CustomerIdentity["status"] : null; }
export function matchCustomerOrder(customer: Pick<CustomerIdentity, "uid" | "email" | "phone">, data: Record<string, unknown>): { confidence: CustomerOrder["confidence"]; match: CustomerOrder["match"] } | null {
  if (typeof data.customerId === "string" && data.customerId.trim()) return data.customerId === customer.uid ? { confidence: "confirmed", match: "uid" } : null;
  const email = typeof data.customerEmail === "string" ? data.customerEmail.trim().toLowerCase() : "";
  if (customer.email && email === customer.email.trim().toLowerCase()) return { confidence: "probable", match: "email" };
  const phone = (value: unknown) => typeof value === "string" ? value.replace(/\D/g, "") : "";
  if (phone(customer.phone).length >= 8 && phone(data.customerPhone) === phone(customer.phone)) return { confidence: "probable", match: "phone" };
  return null;
}
export function projectCustomerOrder(id: string, data: Record<string, unknown>, link: NonNullable<ReturnType<typeof matchCustomerOrder>>): CustomerOrder {
  let totalCents: number | null = null; let paidCents: number | null = null; let cagnotteCents: number | null = null; let refundedCents: number | null = null;
  try { totalCents = exactEuroCents(data.total); } catch { /* Unknown never becomes zero. */ }
  try {
    const finance = presentOrderFinancing({ ...data, id } as OrderFinancingSource);
    if (finance.verification === "verified") {
      cagnotteCents = finance.cagnotteCents;
      if (finance.externalPaymentState === "confirmed" && knownDate(data.paymentConfirmedAt || data.paidAt)) paidCents = finance.paymentCents;
      else if ((data.paymentStatus === "pending" || data.paymentStatus === "to_confirm" || data.paymentStatus === "unpaid") && !data.paidAt && !data.paymentConfirmedAt) paidCents = 0;
      if (finance.refund && !finance.refundVerificationRequired) refundedCents = finance.refund.totalFinancialCents;
    }
  } catch { /* Financial verification is unavailable. */ }
  // Absence of a refund summary is not evidence of a zero refund, including ordinary orders.
  return { id, reference: typeof data.orderNumber === "string" ? data.orderNumber : id.slice(0, 12), date: knownDate(data.createdAt), status: typeof data.orderStatus === "string" ? data.orderStatus : null,
    paymentStatus: typeof data.paymentStatus === "string" ? data.paymentStatus : null, totalCents, paidCents, cagnotteCents, refundedCents, refundUnknown: refundedCents === null, ...link };
}
export function commercialMetrics(orders: CustomerOrder[], complete: boolean): CustomerMetrics {
  const confirmed = orders.filter((order) => order.confidence === "confirmed");
  const sum = (field: "totalCents" | "paidCents" | "refundedCents") => {
    if (!complete || !confirmed.every((order) => order[field] !== null)) return null;
    const result = confirmed.reduce((total, order) => total + order[field]!, 0);
    return Number.isSafeInteger(result) ? result : null;
  };
  const orderedCents = sum("totalCents"), paidCents = sum("paidCents"), refundedCents = sum("refundedCents");
  const netCents = paidCents !== null && refundedCents !== null && refundedCents <= paidCents ? paidCents - refundedCents : null;
  return { count: complete ? confirmed.length : null, orderedCents, paidCents, refundedCents, netCents,
    averageCents: complete && orderedCents !== null && confirmed.length > 0 ? Math.round(orderedCents / confirmed.length) : null,
    complete, lastOrderAt: confirmed.map((order) => order.date).filter((date): date is string => !!date).sort().slice(-1)[0] || null };
}
export type CustomerFilter = "active" | "all" | "new" | "loyal" | "watch" | "withOrders" | "withoutOrders" | "withNote" | "withPromo" | "archived";
export function filterCustomers(items: CustomerIdentity[], search: string, filter: CustomerFilter, sort: string): CustomerIdentity[] {
  const text = search.trim().toLocaleLowerCase("fr");
  return items.filter((item) => [item.name, item.email, item.phone, ...item.tags].join(" ").toLocaleLowerCase("fr").includes(text))
    .filter((item) => filter === "archived" ? item.archived || item.status === "archived" : filter === "all" ? true : !item.archived && !item.hidden && item.status !== "archived")
    .filter((item) => ["new", "loyal", "watch"].includes(filter) ? item.status === filter : filter === "withNote" ? item.hasNote : filter === "withPromo" ? item.hasPromo : filter === "withOrders" ? item.historicalOrderCount !== null && item.historicalOrderCount > 0 : filter === "withoutOrders" ? item.historicalOrderCount === 0 : true)
    .sort((left, right) => sort === "name" ? left.name.localeCompare(right.name, "fr") : sort === "points" ? (right.points ?? -1) - (left.points ?? -1) : sort === "ordered" ? (right.historicalOrderedCents ?? -1) - (left.historicalOrderedCents ?? -1) : sort === "orders" ? (right.historicalOrderCount ?? -1) - (left.historicalOrderCount ?? -1) : (right.createdAt || "").localeCompare(left.createdAt || ""));
}
