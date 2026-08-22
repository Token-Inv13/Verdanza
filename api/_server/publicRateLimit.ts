import crypto from "node:crypto";
import { isIP } from "node:net";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "./firebaseAdmin.js";
import {
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./http.js";

export const publicRateLimitsCollection = "securityRateLimits";

export type PublicSubmissionRoute =
  | "/api/create-order"
  | "/api/contact"
  | "/api/contests";
export type PublicRateLimitSignalType = "network" | "email" | "anonymous";

type PublicRateLimitRule = {
  signal: PublicRateLimitSignalType;
  windowId: string;
  windowMs: number;
  maximum: number;
};

export const publicRateLimitRules: Record<
  PublicSubmissionRoute,
  readonly PublicRateLimitRule[]
> = {
  "/api/create-order": [
    { signal: "network", windowId: "10m", windowMs: 10 * 60_000, maximum: 5 },
    { signal: "network", windowId: "24h", windowMs: 24 * 60 * 60_000, maximum: 20 },
    { signal: "email", windowId: "30m", windowMs: 30 * 60_000, maximum: 3 },
    { signal: "email", windowId: "24h", windowMs: 24 * 60 * 60_000, maximum: 8 },
    { signal: "anonymous", windowId: "30m", windowMs: 30 * 60_000, maximum: 4 },
    { signal: "anonymous", windowId: "24h", windowMs: 24 * 60 * 60_000, maximum: 10 },
  ],
  "/api/contact": [
    { signal: "network", windowId: "15m", windowMs: 15 * 60_000, maximum: 6 },
    { signal: "network", windowId: "24h", windowMs: 24 * 60 * 60_000, maximum: 20 },
    { signal: "email", windowId: "1h", windowMs: 60 * 60_000, maximum: 3 },
    { signal: "email", windowId: "24h", windowMs: 24 * 60 * 60_000, maximum: 6 },
    { signal: "anonymous", windowId: "1h", windowMs: 60 * 60_000, maximum: 4 },
    { signal: "anonymous", windowId: "24h", windowMs: 24 * 60 * 60_000, maximum: 8 },
  ],
  "/api/contests": [
    { signal: "network", windowId: "10m", windowMs: 10 * 60_000, maximum: 20 },
    { signal: "network", windowId: "24h", windowMs: 24 * 60 * 60_000, maximum: 100 },
    { signal: "email", windowId: "1h", windowMs: 60 * 60_000, maximum: 3 },
    { signal: "email", windowId: "24h", windowMs: 24 * 60 * 60_000, maximum: 6 },
    { signal: "anonymous", windowId: "1h", windowMs: 60 * 60_000, maximum: 8 },
    { signal: "anonymous", windowId: "24h", windowMs: 24 * 60 * 60_000, maximum: 20 },
  ],
};

export type PublicSubmissionSecurityContext = {
  anonymousId?: string;
  formStartedAt?: number;
};

export type PublicRateLimitResult = {
  allowed: boolean;
  code:
    | "allowed"
    | "attempt_retry"
    | "rate_limited"
    | "checkout_request_conflict"
    | "honeypot"
    | "submitted_too_fast"
    | "config_missing"
    | "storage_unavailable"
    | "signal_missing";
  retryAfterSeconds: number;
  failOpen?: boolean;
};

type EnforcePublicRateLimitInput = {
  route: PublicSubmissionRoute;
  request: VercelRequestLike;
  email: string;
  anonymousId?: string;
  authenticated: boolean;
  attemptId?: string;
  attemptPayloadFingerprint?: string;
  nowMs?: number;
  secret?: string;
  db?: FirebaseFirestore.Firestore;
};

type RateLimitSignal = {
  type: PublicRateLimitSignalType;
  value: string;
};

type ResolvedRule = PublicRateLimitRule & {
  ref: FirebaseFirestore.DocumentReference;
  windowStartMs: number;
  windowEndMs: number;
};

const minimumFormDurationMs = 900;
const rateLimitDocumentRetentionMs = 48 * 60 * 60_000;
const attemptDocumentRetentionMs = 48 * 60 * 60_000;
const checkoutRequestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function enforcePublicSubmissionRateLimit(
  input: EnforcePublicRateLimitInput,
): Promise<PublicRateLimitResult> {
  const nowMs = input.nowMs ?? Date.now();
  const secret = input.secret ?? process.env.RATE_LIMIT_HMAC_SECRET;
  if (!secret || secret.length < 32) {
    const result: PublicRateLimitResult = {
      allowed: true,
      code: "config_missing",
      retryAfterSeconds: 0,
      failOpen: true,
    };
    logRateLimit("rate_limit_error", input, result, nowMs);
    return result;
  }

  const signals = collectSignals(input);
  if (!signals.length) {
    const result: PublicRateLimitResult = {
      allowed: true,
      code: "signal_missing",
      retryAfterSeconds: 0,
      failOpen: true,
    };
    logRateLimit("rate_limit_error", input, result, nowMs);
    return result;
  }

  try {
    const db = input.db ?? getAdminDb();
    const rules = resolveRules(db, input.route, signals, secret, nowMs);
    const attemptRef = checkoutAttemptReference(db, input, secret);
    const attemptPayloadToken = input.attemptPayloadFingerprint
      ? hmac(secret, `attempt-payload:${input.attemptPayloadFingerprint}`)
      : undefined;

    const result = await db.runTransaction(async (transaction) => {
      if (attemptRef && attemptPayloadToken) {
        const attemptSnapshot = await transaction.get(attemptRef);
        if (attemptSnapshot.exists) {
          const existingToken = String(
            attemptSnapshot.data()?.attemptPayloadToken || "",
          );
          if (!safeEqual(existingToken, attemptPayloadToken)) {
            return {
              allowed: false,
              code: "checkout_request_conflict",
              retryAfterSeconds: 0,
            } satisfies PublicRateLimitResult;
          }
          return {
            allowed: true,
            code: "attempt_retry",
            retryAfterSeconds: 0,
          } satisfies PublicRateLimitResult;
        }
      }

      const snapshots: FirebaseFirestore.DocumentSnapshot[] = [];
      for (const rule of rules) {
        snapshots.push(await transaction.get(rule.ref));
      }
      const blockedRules = rules.filter((rule, index) => {
        const count = Number(snapshots[index]?.data()?.count || 0);
        return count >= rule.maximum;
      });
      if (blockedRules.length) {
        const retryAfterSeconds = Math.max(
          1,
          ...blockedRules.map((rule) =>
            Math.ceil((rule.windowEndMs - nowMs) / 1000),
          ),
        );
        return {
          allowed: false,
          code: "rate_limited",
          retryAfterSeconds,
        } satisfies PublicRateLimitResult;
      }

      rules.forEach((rule, index) => {
        const count = Number(snapshots[index]?.data()?.count || 0);
        transaction.set(rule.ref, {
          kind: "counter",
          route: input.route,
          signalType: rule.signal,
          windowId: rule.windowId,
          windowStartedAt: Timestamp.fromMillis(rule.windowStartMs),
          windowEndsAt: Timestamp.fromMillis(rule.windowEndMs),
          expiresAt: Timestamp.fromMillis(
            rule.windowEndMs + rateLimitDocumentRetentionMs,
          ),
          count: count + 1,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      if (attemptRef && attemptPayloadToken) {
        transaction.set(attemptRef, {
          kind: "attempt",
          route: input.route,
          attemptPayloadToken,
          expiresAt: Timestamp.fromMillis(nowMs + attemptDocumentRetentionMs),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return {
        allowed: true,
        code: "allowed",
        retryAfterSeconds: 0,
      } satisfies PublicRateLimitResult;
    });

    logRateLimit(
      result.allowed ? "rate_limit_allowed" : "rate_limit_blocked",
      input,
      result,
      nowMs,
    );
    return result;
  } catch {
    const result: PublicRateLimitResult = {
      allowed: true,
      code: "storage_unavailable",
      retryAfterSeconds: 0,
      failOpen: true,
    };
    logRateLimit("rate_limit_error", input, result, nowMs);
    return result;
  }
}

export function sendPublicRateLimitResponse(
  response: VercelResponseLike,
  result: PublicRateLimitResult,
) {
  if (result.code === "checkout_request_conflict") {
    sendJson(
      response,
      {
        code: result.code,
        error:
          "Cette tentative ne correspond plus au panier initial. Verifiez vos commandes avant de recommencer.",
      },
      409,
    );
    return;
  }
  response.setHeader("Retry-After", String(Math.max(1, result.retryAfterSeconds)));
  sendJson(
    response,
    {
      code: "public_submission_rate_limited",
      error:
        "Trop de tentatives ont ete recues. Patientez quelques minutes avant de reessayer.",
    },
    429,
  );
}

export function sendPublicSubmissionTrapResponse(
  response: VercelResponseLike,
  route: PublicSubmissionRoute,
  authenticated: boolean,
  trap: "honeypot" | "submitted_too_fast",
) {
  const result: PublicRateLimitResult = {
    allowed: false,
    code: trap,
    retryAfterSeconds: 60,
  };
  logRateLimit("rate_limit_blocked", { route, authenticated }, result, Date.now());
  sendPublicRateLimitResponse(response, result);
}

export function extractTrustedClientIp(
  request: VercelRequestLike,
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (environment.VERCEL === "1") {
    const forwarded = firstHeaderValue(request.headers["x-forwarded-for"]);
    const candidate = forwarded?.split(",")[0]?.trim();
    return candidate && isIP(candidate) ? candidate : undefined;
  }
  const localAddress = request.socket?.remoteAddress?.trim();
  return localAddress && isIP(localAddress) ? localAddress : undefined;
}

export function normalizeRateLimitEmail(value: string) {
  return String(value || "").normalize("NFKC").trim().toLowerCase();
}

export function assessPublicSubmissionTrap(input: {
  honeypot?: string;
  context?: PublicSubmissionSecurityContext;
  nowMs?: number;
}) {
  if (String(input.honeypot || "").trim()) return "honeypot" as const;
  const startedAt = Number(input.context?.formStartedAt || 0);
  const nowMs = input.nowMs ?? Date.now();
  if (
    Number.isFinite(startedAt) &&
    startedAt > 0 &&
    startedAt <= nowMs &&
    nowMs - startedAt < minimumFormDurationMs
  ) {
    return "submitted_too_fast" as const;
  }
  return null;
}

function collectSignals(input: EnforcePublicRateLimitInput): RateLimitSignal[] {
  const signals: RateLimitSignal[] = [];
  const network = extractTrustedClientIp(input.request);
  if (network) signals.push({ type: "network", value: network });
  const email = normalizeRateLimitEmail(input.email);
  if (email) signals.push({ type: "email", value: email });
  const anonymousId = normalizeAnonymousId(input.anonymousId);
  if (anonymousId) signals.push({ type: "anonymous", value: anonymousId });
  return signals;
}

function resolveRules(
  db: FirebaseFirestore.Firestore,
  route: PublicSubmissionRoute,
  signals: RateLimitSignal[],
  secret: string,
  nowMs: number,
): ResolvedRule[] {
  const signalValues = new Map(signals.map((signal) => [signal.type, signal.value]));
  return publicRateLimitRules[route]
    .filter((rule) => signalValues.has(rule.signal))
    .map((rule) => {
      const windowStartMs = Math.floor(nowMs / rule.windowMs) * rule.windowMs;
      const windowEndMs = windowStartMs + rule.windowMs;
      const signalValue = signalValues.get(rule.signal) as string;
      const documentId = hmac(
        secret,
        `counter:${route}:${rule.signal}:${signalValue}:${rule.windowId}:${windowStartMs}`,
      );
      return {
        ...rule,
        ref: db.collection(publicRateLimitsCollection).doc(documentId),
        windowStartMs,
        windowEndMs,
      };
    });
}

function checkoutAttemptReference(
  db: FirebaseFirestore.Firestore,
  input: EnforcePublicRateLimitInput,
  secret: string,
) {
  if (
    input.route !== "/api/create-order" ||
    !input.attemptId ||
    !checkoutRequestIdPattern.test(input.attemptId)
  ) {
    return undefined;
  }
  return db
    .collection(publicRateLimitsCollection)
    .doc(hmac(secret, `attempt:${input.route}:${input.attemptId.toLowerCase()}`));
}

function normalizeAnonymousId(value?: string) {
  const normalized = String(value || "").trim().toLowerCase();
  return checkoutRequestIdPattern.test(normalized) ? normalized : "";
}

function hmac(secret: string, value: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function logRateLimit(
  event: "rate_limit_allowed" | "rate_limit_blocked" | "rate_limit_error",
  input: Pick<EnforcePublicRateLimitInput, "route" | "authenticated">,
  result: PublicRateLimitResult,
  nowMs: number,
) {
  const payload = {
    event,
    route: input.route,
    windows: Array.from(
      new Set(publicRateLimitRules[input.route].map((rule) => rule.windowId)),
    ),
    code: result.code,
    authenticated: input.authenticated,
    timestamp: new Date(nowMs).toISOString(),
  };
  if (event === "rate_limit_error") console.warn(event, payload);
  else console.info(event, payload);
}
