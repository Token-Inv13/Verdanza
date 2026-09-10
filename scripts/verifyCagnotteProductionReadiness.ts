import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import cagnotteHandler from "../api/cagnotte.js";
import orderRefundHandler from "../api/order-refunds.js";
import { buildCagnotteOrderEnrollment, prepareOrderCagnotteTransition } from "../api/_server/cagnotteOrders.js";
import { resolveCheckoutRateLimitPolicy } from "../api/_server/checkoutRateLimitPolicy.js";
import { enforcePublicSubmissionRateLimit } from "../api/_server/publicRateLimit.js";
import {
  CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID,
  CAGNOTTE_PRODUCTION_PROGRAM_DEFINITION,
  CAGNOTTE_PRODUCTION_PROGRAM_VERSION,
  CAGNOTTE_SERVER_PROGRAM,
  CagnotteProgramConfigurationError,
  resolveCagnotteProductionProgram,
  resolveCagnotteProductionReservationProgram,
} from "../api/_server/cagnotteProgram.js";
import {
  CAGNOTTE_READ_SERVER_ENABLED,
  readCagnotte,
} from "../api/_server/cagnotteRead.js";
import { createCagnotteReadHandler } from "../api/_server/cagnotteReadRoute.js";
import {
  CAGNOTTE_RESERVATION_PROGRAM,
  createCagnotteReservationIntent,
} from "../api/_server/cagnotteReservations.js";
import { ORDER_REFUNDS_ENABLED } from "../api/_server/orderRefunds.js";
import {
  CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED,
  CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED,
  CAGNOTTE_READ_DISPLAY_ENABLED,
} from "../src/config/cagnotteFeatures.js";

const baseMain = "322f65895fb0a75479c92bc4a3054caa4073d2f8";
const expectedRulesHash = "bfac684e58aff26b20dde1cb65abec49e40fc98a7d64272262e53b35b5f6091e";
const expectedEndpoints = [
  "admin-contests.ts",
  "admin-payment-links.ts",
  "analyze-supplier-invoice.ts",
  "blog-interactions.ts",
  "cagnotte.ts",
  "contact.ts",
  "contest-prize.ts",
  "contests.ts",
  "create-order.ts",
  "create-review.ts",
  "invoices.ts",
  "order-refunds.ts",
  "quote-order.ts",
  "retry-order-emails.ts",
  "retry-order-purchase-analytics.ts",
  "revoke-order-analytics.ts",
  "send-payment-link.ts",
  "update-order-status.ts",
];

class FakeResponse {
  statusCode = 200;
  body: unknown;
  headers = new Map<string, unknown>();

