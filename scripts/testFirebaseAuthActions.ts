import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyFirebaseAuthActionError,
  confirmFirebasePasswordReset,
  firebaseAuthActionCodeSettings,
  parseFirebaseAuthAction,
  prepareFirebaseAuthAction,
  safeVerdanzaContinuePath,
  type FirebaseAuthActionApi,
  type FirebaseAuthActionMode,
} from "../src/lib/firebaseAuthActions";
import { sitemapUrls } from "./seoRoutes";
import { staticSeoRoutes } from "./seoRoutes";

type Call = { name: string; code: string; password?: string };

function createApi(calls: Call[]): FirebaseAuthActionApi<object> {
  return {
    async verifyPasswordResetCode(_auth, code) {
      calls.push({ name: "verifyPasswordResetCode", code });
      return "masked@example.test";
    },
    async confirmPasswordReset(_auth, code, password) {
      calls.push({ name: "confirmPasswordReset", code, password });
    },
    async applyActionCode(_auth, code) {
      calls.push({ name: "applyActionCode", code });
    },
    async checkActionCode(_auth, code) {
      calls.push({ name: "checkActionCode", code });
      return {};
    },
  };
}

function request(mode: FirebaseAuthActionMode, code = "secret-test-code") {
  const parsed = parseFirebaseAuthAction(`?mode=${mode}&oobCode=${code}&lang=fr`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("Expected a valid action request.");
  return parsed.request;
}

async function main() {
  assert.deepEqual(firebaseAuthActionCodeSettings, {
    url: "https://verdanza.fr/connexion",
    handleCodeInApp: false,
  });
  assert.equal("dynamicLinkDomain" in firebaseAuthActionCodeSettings, false);

  const resetCalls: Call[] = [];
  const resetRequest = request("resetPassword");
  assert.equal(await prepareFirebaseAuthAction({}, resetRequest, createApi(resetCalls)), "password-form");
  await confirmFirebasePasswordReset({}, resetRequest, "mot-de-passe-solide", createApi(resetCalls));
  assert.deepEqual(resetCalls.map((call) => call.name), ["verifyPasswordResetCode", "confirmPasswordReset"]);

  const verifyCalls: Call[] = [];
  assert.equal(await prepareFirebaseAuthAction({}, request("verifyEmail"), createApi(verifyCalls)), "completed");
  assert.deepEqual(verifyCalls.map((call) => call.name), ["applyActionCode"]);

  const recoverCalls: Call[] = [];
  assert.equal(await prepareFirebaseAuthAction({}, request("recoverEmail"), createApi(recoverCalls)), "completed");
  assert.deepEqual(recoverCalls.map((call) => call.name), ["checkActionCode", "applyActionCode"]);

  assert.deepEqual(parseFirebaseAuthAction("?mode=unknown&oobCode=secret"), {
    ok: false,
    reason: "unsupported-mode",
  });
  assert.deepEqual(parseFirebaseAuthAction("?mode=verifyEmail"), {
    ok: false,
    reason: "missing-code",
  });
  assert.equal(safeVerdanzaContinuePath("https://verdanza.fr/connexion?source=email"), "/connexion?source=email");
  assert.equal(safeVerdanzaContinuePath("/compte"), "/compte");
  assert.equal(safeVerdanzaContinuePath("https://evil.example/connexion"), null);
  assert.equal(safeVerdanzaContinuePath("//evil.example/connexion"), null);
  assert.equal(safeVerdanzaContinuePath("https://user:pass@verdanza.fr/connexion"), null);

  assert.equal(classifyFirebaseAuthActionError({ code: "auth/expired-action-code" }), "expired");
  assert.equal(classifyFirebaseAuthActionError({ code: "auth/invalid-action-code" }), "invalid");
  assert.equal(classifyFirebaseAuthActionError({ code: "auth/network-request-failed" }), "network");

  const route = staticSeoRoutes.find((entry) => entry.path === "/auth/action");
  assert.equal(route?.kind, "public-noindex");
  assert.equal(route?.indexable, false);
  assert.equal(sitemapUrls().includes("https://verdanza.fr/auth/action"), false);

  const appSource = readFileSync(resolve("src/App.tsx"), "utf8");
  const analyticsSource = readFileSync(resolve("src/lib/googleTagManager.ts"), "utf8");
  const pageSource = readFileSync(resolve("src/pages/FirebaseAuthActionPage.tsx"), "utf8");
  assert.match(appSource, /path="\/auth\/action" element={<FirebaseAuthActionPage \/>}/);
  assert.match(analyticsSource, /\\\/auth\\\/action/);
  assert.doesNotMatch(pageSource, /console\.(?:log|info|warn|error)/);
  assert.doesNotMatch(pageSource, /dataLayer|gtag\s*\(/);
  assert.match(pageSource, /history\.replaceState\(\{\}, "", "\/auth\/action"\)/);

  const prerenderedPath = resolve("dist/auth/action/index.html");
  if (existsSync(prerenderedPath)) {
    const html = readFileSync(prerenderedPath, "utf8");
    assert.match(html, /noindex,nofollow/);
    assert.doesNotMatch(html, /secret-test-code|oobCode=|apiKey=|continueUrl=/i);
    assert.doesNotMatch(html, /Accès réservé aux majeurs/i);
  }

  console.log("Firebase Auth action tests passed.");
}

await main();
