import { assertAdminUser, verifyFirebaseIdToken } from "./adminAuth.js";
import { getAdminDb } from "./firebaseAdmin.js";
import { assertMethod, sendJson, type VercelRequestLike, type VercelResponseLike } from "./http.js";
import { executeOrderRefund, parseOrderRefundRequest, ORDER_REFUNDS_ENABLED, OrderRefundError } from "./orderRefunds.js";
import { CagnotteLedgerError } from "./cagnotteLedger.js";
import { CagnotteReservationError } from "./cagnotteReservations.js";

type Service = Parameters<typeof executeOrderRefund>[0];
export function createOrderRefundHandler(dependencies: {
  enabled: boolean; getDb: () => Service["db"]; verifyToken: typeof verifyFirebaseIdToken; now?: () => string;
}) {
  return async function handler(request: VercelRequestLike, response: VercelResponseLike) {
    if (assertMethod(request, response, "POST")) return;
    if (dependencies.enabled !== true) return sendJson(response, { code: "order_refunds_disabled", error: "Enregistrement des remboursements désactivé." }, 503);
    try {
      let raw: unknown;
      try { raw = typeof request.body === "string" ? JSON.parse(request.body) : request.body; }
      catch { throw new OrderRefundError("refund_payload_invalid", 400); }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new OrderRefundError("refund_payload_invalid", 400);
      const bearer = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7).trim() : "";
      const token = (raw as Record<string, unknown>).authToken ?? bearer;
      if (typeof token !== "string" || !token) return sendJson(response, { code: "admin_token_required", error: "Token admin requis." }, 401);
      const db = dependencies.getDb();
      const actor = await assertAdminUser(db, token, dependencies.verifyToken);
      const result = await executeOrderRefund({ db, actor: { uid: actor.uid, email: actor.email }, request: parseOrderRefundRequest(raw), now: dependencies.now });
      sendJson(response, { ok: true, result, bankingOperationExecuted: false, bankingTransferVerified: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const auth = ["Token Firebase invalide.", "INVALID_ID_TOKEN", "TOKEN_EXPIRED", "USER_NOT_FOUND"].includes(message);
      const cagnotteConflict = error instanceof CagnotteLedgerError || error instanceof CagnotteReservationError;
      const status = error instanceof OrderRefundError ? error.status : message === "Acces admin requis." ? 403 : auth ? 401 : cagnotteConflict ? 409 : error instanceof RangeError ? 400 : 500;
      const code = error instanceof OrderRefundError ? error.code : message === "Acces admin requis." ? "admin_required" : auth ? "admin_token_invalid" : cagnotteConflict ? "refund_ledger_requires_verification" : error instanceof RangeError ? "refund_validation_failed" : "refund_registration_unavailable";
      sendJson(response, { code, error: status === 409 ? "Enregistrement non confirmé : vérification ou nouvelle prévisualisation nécessaire." : "Demande d’enregistrement refusée.",
        bankingOperationExecuted: false, bankingTransferVerified: false }, status);
    }
  };
}
export const handleOrderRefund = createOrderRefundHandler({ enabled: ORDER_REFUNDS_ENABLED, getDb: getAdminDb, verifyToken: verifyFirebaseIdToken });
