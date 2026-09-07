const DATETIME_LOCAL_SECOND = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

export function cagnotteRefundDateTimeLocalValue(now: Date = new Date()): string {
  if (!Number.isFinite(now.valueOf())) throw new Error("Date locale invalide.");
  return [
    String(now.getFullYear()).padStart(4, "0"),
    "-",
    String(now.getMonth() + 1).padStart(2, "0"),
    "-",
    String(now.getDate()).padStart(2, "0"),
    "T",
    String(now.getHours()).padStart(2, "0"),
    ":",
    String(now.getMinutes()).padStart(2, "0"),
    ":",
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
}

export function cagnotteRefundDateTimeLocalToIso(value: string): string {
  const match = DATETIME_LOCAL_SECOND.exec(value);
  if (!match) throw new Error("Date de confirmation invalide.");
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), 0);
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day) ||
    date.getHours() !== Number(hour) ||
    date.getMinutes() !== Number(minute) ||
    date.getSeconds() !== Number(second)
  ) {
    throw new Error("Date de confirmation invalide.");
  }
  return date.toISOString();
}
