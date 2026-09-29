import { promotionBoundaryTimestamp, promotionDateTimeLocalToIso, promotionDateTimeLocalValue } from "./promotionDates.js";

export const marketingTimeZone = "Europe/Paris";

// Keep the user's local value when a DST gap or repeated hour needs correction.
export function marketingLocalToIso(value: string): string {
  if (!value) return "";
  const candidate = promotionDateTimeLocalToIso(value);
  if (!candidate || promotionDateTimeLocalValue(candidate) !== value.slice(0, 16)) return value;
  const time = Date.parse(candidate);
  if ([-3600000, 3600000].some((delta) => promotionDateTimeLocalValue(new Date(time + delta).toISOString()) === value.slice(0, 16))) return value;
  return candidate;
}

export function marketingLocalValue(value?: string, boundary: "start" | "end" = "start") {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return promotionDateTimeLocalValue(new Date(promotionBoundaryTimestamp(value, boundary)).toISOString());
  return promotionDateTimeLocalValue(value);
}

export function marketingUtcDate(value: unknown, boundary: "start" | "end" = "start") {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new Error("Date invalide : utilisez une date UTC ou avec fuseau explicite.");
  // Preserve the historical inclusive Paris boundaries of date-only promotions.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const timestamp = promotionBoundaryTimestamp(value, boundary);
    const iso = new Date(timestamp).toISOString();
    if (!marketingLocalValue(iso).startsWith(value)) throw new Error("Date calendrier invalide.");
    return iso;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("Date invalide ou heure Europe/Paris ambiguë/inexistante. Choisissez une autre heure.");
  }
  const calendar = value.slice(0, 10);
  const parsedCalendar = new Date(`${calendar}T12:00:00Z`).toISOString().slice(0, 10);
  if (calendar !== parsedCalendar) throw new Error("Date calendrier invalide.");
  return new Date(value).toISOString();
}

export function formatMarketingDate(value?: string, boundary: "start" | "end" = "start") {
  if (!value) return "Sans limite";
  if (!Number.isFinite(Date.parse(value))) return "Date à corriger";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: marketingTimeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? promotionBoundaryTimestamp(value, boundary) : value));
}
