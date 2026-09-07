import { assertAdminUser, verifyFirebaseIdToken } from "./adminAuth.js";
import { CAGNOTTE_READ_SERVER_ENABLED, CagnotteReadError, readCagnotte, validatedId } from "./cagnotteRead.js";
import { getAdminDb } from "./firebaseAdmin.js";
import { assertMethod, sendJson, type VercelRequestLike, type VercelResponseLike } from "./http.js";
import { CAGNOTTE_RESERVATION_PROGRAM } from "./cagnotteReservations.js";
import { CAGNOTTE_SERVER_PROGRAM } from "./cagnotteProgram.js";

type ReadService = typeof readCagnotte;

export function createCagnotteReadHandler(dependencies: {
  enabled: boolean;
  getDb: () => Parameters<ReadService>[0]["db"];
  verifyToken: typeof verifyFirebaseIdToken;
  read: ReadService;
  cursorSecret: () => string;
  capabilities?: {
    canRequestReservation: boolean;
    canAccrueLoyalty: boolean;
  };
}) {
  return async function handler(request: VercelRequestLike, response: VercelResponseLike) {
    response.setHeader("Cache-Control", "private, no-store");
    if (assertMethod(request, response, "GET")) return;
    if (dependencies.enabled !== true) {
      return sendJson(response, { code: "cagnotte_read_disabled", error: "Consultation des avantages indisponible." }, 503);
    }
    try {
      const token = bearerToken(request);
      if (!token) return sendJson(response, { code: "authentication_required", error: "Connexion requise." }, 401);
      const url = new URL(request.url || "/api/cagnotte", "https://local.invalid");
      const scopes = url.searchParams.getAll("scope");
      const scope = scopes.length === 1 ? scopes[0] : "";
      const cursor = singleOptional(url, "cursor");
      const limitValue = singleOptional(url, "limit");
      const limit = limitValue === undefined ? undefined : Number(limitValue);

      if (scope === "self") {
        if (url.searchParams.has("targetUid")) {
          return sendJson(response, { code: "foreign_account_forbidden", error: "Compte cible interdit pour cette portée." }, 403);
        }
        const user = await dependencies.verifyToken(token);
        const db = dependencies.getDb();
        const result = await dependencies.read({ db, beneficiaryId: user.uid, scope: "self", cursor, limit, cursorSecret: dependencies.cursorSecret(), capabilities: dependencies.capabilities });
        return sendJson(response, result);
      }
      if (scope === "admin") {
        const targets = url.searchParams.getAll("targetUid");
        if (targets.length !== 1) throw new CagnotteReadError("invalid_request", "Un client cible est requis.");
        const targetUid = validatedId(targets[0], "Client cible invalide.");
        const db = dependencies.getDb();
        await assertAdminUser(db, token, dependencies.verifyToken);
        const result = await dependencies.read({ db, beneficiaryId: targetUid, scope: "admin", cursor, limit, cursorSecret: dependencies.cursorSecret(), capabilities: dependencies.capabilities });
        return sendJson(response, result);
      }
      throw new CagnotteReadError("invalid_request", "Portée de consultation invalide.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const authentication = ["Token Firebase invalide.", "INVALID_ID_TOKEN", "TOKEN_EXPIRED", "USER_NOT_FOUND"].includes(message);
      if (message === "Acces admin requis.") return sendJson(response, { code: "admin_required", error: "Accès administrateur requis." }, 403);
      if (authentication) return sendJson(response, { code: "session_expired", error: "Session expirée." }, 401);
      if (error instanceof CagnotteReadError) {
        const status = error.code === "inconsistent_data" ? 409 : error.code === "unavailable" ? 500 : 400;
        return sendJson(response, { code: error.code, error: error.message }, status);
      }
      return sendJson(response, { code: "cagnotte_read_unavailable", error: "Historique indisponible." }, 500);
    }
  };
}

function singleOptional(url: URL, key: string) {
  const values = url.searchParams.getAll(key);
  if (values.length > 1) throw new CagnotteReadError("invalid_request", `Paramètre ${key} dupliqué.`);
  return values[0];
}

function bearerToken(request: VercelRequestLike) {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

export const handleCagnotteRead = createCagnotteReadHandler({
  enabled: CAGNOTTE_READ_SERVER_ENABLED,
  getDb: getAdminDb,
  verifyToken: verifyFirebaseIdToken,
  read: readCagnotte,
  cursorSecret: () => process.env.CAGNOTTE_READ_CURSOR_SECRET ?? "",
  capabilities: {
    canRequestReservation: CAGNOTTE_RESERVATION_PROGRAM !== null,
    canAccrueLoyalty: CAGNOTTE_SERVER_PROGRAM !== null,
  },
});
