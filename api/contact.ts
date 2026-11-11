import { sendContactMessageEmail, sendWithdrawalReceiptEmail } from "./_server/email.js";
import { receiveWithdrawal, validateWithdrawalBody } from "./_server/withdrawal.js";
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
  withdrawal?: unknown;
};

type ContactServices = {
  sendContactMessageEmail: typeof sendContactMessageEmail;
  sendWithdrawalReceiptEmail: typeof sendWithdrawalReceiptEmail;
  enforcePublicSubmissionRateLimit: typeof enforcePublicSubmissionRateLimit;
};

export function createContactHandler(services: Partial<ContactServices> = {}) {
  const dependencies = { sendContactMessageEmail, sendWithdrawalReceiptEmail, enforcePublicSubmissionRateLimit, ...services };
  return (request: VercelRequestLike, response: VercelResponseLike) => handleContact(request, response, dependencies);
}

async function handleContact(
  request: VercelRequestLike,
  response: VercelResponseLike,
  dependencies: ContactServices,
) {
  if (assertMethod(request, response, "POST")) return;
  response.setHeader("Cache-Control", "no-store");

  try {
    const body = parseBody(request.body);
    if (body.company) {
      sendJson(response, { ok: true, skipped: true });
      return;
    }

    const withdrawal = body.withdrawal === undefined ? undefined : validateWithdrawalBody(body.withdrawal);
    const payload = withdrawal ?? validateContactBody(body);
    const trap = assessPublicSubmissionTrap({ context: body.submissionSecurity });
    if (trap) {
      sendPublicSubmissionTrapResponse(response, "/api/contact", false, trap);
      return;
    }
    const rateLimit = await dependencies.enforcePublicSubmissionRateLimit({
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
    if (withdrawal) {
      try {
        const result = await receiveWithdrawal(withdrawal, {
          notifyMerchant: (receipt) => dependencies.sendContactMessageEmail({
            name: receipt.name, email: receipt.email,
            subject: `Rétractation — ${receipt.id}`, message: receipt.text,
          }),
          acknowledgeCustomer: dependencies.sendWithdrawalReceiptEmail,
        });
        sendJson(response, result);
      } catch {
        sendJson(response, { error: "Déclaration non transmise. Réessayez ou écrivez à contact@verdanza.fr." }, 502);
      }
      return;
    }
    const result = await dependencies.sendContactMessageEmail(validateContactBody(body));

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

export default createContactHandler();

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
