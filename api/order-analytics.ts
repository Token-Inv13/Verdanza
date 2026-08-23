import {
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import { handleRetryPurchaseAnalytics } from "./_server/retryPurchaseAnalyticsRoute.js";
import { handleRevokeOrderAnalytics } from "./_server/revokeOrderAnalyticsRoute.js";

export type OrderAnalyticsRoute = "retry-purchase" | "revoke";

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  const route = resolveOrderAnalyticsRoute(request.url);
  if (route === "retry-purchase") return handleRetryPurchaseAnalytics(request, response);
  if (route === "revoke") return handleRevokeOrderAnalytics(request, response);
  sendJson(response, { error: "Route analytics introuvable." }, 404);
}

export function resolveOrderAnalyticsRoute(
  url: string | undefined,
): OrderAnalyticsRoute | null {
  const parsed = new URL(url || "/", "https://verdanza.local");
  if (parsed.pathname === "/api/retry-order-purchase-analytics") return "retry-purchase";
  if (parsed.pathname === "/api/revoke-order-analytics") return "revoke";
  if (parsed.pathname !== "/api/order-analytics") return null;
  const route = parsed.searchParams.get("__verdanzaRoute");
  return route === "retry-purchase" || route === "revoke" ? route : null;
}
