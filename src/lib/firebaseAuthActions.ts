export const firebaseAuthActionCodeSettings = {
  url: "https://verdanza.fr/connexion",
  handleCodeInApp: false,
} as const;

export type FirebaseAuthActionMode = "resetPassword" | "verifyEmail" | "recoverEmail";

export type FirebaseAuthActionRequest = {
  mode: FirebaseAuthActionMode;
  oobCode: string;
  continuePath: string | null;
  lang: string | null;
};

export type FirebaseAuthActionParseResult =
  | { ok: true; request: FirebaseAuthActionRequest }
  | { ok: false; reason: "missing-code" | "unsupported-mode" };

export type FirebaseAuthActionApi<AuthType = unknown> = {
  verifyPasswordResetCode: (auth: AuthType, code: string) => Promise<string>;
  confirmPasswordReset: (auth: AuthType, code: string, password: string) => Promise<void>;
  applyActionCode: (auth: AuthType, code: string) => Promise<void>;
  checkActionCode: (auth: AuthType, code: string) => Promise<unknown>;
};

export type FirebaseAuthActionPreparation = "password-form" | "completed";

const supportedModes = new Set<FirebaseAuthActionMode>([
  "resetPassword",
  "verifyEmail",
  "recoverEmail",
]);

export function parseFirebaseAuthAction(search: string): FirebaseAuthActionParseResult {
  const params = new URLSearchParams(search);
  const mode = params.get("mode");
  const oobCode = params.get("oobCode")?.trim() || "";

  if (!mode || !supportedModes.has(mode as FirebaseAuthActionMode)) {
    return { ok: false, reason: "unsupported-mode" };
  }
  if (!oobCode) return { ok: false, reason: "missing-code" };

  return {
    ok: true,
    request: {
      mode: mode as FirebaseAuthActionMode,
      oobCode,
      continuePath: safeVerdanzaContinuePath(params.get("continueUrl")),
      lang: normalizeLanguage(params.get("lang")),
    },
  };
}

export function safeVerdanzaContinuePath(rawUrl: string | null) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl, "https://verdanza.fr");
    if (
      url.protocol !== "https:" ||
      url.origin !== "https://verdanza.fr" ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return null;
  }
}

export async function prepareFirebaseAuthAction<AuthType>(
  auth: AuthType,
  request: FirebaseAuthActionRequest,
  api: FirebaseAuthActionApi<AuthType>,
): Promise<FirebaseAuthActionPreparation> {
  if (request.mode === "resetPassword") {
    await api.verifyPasswordResetCode(auth, request.oobCode);
    return "password-form";
  }

  if (request.mode === "recoverEmail") {
    await api.checkActionCode(auth, request.oobCode);
  }

  await api.applyActionCode(auth, request.oobCode);
  return "completed";
}

export async function confirmFirebasePasswordReset<AuthType>(
  auth: AuthType,
  request: FirebaseAuthActionRequest,
  password: string,
  api: FirebaseAuthActionApi<AuthType>,
) {
  if (request.mode !== "resetPassword") {
    throw new Error("Unsupported password reset action.");
  }
  await api.confirmPasswordReset(auth, request.oobCode, password);
}

export type FirebaseAuthActionErrorKind = "expired" | "invalid" | "network" | "generic";

export function classifyFirebaseAuthActionError(error: unknown): FirebaseAuthActionErrorKind {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";

  if (code === "auth/expired-action-code") return "expired";
  if (
    code === "auth/invalid-action-code" ||
    code === "auth/user-disabled" ||
    code === "auth/user-not-found"
  ) {
    return "invalid";
  }
  if (code === "auth/network-request-failed" || code === "auth/too-many-requests") {
    return "network";
  }
  return "generic";
}

function normalizeLanguage(lang: string | null) {
  if (!lang) return null;
  const normalized = lang.trim().toLowerCase();
  return normalized === "fr" || normalized.startsWith("fr-") ? "fr" : null;
}
