export const preorderOpeningDate =
  (import.meta.env.VITE_OPENING_DATE as string | undefined) ||
  "2026-07-16T11:00:00+02:00";

export function isPreorderEnabled() {
  const raw =
    (import.meta.env.VITE_PREORDER_MODAL_ENABLED as string | undefined) ?? "true";
  return !["false", "0", "off", "no"].includes(raw.toLowerCase());
}

export function isPreorderActive(now = new Date()) {
  if (!isPreorderEnabled()) return false;
  const openingTime = Date.parse(preorderOpeningDate);
  if (!Number.isFinite(openingTime)) return true;
  return now.getTime() < openingTime;
}

export function getPreorderCountdown(now = new Date()) {
  const openingTime = Date.parse(preorderOpeningDate);
  if (!Number.isFinite(openingTime)) {
    return { days: 0, hours: 0, minutes: 0 };
  }
  const diff = Math.max(0, openingTime - now.getTime());
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes - days * 60 * 24) / 60);
  const minutes = totalMinutes % 60;
  return { days, hours, minutes };
}
