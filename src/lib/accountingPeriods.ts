export const ACCOUNTING_TIME_ZONE = "Europe/Paris";

export type AccountingPeriodFilter = "week" | "month" | "year" | "custom";

export type AccountingDateInput =
  | string
  | Date
  | null
  | undefined
  | {
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
    };

export type AccountingCivilDate = {
  year: number;
  month: number;
  day: number;
};

export type AccountingPeriodRange = {
  kind: AccountingPeriodFilter;
  start: Date;
  end: Date;
  civilStart: AccountingCivilDate;
  civilEndExclusive: AccountingCivilDate;
};

export type AccountingDateQuality =
  | "exact"
  | "legacy_explicit"
  | "legacy_estimated"
  | "missing";

export type AccountingDateResolution = {
  date: Date | null;
  quality: AccountingDateQuality;
  source:
    | "createdAt"
    | "paymentConfirmedAt"
    | "paidAt"
    | "updatedAt"
    | "validatedAt"
    | "invoiceDate"
    | "missing";
};

type AccountingOrderDateLike = {
  createdAt?: AccountingDateInput;
  updatedAt?: AccountingDateInput;
  paymentConfirmedAt?: AccountingDateInput;
  paidAt?: AccountingDateInput;
};

type AccountingSupplierPurchaseDateLike = {
  validatedAt?: AccountingDateInput;
  invoiceDate?: AccountingDateInput;
};

const zonedDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ACCOUNTING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function parseAccountingInstant(value: AccountingDateInput): Date | null {
  if (!value) return null;
  if (value instanceof Date) return validDate(value);
  if (typeof value === "string") {
    const dateOnly = parseAccountingDateInput(value);
    if (dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      return accountingCivilMidnight(dateOnly);
    }
    return validDate(new Date(value));
  }
  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      try {
        return validDate(value.toDate());
      } catch {
        return null;
      }
    }
    const seconds = value.seconds ?? value._seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      return validDate(new Date(seconds * 1000));
    }
  }
  return null;
}

export function orderCreatedDate(order: AccountingOrderDateLike) {
  return parseAccountingInstant(order.createdAt);
}

export function orderReceivableDate(order: AccountingOrderDateLike) {
  return orderCreatedDate(order);
}

export function orderPaymentDate(
  order: AccountingOrderDateLike,
): AccountingDateResolution {
  const confirmed = parseAccountingInstant(order.paymentConfirmedAt);
  if (confirmed) {
    return { date: confirmed, quality: "exact", source: "paymentConfirmedAt" };
  }
  const paid = parseAccountingInstant(order.paidAt);
  if (paid) {
    return { date: paid, quality: "legacy_explicit", source: "paidAt" };
  }
  const updated = parseAccountingInstant(order.updatedAt);
  if (updated) {
    return { date: updated, quality: "legacy_estimated", source: "updatedAt" };
  }
  const created = orderCreatedDate(order);
  if (created) {
    return { date: created, quality: "legacy_estimated", source: "createdAt" };
  }
  return { date: null, quality: "missing", source: "missing" };
}

export function supplierPurchaseAccountingDate(
  purchase: AccountingSupplierPurchaseDateLike,
): AccountingDateResolution {
  const validated = parseAccountingInstant(purchase.validatedAt);
  if (validated) {
    return { date: validated, quality: "exact", source: "validatedAt" };
  }
  const invoice = parseAccountingInstant(purchase.invoiceDate);
  if (invoice) {
    return { date: invoice, quality: "legacy_estimated", source: "invoiceDate" };
  }
  return { date: null, quality: "missing", source: "missing" };
}

export function currentAccountingPeriodRange(
  kind: AccountingPeriodFilter,
  customStart?: string,
  customEnd?: string,
  now = new Date(),
): AccountingPeriodRange {
  const today = accountingCivilDate(now);
  if (kind === "custom") {
    return customAccountingPeriodRange(customStart, customEnd);
  }
  if (kind === "year") {
    return accountingPeriodFromCivilDates(
      kind,
      { year: today.year, month: 1, day: 1 },
      { year: today.year + 1, month: 1, day: 1 },
    );
  }
  if (kind === "month") {
    return accountingPeriodFromCivilDates(
      kind,
      { year: today.year, month: today.month, day: 1 },
      shiftCivilMonths({ year: today.year, month: today.month, day: 1 }, 1),
    );
  }
  const weekday = accountingIsoWeekday(today);
  const weekStart = addAccountingCivilDays(today, 1 - weekday);
  return accountingPeriodFromCivilDates(
    kind,
    weekStart,
    addAccountingCivilDays(weekStart, 7),
  );
}

export function customAccountingPeriodRange(
  startValue?: string,
  endValue?: string,
): AccountingPeriodRange {
  const start = parseAccountingDateInput(startValue);
  const endInclusive = parseAccountingDateInput(endValue);
  if (!start || !endInclusive) {
    throw new Error("Renseignez des dates de début et de fin valides.");
  }
  if (compareAccountingCivilDates(endInclusive, start) < 0) {
    throw new Error("La date de fin doit être postérieure ou égale à la date de début.");
  }
  return accountingPeriodFromCivilDates(
    "custom",
    start,
    addAccountingCivilDays(endInclusive, 1),
  );
}

