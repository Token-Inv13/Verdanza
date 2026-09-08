export function formatAdminDate(value?: string | number | unknown) {
  const timestamp = adminDateValue(value);
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(timestamp));
}

export function formatAdminDateTime(value?: string | number | unknown) {
  const timestamp = adminDateValue(value);
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function adminDateValue(value: unknown) {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") return Date.parse(value) || 0;
  if (typeof value === "object" && "seconds" in value) {
    const timestamp = Number((value as { seconds?: number }).seconds || 0) * 1000;
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  return 0;
}
