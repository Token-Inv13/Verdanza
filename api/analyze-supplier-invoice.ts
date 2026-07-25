import { assertAdminUser } from "./_server/adminAuth.js";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  assertMethod,
  readRawBody,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import { analyzeSupplierInvoicePdfBuffer } from "./_server/supplierInvoiceAnalysis.js";

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "POST")) return;

  try {
    const idToken = bearerToken(request);
    if (!idToken) {
      sendJson(response, { error: "Token admin requis." }, 401);
      return;
    }
    const contentType = String(request.headers["content-type"] || "");
    if (!contentType.includes("application/pdf")) {
      sendJson(response, { error: "Fichier PDF requis." }, 400);
      return;
    }

    const db = getAdminDb();
    await assertAdminUser(db, idToken);
    const buffer = await pdfBufferFromRequest(request);
    const result = await analyzeSupplierInvoicePdfBuffer(db, buffer);
    sendJson(response, result);
  } catch (error) {
    console.error("analyze-supplier-invoice failed", publicError(error));
    sendJson(response, { error: publicError(error) }, 400);
  }
}

async function pdfBufferFromRequest(request: VercelRequestLike) {
  if (Buffer.isBuffer(request.body)) return request.body;
  if (request.body instanceof Uint8Array) return Buffer.from(request.body);
  if (typeof request.body === "string") return Buffer.from(request.body, "binary");
  return readRawBody(request);
}

function bearerToken(request: VercelRequestLike) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length);
}

function publicError(error: unknown) {
  return error instanceof Error ? error.message : "Erreur technique d'extraction PDF.";
}