  setHeader(name: string, value: unknown) {
    this.headers.set(name, value);
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(body: unknown) {
    this.body = body;
  }
}

await check("sept gardes normaux fermés", () => {
  assert.equal(CAGNOTTE_SERVER_PROGRAM, null);
  assert.equal(CAGNOTTE_RESERVATION_PROGRAM, null);
  assert.equal(CAGNOTTE_READ_SERVER_ENABLED, false);
  assert.equal(CAGNOTTE_READ_DISPLAY_ENABLED, false);
  assert.equal(CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED, false);
  assert.equal(CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED, false);
  assert.equal(ORDER_REFUNDS_ENABLED, false);
});

await check("contrats Production présents mais définition statique inerte", () => {
  assert.equal(CAGNOTTE_PRODUCTION_PROGRAM_VERSION, "cagnotte-commercial-policy-v1");
  assert.deepEqual(CAGNOTTE_PRODUCTION_PROGRAM_DEFINITION, {
    mode: "production",
    programVersion: "cagnotte-commercial-policy-v1",
    calculationVersion: "cagnotte-math-v1",
  });
  assert.equal(Object.isFrozen(CAGNOTTE_PRODUCTION_PROGRAM_DEFINITION), true);
  assert.equal(Object.hasOwn(CAGNOTTE_PRODUCTION_PROGRAM_DEFINITION, "startsAtEpochMs"), false);
  assert.match(read("api/_server/cagnotteLedgerTypes.ts"), /CagnotteProductionProgram/);
  assert.match(read("api/_server/cagnotteReservationTypes.ts"), /CagnotteReservationProductionProgram/);
});

await check("résolveurs Production purs, fermés hors Production et sur projet divergent", () => {
  const valid = { startsAtEpochMs: 123_000, firebaseProjectId: CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID };
  assert.equal(resolveCagnotteProductionProgram({ runtimeEnvironment: "preview", mode: "off" }), null);
  assert.equal(resolveCagnotteProductionReservationProgram({ runtimeEnvironment: "local", mode: "off" }), null);
  assert.throws(
    () => resolveCagnotteProductionProgram({ runtimeEnvironment: "preview", mode: "accrue", ...valid }),
    CagnotteProgramConfigurationError,
  );
  assert.throws(
    () => resolveCagnotteProductionProgram({ runtimeEnvironment: "production", mode: "accrue", startsAtEpochMs: 123_000, firebaseProjectId: "wrong-project" }),
    CagnotteProgramConfigurationError,
  );
  const drain = resolveCagnotteProductionProgram({ runtimeEnvironment: "production", mode: "drain", ...valid });
  const accrue = resolveCagnotteProductionProgram({ runtimeEnvironment: "production", mode: "accrue", ...valid });
  const reservationDrain = resolveCagnotteProductionReservationProgram({ runtimeEnvironment: "production", mode: "drain", ...valid });
  assert.equal(drain?.newAccrualsEnabled, false);
  assert.equal(accrue?.newAccrualsEnabled, true);
  assert.equal(reservationDrain?.reservationsEnabled, false);
});

await check("aucun mécanisme parallèle d’activation cagnotte", () => {
  const runtimeFiles = [...walk("api"), ...walk("src")]
    .filter((file) => [".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(extname(file)));
  const forbidden = [
    /VITE_[A-Z0-9_]*(?:CAGNOTTE|LOYALTY|ORDER_REFUND)/i,
    /(?:CAGNOTTE|LOYALTY|ORDER_REFUND)[A-Z0-9_]*(?:ENABLED|ACTIVE|BYPASS)\s*=\s*(?:process\.env|import\.meta\.env)/i,
    /x-(?:enable|activate|bypass)-(?:cagnotte|loyalty|refunds?)/i,
    /localStorage\.(?:getItem|setItem)\([^)]*(?:cagnotte|loyalty)/i,
    /NODE_ENV[^\n;]*(?:cagnotte|loyalty|refund)/i,
    /localhost[^\n;]*(?:enable|activate|bypass)[^\n;]*(?:cagnotte|loyalty|refund)/i,
  ];
  const violations = runtimeFiles.flatMap((file) => {
    const source = read(file);
    return forbidden.some((pattern) => pattern.test(source)) ? [file] : [];
  });
  assert.deepEqual(violations, []);

  const activationConstants = runtimeFiles.flatMap((file) =>
    [...read(file).matchAll(/export const ((?:CAGNOTTE|ORDER_REFUNDS)[A-Z0-9_]*(?:ENABLED|PROGRAM))\b/g)]
      .map((match) => match[1]),
  ).sort();
  assert.deepEqual(activationConstants, [
    "CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED",
    "CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED",
    "CAGNOTTE_READ_DISPLAY_ENABLED",
    "CAGNOTTE_READ_SERVER_ENABLED",
    "CAGNOTTE_RESERVATION_PROGRAM",
    "CAGNOTTE_SERVER_PROGRAM",
    "ORDER_REFUNDS_ENABLED",
  ]);

  assert.match(read("api/_server/cagnotteReadRoute.ts"), /enabled:\s*CAGNOTTE_READ_SERVER_ENABLED/);
  assert.match(read("api/_server/orderRefundRoute.ts"), /enabled:\s*ORDER_REFUNDS_ENABLED/);
  assert.match(read("api/create-order.ts"), /reservationProgram:\s*CAGNOTTE_RESERVATION_PROGRAM/);
  assert.match(read("api/create-order.ts"), /accrualProgram:\s*CAGNOTTE_SERVER_PROGRAM/);
  assert.match(read("api/quote-order.ts"), /reservationProgram:\s*CAGNOTTE_RESERVATION_PROGRAM/);
  assert.match(read("api/quote-order.ts"), /accrualProgram:\s*CAGNOTTE_SERVER_PROGRAM/);
});

await check("mode fermé sans écritures cagnotte ni fallback silencieux", async () => {
  assert.equal(buildCagnotteOrderEnrollment({}, undefined, CAGNOTTE_SERVER_PROGRAM), undefined);
  assert.equal(createCagnotteReservationIntent({} as never, CAGNOTTE_RESERVATION_PROGRAM), null);
  const forbiddenDb = new Proxy({}, {
    get() {
      throw new Error("ordinary order attempted a cagnotte collection access");
    },
  });
  const ordinary = await prepareOrderCagnotteTransition({
    db: forbiddenDb as never,
    transaction: forbiddenDb as never,
    order: { id: "ordinary", orderStatus: "pending", paymentStatus: "pending" } as never,
    nextOrderStatus: "processing",
    nextPaymentStatus: "pending",
  });
  assert.equal(ordinary, null);

  const createOrder = read("api/create-order.ts");
  const quoteOrder = read("api/quote-order.ts");
  assert.match(createOrder, /requestedCagnotteCents\s*>\s*0[\s\S]*RESERVATIONS_DISABLED/);
  assert.match(quoteOrder, /requestedCents\s*>\s*0[\s\S]*RESERVATIONS_DISABLED/);
  assert.match(createOrder, /L’utilisation de la cagnotte est désactivée/);
  assert.match(quoteOrder, /L’utilisation de la cagnotte est désactivée/);
});

await check("rate-limit fermé ciblé disponible sans changer le défaut historique", async () => {
  const base = {
    route: "/api/create-order" as const,
    request: { method: "POST", headers: {} },
    email: "",
    authenticated: true,
    secret: "",
  };
  const opened = await enforcePublicSubmissionRateLimit(base);
  const closed = await enforcePublicSubmissionRateLimit({ ...base, failurePolicy: "fail_closed" });
  assert.deepEqual([opened.allowed, opened.code, opened.failOpen], [true, "config_missing", true]);
  assert.deepEqual([closed.allowed, closed.code, closed.failOpen], [false, "config_missing", false]);

  const productionAccrual = resolveCagnotteProductionProgram({
    runtimeEnvironment: "production",
    mode: "accrue",
    startsAtEpochMs: 123_000,
    firebaseProjectId: CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID,
  });
  assert.deepEqual(resolveCheckoutRateLimitPolicy({
    verifiedUid: "synthetic-verified-user",
    requestedCagnotteCents: 0,
    accrualProgram: productionAccrual,
    reservationProgram: null,
    firebaseProjectId: CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID,
    operationNowEpochMs: 123_000,
  }), { failurePolicy: "fail_closed", cagnotteMode: "accrual" });
  assert.equal(CAGNOTTE_SERVER_PROGRAM, null);
  assert.equal(CAGNOTTE_RESERVATION_PROGRAM, null);
});

await check("endpoints fermés avant Firebase, Auth et secret curseur", async () => {
  const previousCursorSecret = process.env.CAGNOTTE_READ_CURSOR_SECRET;
  delete process.env.CAGNOTTE_READ_CURSOR_SECRET;
  try {
    const readResponse = new FakeResponse();
    await cagnotteHandler(request("GET", "/api/cagnotte?scope=self"), readResponse as never);
    assert.equal(readResponse.statusCode, 503);
    assert.deepEqual(readResponse.body, {
      code: "cagnotte_read_disabled",
      error: "Consultation des avantages indisponible.",
    });
    assert.equal(readResponse.headers.get("Cache-Control"), "private, no-store");

    const refundResponse = new FakeResponse();
    await orderRefundHandler(request("POST", "/api/order-refunds", { enabled: true }), refundResponse as never);
    assert.equal(refundResponse.statusCode, 503);
    assert.deepEqual(refundResponse.body, {
      code: "order_refunds_disabled",
      error: "Enregistrement des remboursements désactivé.",
    });
  } finally {
    restoreEnvironment("CAGNOTTE_READ_CURSOR_SECRET", previousCursorSecret);
  }
});

await check("lecture activée sans secret curseur échoue explicitement fermée", async () => {
  for (const cursorSecret of ["", "trop-court"]) {
    const handler = createCagnotteReadHandler({
      enabled: true,
      getDb: () => ({}) as never,
      verifyToken: async () => ({ uid: "synthetic-user", email: null }),
      read: readCagnotte,
      cursorSecret: () => cursorSecret,
    });
    const response = new FakeResponse();
    await handler(request("GET", "/api/cagnotte?scope=self", undefined, "Bearer synthetic"), response as never);
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, {
      code: "unavailable",
      error: "Configuration de curseur indisponible.",
    });
  }
  const routeSource = read("api/_server/cagnotteReadRoute.ts");
  assert.match(routeSource, /process\.env\.CAGNOTTE_READ_CURSOR_SECRET\s*\?\?\s*""/);
  assert.doesNotMatch(routeSource, /CAGNOTTE_READ_CURSOR_SECRET[^\n]*(?:randomBytes|randomUUID)/);
});

await check("18 fonctions API et deux ajouts fidélité seulement", () => {
  const endpoints = readdirSync(resolve("api"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(endpoints, expectedEndpoints);

  const mainEndpoints = git(["ls-tree", "--name-only", `${baseMain}:api`])
    .split(/\r?\n/)
    .filter((file) => file.endsWith(".ts"))
    .sort();
  assert.equal(mainEndpoints.length, 16);
  assert.deepEqual(endpoints.filter((file) => !mainEndpoints.includes(file)), ["cagnotte.ts", "order-refunds.ts"]);
});

await check("packaging statique des endpoints cagnotte sans dépendance de test", () => {
  const forbiddenPackages = new Set(["playwright", "@firebase/rules-unit-testing", "tsx", "vite", "firebase-tools"]);
  for (const entry of ["api/cagnotte.ts", "api/order-refunds.ts"]) {
    const graph = dependencyGraph(entry);
    const forbiddenFiles = [...graph.files].filter((file) =>
      file.startsWith("scripts/") || /(?:^|\/)(?:test|tests|__tests__|recipe|demo)(?:\/|[A-Z_.-])/i.test(file),
    );
    const forbiddenImports = [...graph.packages].filter((name) => forbiddenPackages.has(name));
    assert.deepEqual(forbiddenFiles, [], `${entry}: fichier local de test ou démonstration importé`);
    assert.deepEqual(forbiddenImports, [], `${entry}: dépendance de test importée`);
    const runtimeText = [...graph.files].map(read).join("\n");
    assert.doesNotMatch(runtimeText, /FIRESTORE_EMULATOR_HOST|demo-verdanza-cagnotte|firebase\.cagnotte\.local|127\.0\.0\.1:18085/);
    console.log(`  ${entry}: ${graph.files.size} modules locaux; packages ${[...graph.packages].sort().join(", ") || "aucun"}`);
  }
});

await check("aucun rate limit ou ciblage client contournable sur les nouvelles routes", () => {
  const readRoute = read("api/_server/cagnotteReadRoute.ts");
  const refundRoute = read("api/_server/orderRefundRoute.ts");
  assert.doesNotMatch(readRoute + refundRoute, /enforcePublicSubmissionRateLimit|RATE_LIMIT_HMAC_SECRET/);
  assert.ok(readRoute.indexOf("dependencies.enabled !== true") < readRoute.indexOf("bearerToken(request)"));
  assert.ok(refundRoute.indexOf("dependencies.enabled !== true") < refundRoute.indexOf("request.body"));
  assert.match(readRoute, /scope === "self"[\s\S]*searchParams\.has\("targetUid"\)[\s\S]*foreign_account_forbidden/);
  assert.match(readRoute, /scope === "admin"[\s\S]*assertAdminUser/);
  assert.doesNotMatch(read("api/_server/orderRefunds.ts").slice(0, 12_000), /targetUid/);
});

await check("workflow refund complet et inspection admin structurée prêts derrière les gardes", () => {
  const refunds = read("api/_server/orderRefunds.ts");
  const route = read("api/_server/orderRefundRoute.ts");
  const admin = read("src/components/cagnotte/CagnotteAdminTools.tsx");
  const adminPage = read("src/pages/admin/AdminPage.tsx");
  const eligibility = read("src/lib/cagnotteAdminEligibility.ts");
  const service = read("src/services/cagnotteAdminService.ts");
  const adminTypes = read("src/types/cagnotteAdmin.ts");
  const adminController = read("src/lib/cagnotteAdminController.ts");
  const recoveryStorage = read("src/lib/cagnotteAdminFrozenOperationStorage.ts");
  for (const action of ["inspect", "preview", "record_confirmed", "preview_correction", "record_correction"]) assert.match(refunds, new RegExp(`action: "${action}"`));
  assert.ok(route.indexOf("dependencies.enabled !== true") < route.indexOf("request.body"));
  assert.match(refunds, /refund_historical_order_not_supported/);
  for (const field of ["operationalState", "enrollment", "accrual", "wallet", "reservation", "refund", "movements"]) {
    assert.match(adminTypes, new RegExp(`\\b${field}:`));
    assert.match(refunds, new RegExp(`\\b${field}(?:,|:)`));
  }
  for (const event of ["cagnotte_refund_recorded", "cagnotte_refund_correction_recorded", "cagnotte_correction_requires_review"]) assert.match(refunds, new RegExp(event));
  assert.match(adminPage, /shouldMountCagnotteAdminTools/);
  assert.match(eligibility, /simulateCagnotteRefund/);
  assert.match(admin, /Réinspecter avant toute nouvelle tentative/);
  assert.match(admin, /pendingRefund\.current \?\?=/);
  assert.match(admin, /pendingCorrection\.current \?\?=/);
  assert.match(admin, /frozenOperationStore\.subscribe\(orderId/);
  assert.match(admin, /mutationInFlightOperation/);
  assert.match(admin, /reconcileCagnotteAdminFrozenOperationStorage/);
  assert.match(admin, /flushPendingStorageReconciliation/);
  assert.match(admin, /Une opération précédente reste à confirmer/);
  assert.doesNotMatch(admin, /window\.localStorage|localStorage\.(?:getItem|setItem|removeItem)/);
  assert.ok(adminController.indexOf("store.persistBeforeSend(operation)") < adminController.indexOf("const result = await send(operation)"));
  assert.match(adminController, /resolveCagnotteAdminFrozenOperationFromInspection[\s\S]*isCagnotteAdminFrozenOperationRecorded[\s\S]*store\.clearAfterResolution/);
  assert.match(recoveryStorage, /verdanza:cagnotte-admin:frozen-operation:v1:/);
  assert.match(recoveryStorage, /verdanza:cagnotte-admin:frozen-resolution:v1:/);
  assert.match(recoveryStorage, /schemaVersion:\s*typeof CAGNOTTE_ADMIN_FROZEN_OPERATION_SCHEMA_VERSION/);
  assert.match(recoveryStorage, /operationFingerprint:\s*string/);
  assert.match(recoveryStorage, /outcome:\s*CagnotteAdminTerminalResolutionOutcome/);
  assert.ok(recoveryStorage.indexOf("writeResolutionAndConfirm(validated, outcome)") < recoveryStorage.indexOf("removeItem(key(validated.orderId))"));
  assert.match(recoveryStorage, /window\.localStorage/);
  assert.match(recoveryStorage, /strictObject/);
  assert.doesNotMatch(service, /\/api\/cagnotte|CAGNOTTE_READ_CURSOR_SECRET/);
});

await check("documentation opérationnelle conserve l ordre inert-first et le drain", () => {
  const documentation = read("docs/cagnotte/PROGRAMME-PRODUCTION-INERT-FIRST.md");
  assert.match(documentation, /refunds API → admin UI → acquisition/);
  assert.match(documentation, /Aucune de ces actions ne contacte un prestataire de paiement/);
  assert.match(documentation, /commande sans snapshot serveur `cagnotte` reste historique/);
  assert.match(documentation, /Après une réponse réseau incertaine/);
  assert.match(documentation, /Drain après incident/);
});

await check("règles Firestore candidates et protections commandes", () => {
  const rulesBytes = readFileSync(resolve("firestore.rules"));
  const rules = rulesBytes.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  assert.equal(createHash("sha256").update(rules, "utf8").digest("hex"), expectedRulesHash);
  for (const collection of [
    "cagnotteWallets",
    "cagnotteMovements",
    "cagnotteAccruals",
    "cagnotteReservations",
    "cagnotteRefunds",
  ]) {
    assert.match(rules, new RegExp(`match /${collection}/\\{document=\\*\\*\\} \\{ allow read, write: if false; \\}`));
  }
  assert.match(rules, /allow create: if isAdmin\(\) && !request\.resource\.data\.keys\(\)\.hasAny\(\["cagnotte"\]\)/);
  assert.match(rules, /!resource\.data\.keys\(\)\.hasAny\(\["cagnotte"\]\)[\s\S]*!request\.resource\.data\.keys\(\)\.hasAny\(\["cagnotte"\]\)/);
  assert.match(rules, /allow delete: if isAdmin\(\) && !resource\.data\.keys\(\)\.hasAny\(\["cagnotte"\]\)/);
});

await check("index candidat exact et non activé dans firebase.json", () => {
  const candidate = JSON.parse(read("firestore.cagnotte-read.indexes.json"));
  assert.deepEqual(candidate, {
    indexes: [{
      collectionGroup: "cagnotteMovements",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "beneficiaryId", order: "ASCENDING" },
        { fieldPath: "recordedAtEpochMs", order: "DESCENDING" },
        { fieldPath: "__name__", order: "DESCENDING" },
      ],
    }],
    fieldOverrides: [],
  });
  const firebase = JSON.parse(read("firebase.json"));
  assert.equal(firebase.firestore.rules, "firestore.rules");
  assert.equal(firebase.firestore.indexes, undefined);
});

await check("rules-unit-testing 4.0.1 reste une devDependency locale", () => {
  const packageJson = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(packageJson.dependencies?.["@firebase/rules-unit-testing"], undefined);
  assert.equal(packageJson.devDependencies?.["@firebase/rules-unit-testing"], "4.0.1");
  assert.equal(lock.packages?.[""]?.dependencies?.["@firebase/rules-unit-testing"], undefined);
  assert.equal(lock.packages?.[""]?.devDependencies?.["@firebase/rules-unit-testing"], "4.0.1");
  assert.equal(lock.packages?.["node_modules/@firebase/rules-unit-testing"]?.version, "4.0.1");
  assert.equal(lock.packages?.["node_modules/@firebase/rules-unit-testing"]?.dev, true);
});

await check("aucun secret manifeste dans le delta versionné", () => {
  const delta = git(["diff", "--name-only", `${baseMain}..HEAD`]).split(/\r?\n/).filter(Boolean);
  const candidates = new Set([
    ...delta,
    "scripts/verifyCagnotteProductionReadiness.ts",
    "docs/cagnotte/PREPRODUCTION-FINALE-V1.md",
    "package.json",
  ]);
  const suspiciousNames = [...candidates].filter((file) =>
    /(?:^|\/)\.env(?:\.|$)|credentials?.*\.json$|service[-_]?account.*\.json$|private.*\.(?:pem|key)$|\.p12$/i.test(file),
  );
  assert.deepEqual(suspiciousNames, []);

  const signatures = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bAIza[0-9A-Za-z_-]{30,}\b/,
    /\bre_[0-9A-Za-z_-]{20,}\b/,
    /\b(?:vercel_|vcp_)[0-9A-Za-z_-]{20,}\b/i,
    /\bgh[opusr]_[0-9A-Za-z]{30,}\b/,
    /\bsk_live_[0-9A-Za-z]{20,}\b/,
    /\bGOCSPX-[0-9A-Za-z_-]{20,}\b/,
    /Bearer\s+[0-9A-Za-z._-]{32,}/,
  ];
  const findings: string[] = [];
  for (const file of candidates) {
    if (!existsSync(resolve(file)) || statSync(resolve(file)).size > 2_000_000) continue;
    const source = read(file);
    if (signatures.some((signature) => signature.test(source))) findings.push(file);
  }
  assert.deepEqual(findings, []);
});

await check("documentation commerciale V1 présente et inchangée dans ses invariants", () => {
  const commercial = read("docs/cagnotte/REGLES-OUVERTURE-V1.md");
  assert.match(commercial, /5 %/);
  assert.match(commercial, /20 %/);
  assert.match(commercial, /n’expirent pas automatiquement/);
  assert.match(commercial, /Cette validation ne vaut ni activation technique, ni publication/);
  assert.match(commercial, /72 heures est un repère de revue manuelle/);
});

console.log("Readiness cagnotte : contrôles locaux réussis, aucune activation ni requête réseau.");

async function check(name: string, action: () => void | Promise<void>) {
  await action();
  console.log(`[OK] ${name}`);
}

function read(file: string) {
  return readFileSync(resolve(file), "utf8");
}

function walk(folder: string): string[] {
  return readdirSync(resolve(folder), { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(folder, entry.name);
    if (entry.isDirectory()) return walk(relative(process.cwd(), child));
    return [relative(process.cwd(), child).replaceAll("\\", "/")];
  });
}

function dependencyGraph(entry: string) {
  const queue = [entry];
  const files = new Set<string>();
  const packages = new Set<string>();
  while (queue.length) {
    const file = queue.shift() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of importSpecifiers(read(file))) {
      if (!specifier.startsWith(".")) {
        packages.add(packageName(specifier));
        continue;
      }
      const resolved = resolveLocalImport(file, specifier);
      assert.ok(resolved, `${file}: import local introuvable ${specifier}`);
      queue.push(resolved);
    }
  }
  return { files, packages };
}

function importSpecifiers(source: string) {
  return [...source.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

function resolveLocalImport(from: string, specifier: string) {
  const base = resolve(dirname(resolve(from)), specifier);
  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, "index.ts"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  return found ? relative(process.cwd(), found).replaceAll("\\", "/") : null;
}

function packageName(specifier: string) {
  return specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
}

function git(args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function request(method: string, url: string, body?: unknown, authorization?: string) {
  return { method, url, body, headers: authorization ? { authorization } : {} };
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
