const storageKey = "verdanza:analytics:pending-order-revocations";
const maxEntries = 10;
const retentionMs = 30 * 24 * 60 * 60 * 1000;

type PendingOrderAnalyticsRevocation = {
  orderId: string;
  token: string;
  createdAt: string;
};

export function rememberPendingOrderAnalyticsRevocation(orderId: string, token?: string) {
  if (typeof window === "undefined" || !orderId || !token) return;
  const entries = readEntries().filter((entry) => entry.orderId !== orderId);
  entries.unshift({ orderId, token, createdAt: new Date().toISOString() });
  writeEntries(entries.slice(0, maxEntries));
}

export async function revokePendingOrderAnalytics() {
  if (typeof window === "undefined") return;
  const entries = readEntries();
  if (!entries.length) return;

  const retained: PendingOrderAnalyticsRevocation[] = [];
  await Promise.all(
    entries.map(async (entry) => {
      try {
        const response = await fetch("/api/revoke-order-analytics", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orderId: entry.orderId, token: entry.token }),
        });
        if (!response.ok) retained.push(entry);
      } catch {
        retained.push(entry);
      }
    }),
  );
  writeEntries(retained);
}

function readEntries() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - retentionMs;
    return parsed.filter((entry): entry is PendingOrderAnalyticsRevocation => {
      if (!entry || typeof entry !== "object") return false;
      const value = entry as PendingOrderAnalyticsRevocation;
      return (
        typeof value.orderId === "string" &&
        typeof value.token === "string" &&
        typeof value.createdAt === "string" &&
        Date.parse(value.createdAt) >= cutoff
      );
    });
  } catch {
    return [];
  }
}

function writeEntries(entries: PendingOrderAnalyticsRevocation[]) {
  if (!entries.length) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(entries));
}
