import { sendContactMessageEmail } from "./_server/email.js";
import {
  assertMethod,
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

type ContactBody = {
  name?: string;
  email?: string;
  phone?: string;
  subject?: string;
  message?: string;
  company?: string;
  submissionSecurity?: PublicSubmissionSecurityContext;
};

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "POST")) return;

  try {
    const body = parseBody(request.body);
    if (body.company) {
      sendJson(response, { ok: true, skipped: true });
      return;
    }

    const payload = validateContactBody(body);
    const trap = assessPublicSubmissionTrap({ context: body.submissionSecurity });
    if (trap) {
      sendPublicSubmissionTrapResponse(response, "/api/contact", false, trap);
      return;
    }
    const rateLimit = await enforcePublicSubmissionRateLimit({
      route: "/api/contact",
      request,
      email: payload.email,
      anonymousId: body.submissionSecurity?.anonymousId,
      authenticated: false,
    });
    if (!rateLimit.allowed) {
      sendPublicRateLimitResponse(response, rateLimit);
      return;
    }
    const result = await sendContactMessageEmail(payload);

    if (result.status === "failed") {
      sendJson(response, { error: "Message non envoye pour le moment." }, 502);
      return;
    }

    sendJson(response, { ok: true, status: result.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Message contact invalide.";
    sendJson(response, { error: message }, 400);
  }
}

function parseBody(value: unknown): ContactBody {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("Payload invalide.");
  return body as ContactBody;
}

function validateContactBody(body: ContactBody) {
  const name = clean(body.name);
  const email = clean(body.email);
  const phone = clean(body.phone);
  const subject = clean(body.subject);
  const message = clean(body.message);

  if (name.length < 2) throw new Error("Nom requis.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Email invalide.");
  }
  if (subject.length < 3) throw new Error("Sujet requis.");
  if (message.length < 10) throw new Error("Message trop court.");
  if (message.length > 3000) throw new Error("Message trop long.");

  return {
    name,
    email,
    phone: phone || undefined,
    subject,
    message,
  };
}

function clean(value?: string) {
  return String(value || "").trim();
}
