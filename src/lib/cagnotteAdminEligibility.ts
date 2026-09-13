import { simulateCagnotteRefund } from "./cagnotteCalculations";
import type { Order } from "../types";

/**
 * Client-side mounting check for a server-persisted order enrollment.
 * The API repeats the authoritative validation before every operation.
 */
export function hasValidCagnotteAdminEnrollment(order: Pick<Order, "id" | "customerId" | "cagnotte" | "cagnotteReservationIntent">) {
  const enrollment = order.cagnotte;
  if (!enrollment || enrollment.schemaVersion !== 1 || !order.customerId ||
    enrollment.beneficiaryId !== order.customerId || !enrollment.programVersion ||
    !Number.isSafeInteger(enrollment.createdAtEpochMs) || enrollment.createdAtEpochMs < 0 ||
    enrollment.calculationVersion !== "cagnotte-math-v1" ||
    enrollment.snapshot?.calculationVersion !== enrollment.calculationVersion) return false;
  try {
    simulateCagnotteRefund(enrollment.snapshot, [], []);
  } catch {
    return false;
  }
  const intent = order.cagnotteReservationIntent;
  if (enrollment.snapshot.appliedCagnotteCents === 0) return intent === undefined;
  return Boolean(intent && intent.schemaVersion === 1 && intent.reservationVersion === "cagnotte-reservation-v1" &&
    intent.order.orderId === order.id && intent.order.beneficiaryId === enrollment.beneficiaryId &&
    intent.order.programVersion === enrollment.programVersion && intent.order.createdAtEpochMs === enrollment.createdAtEpochMs &&
    intent.amountCents === enrollment.snapshot.appliedCagnotteCents &&
    sameJsonValue(intent.order.snapshot, enrollment.snapshot));
}

export function shouldMountCagnotteAdminTools(input: {
  displayEnabled: boolean;
  orderSource: "firestore" | string;
  order: Pick<Order, "id" | "customerId" | "cagnotte" | "cagnotteReservationIntent">;
}) {
  return input.displayEnabled && input.orderSource === "firestore" && hasValidCagnotteAdminEnrollment(input.order);
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((entry, index) => sameJsonValue(entry, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>, rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort(), rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
    key === rightKeys[index] && sameJsonValue(leftRecord[key], rightRecord[key]));
}
