import assert from "node:assert/strict";
import { createContactHandler } from "../api/contact";
import type { EmailResult } from "../api/_server/email";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http";

let notification: EmailResult = { status: "sent", id: "fixture-merchant" };
let acknowledgement: EmailResult = { status: "sent", id: "fixture-customer" };
let allowed = true;
const messages: Array<{ name: string; email: string; message: string; subject: string }> = [];
const receipts: Array<{ email: string; text: string }> = [];
const handler = createContactHandler({
  sendContactMessageEmail: async (message) => { messages.push(message); return notification; },
  sendWithdrawalReceiptEmail: async (receipt) => { receipts.push(receipt); return acknowledgement; },
  enforcePublicSubmissionRateLimit: async () => ({ allowed, code: allowed ? "allowed" : "rate_limited", retryAfterSeconds: allowed ? 0 : 60 }),
});
const withdrawal = { confirmed: true, name: "Client Exemple", email: "client@example.test", contract: "Commande TEST-123", items: "" };
const security = { formStartedAt: Date.now() - 10_000 };
async function request(body: unknown, method = "POST") {
  let statusCode = 200;
  let payload: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  const response = {
    status(code: number) { statusCode = code; return this; },
    json(value: Record<string, unknown>) { payload = value; },
    setHeader(name: string, value: string) { headers[name] = value; },
  } as unknown as VercelResponseLike;
  await handler({ method, body, headers: {} } as VercelRequestLike, response);
  return { statusCode, payload, headers };
}
assert.equal((await request({}, "GET")).statusCode, 405);
assert.equal(messages.length, 0);
const normal = { name: "Client Exemple", email: "client@example.test", subject: "Question commande", message: "Un message normal de contact.", submissionSecurity: security };
assert.equal((await request(normal)).payload.status, "sent");
assert.equal(messages[0].message, normal.message);
assert.equal(receipts.length, 0, "regular contact must not send a withdrawal receipt");
const received = await request({ withdrawal, submissionSecurity: security });
assert.equal(received.statusCode, 200);
assert.equal(received.payload.accepted, true);
assert.equal(received.headers["Cache-Control"], "no-store");
assert.equal(receipts.length, 1);
assert.match(messages.at(-1)!.message, /Commande TEST-123/);
assert.match(receipts[0].text, /Date et heure d’envoi/);
assert.equal((await request({ withdrawal: { ...withdrawal, confirmed: false } })).statusCode, 400);
const before = messages.length;
assert.equal((await request({ withdrawal, company: "robot" })).payload.accepted, undefined);
assert.equal((await request({ withdrawal, submissionSecurity: { formStartedAt: Date.now() } })).statusCode, 429);
assert.equal(messages.length, before);
allowed = false;
assert.equal((await request({ withdrawal, submissionSecurity: security })).statusCode, 429);
assert.equal(messages.length, before);
allowed = true;
notification = { status: "skipped", reason: "fixture_no_config" };
const failed = await request({ withdrawal, submissionSecurity: security });
assert.equal(failed.statusCode, 502);
assert.equal(failed.payload.accepted, undefined);
assert.equal(receipts.length, 1, "no receipt before merchant delivery");
notification = { status: "sent" };
acknowledgement = { status: "failed", reason: "fixture_customer_failure" };
const fallback = await request({ withdrawal, submissionSecurity: security });
assert.equal(fallback.payload.accepted, true);
assert.equal(fallback.payload.receiptEmailSent, false);
assert.ok(fallback.payload.receipt);
console.log("PASS withdrawal contact API: method/validation, existing contact, bot/rate protections, no false receipt, customer-email fallback and no-store (all services mocked).");