export function previousAccountingPeriodRange(
  range: AccountingPeriodRange,
): AccountingPeriodRange {
  if (range.kind === "year") {
    return accountingPeriodFromCivilDates(
      "year",
      { year: range.civilStart.year - 1, month: 1, day: 1 },
      { year: range.civilStart.year, month: 1, day: 1 },
    );
  }
  if (range.kind === "month") {
    const start = shiftCivilMonths(range.civilStart, -1);
    return accountingPeriodFromCivilDates("month", start, range.civilStart);
  }
  if (range.kind === "week") {
    const start = addAccountingCivilDays(range.civilStart, -7);
    return accountingPeriodFromCivilDates("week", start, range.civilStart);
  }
  const dayCount = accountingCivilDayDifference(
    range.civilStart,
    range.civilEndExclusive,
  );
  const start = addAccountingCivilDays(range.civilStart, -dayCount);
  return accountingPeriodFromCivilDates("custom", start, range.civilStart);
}

export function accountingDateInPeriod(
  value: Date | null,
  range: AccountingPeriodRange,
) {
  return Boolean(value && value >= range.start && value < range.end);
}

export function formatAccountingPeriodLabel(range: AccountingPeriodRange) {
  const inclusiveEnd = addAccountingCivilDays(range.civilEndExclusive, -1);
  return `${formatAccountingCivilDate(range.civilStart)} – ${formatAccountingCivilDate(inclusiveEnd)} · ${ACCOUNTING_TIME_ZONE}`;
}

export function toAccountingDateInputValue(date = new Date()) {
  const civil = accountingCivilDate(date);
  return `${civil.year}-${pad(civil.month)}-${pad(civil.day)}`;
}

export function parseAccountingDateInput(value?: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const civil = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  return validAccountingCivilDate(civil) ? civil : null;
}

export function accountingCivilDate(date: Date): AccountingCivilDate {
  const parts = zonedDateTimeParts(date);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function accountingPeriodFromCivilDates(
  kind: AccountingPeriodFilter,
  civilStart: AccountingCivilDate,
  civilEndExclusive: AccountingCivilDate,
): AccountingPeriodRange {
  return {
    kind,
    start: accountingCivilMidnight(civilStart),
    end: accountingCivilMidnight(civilEndExclusive),
    civilStart,
    civilEndExclusive,
  };
}

function accountingCivilMidnight(civil: AccountingCivilDate) {
  const targetUtc = Date.UTC(civil.year, civil.month - 1, civil.day, 0, 0, 0);
  let candidate = targetUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = zonedDateTimeParts(new Date(candidate));
    const observedUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const adjustment = targetUtc - observedUtc;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(candidate);
}

function zonedDateTimeParts(date: Date) {
  const values = new Map(
    zonedDateTimeFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.get("year") || 0,
    month: values.get("month") || 0,
    day: values.get("day") || 0,
    hour: values.get("hour") || 0,
    minute: values.get("minute") || 0,
    second: values.get("second") || 0,
  };
}

function accountingIsoWeekday(civil: AccountingCivilDate) {
  const day = new Date(Date.UTC(civil.year, civil.month - 1, civil.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

function addAccountingCivilDays(civil: AccountingCivilDate, amount: number) {
  return accountingCivilDateFromUtc(
    new Date(Date.UTC(civil.year, civil.month - 1, civil.day + amount)),
  );
}

function shiftCivilMonths(civil: AccountingCivilDate, amount: number) {
  return accountingCivilDateFromUtc(
    new Date(Date.UTC(civil.year, civil.month - 1 + amount, civil.day)),
  );
}

function accountingCivilDateFromUtc(date: Date): AccountingCivilDate {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function accountingCivilDayDifference(
  start: AccountingCivilDate,
  end: AccountingCivilDate,
) {
  return Math.round(
    (Date.UTC(end.year, end.month - 1, end.day) -
      Date.UTC(start.year, start.month - 1, start.day)) /
      86_400_000,
  );
}

function compareAccountingCivilDates(
  left: AccountingCivilDate,
  right: AccountingCivilDate,
) {
  return (
    Date.UTC(left.year, left.month - 1, left.day) -
    Date.UTC(right.year, right.month - 1, right.day)
  );
}

function validAccountingCivilDate(civil: AccountingCivilDate) {
  const normalized = accountingCivilDateFromUtc(
    new Date(Date.UTC(civil.year, civil.month - 1, civil.day)),
  );
  return (
    normalized.year === civil.year &&
    normalized.month === civil.month &&
    normalized.day === civil.day
  );
}

function validDate(date: Date) {
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatAccountingCivilDate(civil: AccountingCivilDate) {
  return `${pad(civil.day)}/${pad(civil.month)}/${civil.year}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
