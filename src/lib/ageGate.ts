export const AGE_GATE_STORAGE_KEY = "verdanza-age-confirmed";
export const AGE_GATE_CONFIRMED_EVENT = "verdanza:age-confirmed";
export const AGE_GATE_PENDING_CLASS = "age-gate-pending";

export function isAgeConfirmedLocally() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AGE_GATE_STORAGE_KEY) === "true";
}
