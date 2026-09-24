import { assertAdminUser, firebaseAuthHttpFailure, verifyFirebaseIdToken } from "./adminAuth.js";
import { CagnotteReadError, readCagnotte, validatedId } from "./cagnotteRead.js";
import { getAdminDb } from "./firebaseAdmin.js";
import { assertMethod, sendJson, type VercelRequestLike, type VercelResponseLike } from "./http.js";
import {
  cagnotteRuntimeCapabilities,
  CagnotteRuntimeConfigurationError,
  getCagnotteRuntimeConfiguration,
  type CagnotteRuntimeConfiguration,
} from "./cagnotteRuntimeConfig.js";

type ReadService = typeof readCagnotte;

export function createCagnotteReadHandler(dependencies: {
  enabled?: boolean;
  getDb: () => Parameters<ReadService>[0]["db"];
  verifyToken: typeof verifyFirebaseIdToken;
  read: ReadService;
  cursorSecret?: () => string;
  getRuntimeConfiguration?: () => CagnotteRuntimeConfiguration;
  now?: () => number;
  capabilities?: {
    canRequestReservation: boolean;
    canAccrueLoyalty: boolean;
  };
}) {
  return async function handler(request: VercelRequestLike, response: VercelResponseLike) {
    response.setHeader("Cache-Control", "private, no-store");
    if (assertMethod(request, response, "GET")) return;
    let runtimeConfiguration: CagnotteRuntimeConfiguration | undefined;
    try {
      runtimeConfiguration = dependencies.getRuntimeConfiguration?.();
    } catch (error) {
      if (error instanceof CagnotteRuntimeConfigurationError) {
        return sendJson(response, {
          code: "cagnotte_configuration_invalid",
          error: "Configuration cagnotte indisponible.",
        }, 503);
      }
      throw error;
    }
    const enabled = runtimeConfiguration?.readServerEnabled ?? dependencies.enabled === true;
    if (!enabled) {
      return sendJson(response, { code: "cagnotte_read_disabled", error: "Consultation des avantages indisponible." }, 503);
    }
    const cursorSecret = runtimeConfiguration?.readCursorSecret ?? dependencies.cursorSecret?.() ?? "";
    const capabilities = runtimeConfiguration
      ? cagnotteRuntimeCapabilities(runtimeConfiguration, (dependencies.now ?? Date.now)())
      : dependencies.capabilities;
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
        const result = await dependencies.read({ db, beneficiaryId: user.uid, scope: "self", cursor, limit, cursorSecret, capabilities });
        return sendJson(response, result);
      }
      if (scope === "admin") {
        const targets = url.searchParams.getAll("targetUid");
        if (targets.length !== 1) throw new CagnotteReadError("invalid_request", "Un client cible est requis.");
        const targetUid = validatedId(targets[0], "Client cible invalide.");
        const db = dependencies.getDb();
        await assertAdminUser(db, token, dependencies.verifyToken);
        const result = await dependencies.read({ db, beneficiaryId: targetUid, scope: "admin", cursor, limit, cursorSecret, capabilities });
        return sendJson(response, result);
      }
      throw new CagnotteReadError("invalid_request", "Portée de consultation invalide.");
    } catch (error) {
      const authFailure = firebaseAuthHttpFailure(error);
      if (authFailure) return sendJson(response, authFailure.status === 401
        ? { code: "session_expired", error: "Session expirée." }
        : { code: "authentication_unavailable", error: "Authentification indisponible." }, authFailure.status);
      const message = error instanceof Error ? error.message : "";
      if (message === "Acces admin requis.") return sendJson(response, { code: "admin_required", error: "Accès administrateur requis." }, 403);
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
  getDb: getAdminDb,
  verifyToken: verifyFirebaseIdToken,
  read: readCagnotte,
  getRuntimeConfiguration: getCagnotteRuntimeConfiguration,
});
