import { handleAdminPaymentLinks } from "./_server/adminPaymentLinksRoute.js";
import {
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import { handleSendPaymentLink } from "./_server/sendPaymentLinkRoute.js";

export type PaymentLinksRoute = "list" | "send";

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  const route = resolvePaymentLinksRoute(request.url);
  if (route === "list") return handleAdminPaymentLinks(request, response);
  if (route === "send") return handleSendPaymentLink(request, response);
  sendJson(response, { error: "Route liens de paiement introuvable." }, 404);
}

export function resolvePaymentLinksRoute(
  url: string | undefined,
): PaymentLinksRoute | null {
  const parsed = new URL(url || "/", "https://verdanza.local");
  if (parsed.pathname === "/api/admin-payment-links") return "list";
  if (parsed.pathname === "/api/send-payment-link") return "send";
  if (parsed.pathname !== "/api/payment-links") return null;
  const route = parsed.searchParams.get("__verdanzaRoute");
  return route === "list" || route === "send" ? route : null;
}
