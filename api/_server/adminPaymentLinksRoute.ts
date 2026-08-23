import { assertAdminUser } from "./adminAuth.js";
import { activeAdminPaymentLinks } from "./adminPaymentLinks.js";
import { getAdminDb } from "./firebaseAdmin.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./http.js";

export async function handleAdminPaymentLinks(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "GET")) return;

  try {
    const token = bearerToken(request);
    if (!token) {
      sendJson(response, { error: "Token admin requis." }, 401);
      return;
    }

    await assertAdminUser(getAdminDb(), token);
    sendJson(response, { links: activeAdminPaymentLinks() });
  } catch (error) {
    console.error("admin-payment-links failed", error);
    const message = error instanceof Error ? error.message : "Liens paiement indisponibles.";
    sendJson(response, { error: message }, message === "Acces admin requis." ? 403 : 400);
  }
}

function bearerToken(request: VercelRequestLike) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}
