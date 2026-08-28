const promotionTimeZone = "Europe/Paris";
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export function promotionBoundaryTimestamp(
  value: string | null | undefined,
  boundary: "start" | "end",
) {
  const normalized = String(value || "").trim();
  if (!normalized) return 0;
  if (!dateOnlyPattern.test(normalized)) {
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const [year, month, day] = normalized.split("-").map(Number);
  return zonedDateTimeToUtc({
    year,
    month,
    day,
    hour: boundary === "end" ? 23 : 0,
    minute: boundary === "end" ? 59 : 0,
    second: boundary === "end" ? 59 : 0,
    millisecond: boundary === "end" ? 999 : 0,
  });
}

export function promotionAvailability(
  promotion: {
    isActive?: boolean;
    isArchived?: boolean;
    startsAt?: string;
    endsAt?: string;
    maxUses?: number;
    usedCount?: number;
  },
  now: Date | number = Date.now(),
) {
  const nowTime = typeof now === "number" ? now : now.getTime();
  if (!promotion.isActive || promotion.isArchived) return "inactive" as const;
  const startsAt = promotionBoundaryTimestamp(promotion.startsAt, "start");
  const endsAt = promotionBoundaryTimestamp(promotion.endsAt, "end");
  if (startsAt && nowTime < startsAt) return "scheduled" as const;
  if (endsAt && nowTime > endsAt) return "expired" as const;
  if (
    Number(promotion.maxUses || 0) > 0 &&
    Number(promotion.usedCount || 0) >= Number(promotion.maxUses || 0)
  ) {
    return "max_uses" as const;
  }
  return "active" as const;
}

export function promotionDateTimeLocalToIso(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return "";
  return new Date(
    zonedDateTimeToUtc({
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6] || 0),
      millisecond: 0,
    }),
  ).toISOString();
}

export function promotionDateTimeLocalValue(value?: string) {
  if (!value) return "";
  if (dateOnlyPattern.test(value)) return `${value}T00:00`;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = zonedParts(date);
  return `${parts.year}-${two(parts.month)}-${two(parts.day)}T${two(parts.hour)}:${two(parts.minute)}`;
}

function zonedDateTimeToUtc(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}) {
  const desiredUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  let candidate = desiredUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const visible = zonedParts(new Date(candidate));
    const visibleUtc = Date.UTC(
      visible.year,
      visible.month - 1,
      visible.day,
      visible.hour,
      visible.minute,
      visible.second,
      parts.millisecond,
    );
    candidate -= visibleUtc - desiredUtc;
  }
  return candidate;
}

function zonedParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: promotionTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function two(value: number) {
  return String(value).padStart(2, "0");
}
