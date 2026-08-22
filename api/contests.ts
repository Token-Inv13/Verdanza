import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  ContestError,
  createContestEntry,
  getPublicContest,
  serializeContestResponse,
} from "./_server/contests.js";
import {
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import {
  assessPublicSubmissionTrap,
  enforcePublicSubmissionRateLimit,
  sendPublicRateLimitResponse,
  sendPublicSubmissionTrapResponse,
  type PublicSubmissionSecurityContext,
} from "./_server/publicRateLimit.js";

type ContestEntryBody = {
  contestId?: string;
  displayName?: string;
  email?: string;
  rulesAccepted?: boolean;
  marketingConsent?: boolean;
  company?: string;
  submissionSecurity?: PublicSubmissionSecurityContext;
};

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (request.method === "GET") {
    response.setHeader("Cache-Control", "no-store");
    try {
      const contest = await getPublicContest(getAdminDb());
      sendJson(response, serializeContestResponse({ contest }));
    } catch (error) {
      console.error("public contest read failed", error);
      sendContestError(response, error, "Concours indisponible pour le moment.");
    }
    return;
  }
  if (request.method !== "POST") {
    sendJson(response, { error: "Methode non autorisee." }, 405);
    return;
  }

  try {
    const body = parseBody(request.body);
    if (String(body.company || "").trim()) {
      sendJson(response, { ok: true, skipped: true });
      return;
    }
    const trap = assessPublicSubmissionTrap({ context: body.submissionSecurity });
    if (trap) {
      sendPublicSubmissionTrapResponse(response, "/api/contests", false, trap);
      return;
    }
    const db = getAdminDb();
    const rateLimit = await enforcePublicSubmissionRateLimit({
      route: "/api/contests",
      request,
      email: String(body.email || ""),
      anonymousId: body.submissionSecurity?.anonymousId,
      authenticated: false,
      db,
    });
    if (!rateLimit.allowed) {
      sendPublicRateLimitResponse(response, rateLimit);
      return;
    }
    const result = await createContestEntry(db, body);
    sendJson(response, result, 201);
  } catch (error) {
    console.error("contest entry failed", error);
    sendContestError(response, error, "Participation impossible pour le moment.");
  }
}

function parseBody(value: unknown): ContestEntryBody {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new ContestError("Participation invalide.");
  return body as ContestEntryBody;
}

function sendContestError(
  response: VercelResponseLike,
  error: unknown,
  fallback: string,
) {
  const contestError = error instanceof ContestError ? error : null;
  sendJson(
    response,
    {
      error: contestError?.message || fallback,
      code: contestError?.code || "contest_unavailable",
    },
    contestError?.statusCode || 500,
  );
}
