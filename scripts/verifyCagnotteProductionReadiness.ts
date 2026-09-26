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
import { readCagnotte } from "../api/_server/cagnotteRead.js";
import { createCagnotteReadHandler } from "../api/_server/cagnotteReadRoute.js";
import {
  CAGNOTTE_RESERVATION_PROGRAM,
  createCagnotteReservationIntent,
} from "../api/_server/cagnotteReservations.js";
import {
  CAGNOTTE_CLOSED_RUNTIME_CONFIGURATION,
  CAGNOTTE_RUNTIME_ENV_KEYS,
  CagnotteRuntimeConfigurationError,
  resolveCagnotteRuntimeConfiguration,
} from "../api/_server/cagnotteRuntimeConfig.js";
import {
  CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED,
  CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED,
  CAGNOTTE_READ_DISPLAY_ENABLED,
  resolveCagnotteDisplayConfiguration,
} from "../src/config/cagnotteFeatures.js";
import {
  assertCagnotteAdminDurableSendOrdering,
  assertGitHubWorkflowPreparesCagnotteEmulator,
  assertGitHubWorkflowUsesPinnedJava,
  assertGitHubWorkflowUsesFullHistoryCheckout,
  assertOrderRefundScriptUsesPreparedEmulator,
} from "./cagnotteProductionReadinessAssertions.js";

const baseMain = "322f65895fb0a75479c92bc4a3054caa4073d2f8";
const expectedRulesHash = "b3583f787c75cffe8d2f05aded3b3026e3478bda4f63b8630f1f99f76ef0b725";
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
  "referral.ts",
  "retry-order-emails.ts",
  "retry-order-purchase-analytics.ts",
  "revoke-order-analytics.ts",
  "selection.ts",
  "send-payment-link.ts",
  "update-order-status.ts",
];

const allowedRootEnvironmentTemplate = ".env.example";
const sensitiveVersionedPathPattern = /(?:^|\/)\.env(?:\.|$)|credentials?.*\.json$|service[-_]?account.*\.json$|private.*\.(?:pem|key)$|\.p12$/i;
const secretSignatures = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bre_[0-9A-Za-z_-]{20,}\b/,
  /\b(?:vercel_|vcp_)[0-9A-Za-z_-]{20,}\b/i,
  /\bgh[opusr]_[0-9A-Za-z]{30,}\b/,
  /\bsk_live_[0-9A-Za-z]{20,}\b/,
  /\bGOCSPX-[0-9A-Za-z_-]{20,}\b/,
  /Bearer\s+[0-9A-Za-z._-]{32,}/,
];
const sensitiveEnvironmentTemplateKeys = new Set([
  "RESEND_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_SERVICE_ACCOUNT_BASE64",
  "CAGNOTTE_READ_CURSOR_SECRET",
  "REFERRAL_EMAIL_HMAC_KEYRING_JSON",
  "BOOTSTRAP_ADMIN_EMAIL",
  "BOOTSTRAP_ADMIN_UID",
  "BOOTSTRAP_ADMIN_TEMP_PASSWORD",
  "GA4_API_SECRET",
  "GOOGLE_CLIENT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_SERVICE_ACCOUNT_BASE64",
]);

await check("checkout complet disponible dans CI et CI Full", () => {
  const pinnedJavaVersions: string[] = [];
  for (const [workflow, verifyStep, verifyScript] of [
    [".github/workflows/ci.yml", "Verify", "verify"],
    [".github/workflows/ci-full.yml", "Verify full", "verify:full"],
  ] as const) {
    const workflowSource = read(workflow);
    assertGitHubWorkflowUsesFullHistoryCheckout(workflowSource, workflow);
    pinnedJavaVersions.push(assertGitHubWorkflowUsesPinnedJava(workflowSource, workflow));
    assertGitHubWorkflowPreparesCagnotteEmulator(workflowSource, workflow, verifyStep, verifyScript);
  }
  assert.deepEqual(pinnedJavaVersions, ["21.0.12", "21.0.12"]);

  const fixture = (checkoutOptions: string, otherStep = "") => `jobs:\n  verify:\n    steps:\n      - name: Checkout\n        uses: actions/checkout@v7\n        with:\n${checkoutOptions}${otherStep}`;
  const valid = fixture("          persist-credentials: false\n          fetch-depth: 0\n");
  assert.doesNotThrow(() => assertGitHubWorkflowUsesFullHistoryCheckout(valid, "valid fixture"));
  assert.throws(() => assertGitHubWorkflowUsesFullHistoryCheckout(
    fixture("          persist-credentials: false\n"), "missing fetch-depth fixture"), /fetch-depth: 0/);
  assert.throws(() => assertGitHubWorkflowUsesFullHistoryCheckout(
    fixture("          persist-credentials: false\n          fetch-depth: 1\n"), "shallow fixture"), /fetch-depth: 0/);
  assert.throws(() => assertGitHubWorkflowUsesFullHistoryCheckout(
    fixture("          fetch-depth: 0\n"), "missing credentials fixture"), /persist-credentials: false/);
  assert.throws(() => assertGitHubWorkflowUsesFullHistoryCheckout(
    fixture("          persist-credentials: true\n          fetch-depth: 0\n"), "persisted credentials fixture"), /persist-credentials: false/);
  assert.throws(() => assertGitHubWorkflowUsesFullHistoryCheckout(
    fixture("          persist-credentials: false\n", "      - name: Other\n        run: echo safe\n        fetch-depth: 0\n"),
    "other step fixture"), /fetch-depth: 0/);
  const twoCheckouts = valid.replace(
    "jobs:\n",
    "jobs:\n  windows:\n    steps:\n      - name: Checkout\n        uses: actions/checkout@v7\n        with:\n          persist-credentials: false\n          fetch-depth: 0\n",
  );
  assert.doesNotThrow(() => assertGitHubWorkflowUsesFullHistoryCheckout(twoCheckouts, "two checkout fixture"));
  assert.throws(() => assertGitHubWorkflowUsesFullHistoryCheckout(
    twoCheckouts.replace("          fetch-depth: 0\n  verify:", "          fetch-depth: 1\n  verify:"),
    "second shallow checkout fixture"), /Checkout #1.*fetch-depth: 0/);

  const workflowFixture = (steps: string) => `jobs:\n  verify:\n    steps:\n${steps}`;
  const prepareStep = "      - name: Prepare cagnotte Firestore emulator\n        run: npm run prepare:cagnotte-firestore-emulator\n";
  const verifyStep = "      - name: Verify\n        run: npm run verify\n";
  const setupJavaStep = "      - name: Setup Java\n        uses: actions/setup-java@v6.0.1\n        with:\n          distribution: 'temurin'\n          java-version: '21.0.12'\n";
  const runtimeStep = "      - name: Runtime versions\n        run: |\n          node --version\n          npm --version\n          java -version\n          which java\n";
  assert.doesNotThrow(() => assertGitHubWorkflowUsesPinnedJava(
    workflowFixture(setupJavaStep + runtimeStep + prepareStep + verifyStep), "valid Java fixture"));
  assert.throws(() => assertGitHubWorkflowUsesPinnedJava(
    workflowFixture(runtimeStep + prepareStep + verifyStep), "missing Java fixture"), /Setup Java/);
  assert.throws(() => assertGitHubWorkflowUsesPinnedJava(
    workflowFixture(setupJavaStep.replace("21.0.12", "17.0.20") + runtimeStep + prepareStep + verifyStep),
    "wrong Java fixture"), /Java 21\.0\.12 exact/);
  assert.throws(() => assertGitHubWorkflowUsesPinnedJava(
    workflowFixture(runtimeStep + setupJavaStep + prepareStep + verifyStep), "late Java fixture"), /doivent précéder/);
  assert.doesNotThrow(() => assertGitHubWorkflowPreparesCagnotteEmulator(
    workflowFixture(prepareStep + verifyStep), "valid preparation fixture", "Verify", "verify"));
  assert.throws(() => assertGitHubWorkflowPreparesCagnotteEmulator(
    workflowFixture(verifyStep), "missing preparation fixture", "Verify", "verify"), /Prepare cagnotte Firestore emulator/);
  assert.throws(() => assertGitHubWorkflowPreparesCagnotteEmulator(
    workflowFixture(verifyStep + prepareStep), "late preparation fixture", "Verify", "verify"), /doit précéder/);
  assert.throws(() => assertGitHubWorkflowPreparesCagnotteEmulator(
    workflowFixture(prepareStep.replace("prepare:cagnotte-firestore-emulator", "echo incorrect") + verifyStep),
    "wrong preparation fixture", "Verify", "verify"), /npm run prepare:cagnotte-firestore-emulator/);
});

await check("préparation réseau explicite en CI et vérification locale sans téléchargement implicite", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.scripts["prepare:cagnotte-firestore-emulator"], "node scripts/prepareCagnotteFirestoreEmulator.mjs");
  assert.doesNotThrow(() => assertOrderRefundScriptUsesPreparedEmulator(packageJson.scripts["test:order-refunds"]));
  for (const invalid of [
    "npm run prepare:cagnotte-firestore-emulator && node --import tsx scripts/runCagnotteLedgerTests.ts --refunds-only",
    "node --import tsx scripts/runCagnotteLedgerTests.ts --refunds-only && npm run prepare:cagnotte-firestore-emulator",
    "npm run prepare:other-firestore-emulator && node --import tsx scripts/runCagnotteLedgerTests.ts --refunds-only",
  ]) assert.throws(() => assertOrderRefundScriptUsesPreparedEmulator(invalid), /sans téléchargement implicite/);
  const runner = read("scripts/runCagnotteLedgerTests.ts");
  assert.match(runner, /npm run prepare:cagnotte-firestore-emulator/);
  assert.match(runner, /prérequis local/i);
  const preparation = read("scripts/prepareCagnotteFirestoreEmulator.mjs");
  assert.match(preparation, /cloud-firestore-emulator-v\$\{version\}\.jar/);
  assert.match(preparation, /const version = "1\.22\.0"/);
  assert.match(preparation, /9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c/);
  assert.doesNotMatch(preparation, /latest/i);
});

await check("baseline Git historique disponible", () => {
  assertHistoricalCagnotteBaselineAvailable(baseMain);
});

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
  const runtime = resolveCagnotteRuntimeConfiguration({
    environment: {},
    getFirebaseProjectId: () => { throw new Error("configuration fermée : Firebase ne doit pas être résolu"); },
  });
  assert.strictEqual(runtime, CAGNOTTE_CLOSED_RUNTIME_CONFIGURATION);
  assert.equal(runtime.accrualProgram, null);
  assert.equal(runtime.reservationProgram, null);
  assert.equal(runtime.readServerEnabled, false);
  assert.equal(CAGNOTTE_READ_DISPLAY_ENABLED, false);
  assert.equal(CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED, false);
  assert.equal(CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED, false);
  assert.equal(runtime.orderRefundsEnabled, false);
  assert.deepEqual(resolveCagnotteDisplayConfiguration({
    VITE_CAGNOTTE_READ_DISPLAY_ENABLED: "false",
    VITE_CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED: false,
    VITE_CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED: "TRUE",
  }), {
    readDisplayEnabled: false,
    checkoutUseDisplayEnabled: false,
    adminToolsDisplayEnabled: false,
  });
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

await check("configuration centrale unique et entrées normales raccordées", () => {
  const runtimeFiles = [...walk("api"), ...walk("src")]
    .filter((file) => [".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(extname(file)));
  const forbiddenEverywhere = [
    /x-(?:enable|activate|bypass)-(?:cagnotte|loyalty|refunds?)/i,
    /localStorage\.(?:getItem|setItem)\([^)]*(?:cagnotte|loyalty)/i,
    /NODE_ENV[^\n;]*(?:cagnotte|loyalty|refund)/i,
    /localhost[^\n;]*(?:enable|activate|bypass)[^\n;]*(?:cagnotte|loyalty|refund)/i,
  ];
  const violations = runtimeFiles.flatMap((file) => {
    const source = read(file);
    return forbiddenEverywhere.some((pattern) => pattern.test(source)) ? [file] : [];
  });
  assert.deepEqual(violations, []);

  const serverConfiguration = read("api/_server/cagnotteRuntimeConfig.ts");
  const displayConfiguration = read("src/config/cagnotteFeatures.ts");
  for (const file of runtimeFiles.filter((entry) =>
    entry !== "api/_server/cagnotteRuntimeConfig.ts" && entry !== "src/config/cagnotteFeatures.ts")) {
    assert.doesNotMatch(
      read(file),
      /(?:process\.env|import\.meta\.env)[^\n;]*(?:CAGNOTTE|LOYALTY|ORDER_REFUND)/i,
      `${file}: lecture de configuration cagnotte dispersée`,
    );
  }
  for (const key of CAGNOTTE_RUNTIME_ENV_KEYS) assert.match(serverConfiguration, new RegExp(`"${key}"`));
  assert.match(serverConfiguration, /process\.env\.VERCEL_ENV/);
  assert.match(serverConfiguration, /getAdminProjectId/);
  assert.doesNotMatch(serverConfiguration, /Date\.now|local_test/);
  assert.match(displayConfiguration, /=== "true"/);
  assert.doesNotMatch(displayConfiguration, /Boolean\(|!!/);

  for (const file of [
    "api/create-order.ts",
    "api/quote-order.ts",
    "api/update-order-status.ts",
    "api/_server/cagnotteReadRoute.ts",
    "api/_server/orderRefundRoute.ts",
  ]) assert.match(read(file), /getCagnotteRuntimeConfiguration/);
  assert.doesNotMatch(read("api/create-order.ts") + read("api/quote-order.ts") + read("api/update-order-status.ts"),
    /(?:accrualProgram|reservationProgram):\s*CAGNOTTE_(?:SERVER|RESERVATION)_PROGRAM/);
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
  const controlledNames = [...CAGNOTTE_RUNTIME_ENV_KEYS, "VERCEL_ENV"];
  const previous = new Map(controlledNames.map((name) => [name, process.env[name]]));
  for (const name of controlledNames) delete process.env[name];
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
    for (const [name, value] of previous) restoreEnvironment(name, value);
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
  const runtimeSource = read("api/_server/cagnotteRuntimeConfig.ts");
  assert.match(runtimeSource, /environment\.CAGNOTTE_READ_CURSOR_SECRET/);
  assert.doesNotMatch(routeSource + runtimeSource, /CAGNOTTE_READ_CURSOR_SECRET[^\n]*(?:randomBytes|randomUUID)/);
});

await check("configuration runtime invalide refusée avant Firebase, Auth et lecture du corps", async () => {
  let dependencyCalls = 0;
  const handler = createCagnotteReadHandler({
    getDb: () => { dependencyCalls += 1; return {} as never; },
    verifyToken: async () => { dependencyCalls += 1; return { uid: "unexpected", email: null }; },
    read: async () => { dependencyCalls += 1; return {} as never; },
    getRuntimeConfiguration: () => {
      throw new CagnotteRuntimeConfigurationError("synthetic invalid configuration");
    },
  });
  const response = new FakeResponse();
  await handler(request("GET", "/api/cagnotte?scope=self", undefined, "Bearer synthetic"), response as never);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    code: "cagnotte_configuration_invalid",
    error: "Configuration cagnotte indisponible.",
  });
  assert.equal(dependencyCalls, 0);
});

await check("20 fonctions API attendues, deux endpoints fidélité, referral.ts et selection.ts connus", () => {
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
  const addedEndpoints = endpoints.filter((file) => !mainEndpoints.includes(file));
  const fidelityEndpoints = ["cagnotte.ts", "order-refunds.ts"];
  const independentEndpoints = ["referral.ts", "selection.ts"];
  assert.equal(endpoints.length, 20);
  assert.deepEqual(addedEndpoints, [...fidelityEndpoints, ...independentEndpoints].sort());
  assert.deepEqual(addedEndpoints.filter((file) => !independentEndpoints.includes(file)), fidelityEndpoints);
});

await check("CI exécute les deux suites backend Stripe Test distinctes des adapters/UI", () => {
  const workflow = read(".github/workflows/ci.yml");
  // Match complete command lines: :adapters, :ui and comments cannot satisfy this gate.
  assert.match(workflow, /^[ \t]+npm run test:stripe-test[ \t]*\r?$/m);
  assert.match(workflow, /^[ \t]+npm run test:stripe-test:http[ \t]*\r?$/m);
});

await check("packaging statique des endpoints cagnotte et parrainage sans dépendance de test", () => {
  const forbiddenPackages = new Set(["playwright", "@firebase/rules-unit-testing", "tsx", "vite", "firebase-tools"]);
  for (const entry of ["api/cagnotte.ts", "api/order-refunds.ts", "api/referral.ts"]) {
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
  assert.ok(readRoute.indexOf("if (!enabled)") < readRoute.indexOf("bearerToken(request)"));
  assert.ok(refundRoute.indexOf("if (!enabled)") < refundRoute.indexOf("request.body"));
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
  assert.ok(route.indexOf("if (!enabled)") < route.indexOf("request.body"));
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
  assertCagnotteAdminDurableSendOrdering(adminController);
  assert.match(adminController, /resolveCagnotteAdminFrozenOperationFromInspection[\s\S]*isCagnotteAdminFrozenOperationRecorded[\s\S]*store\.clearAfterResolution/);
  assert.match(recoveryStorage, /verdanza:cagnotte-admin:frozen-operation:v1:/);
  assert.match(recoveryStorage, /verdanza:cagnotte-admin:frozen-resolution:v2:/);
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
    "referralCodes",
    "referrals",
    "referralEmailClaims",
    "referralMigrations",
  ]) {
    assert.match(rules, new RegExp(`match /${collection}/\\{document=\\*\\*\\} \\{ allow read, write: if false; \\}`));
  }
  assert.match(
    rules,
    /match \/customers\/\{customerId\} \{[\s\S]*?allow create:[\s\S]*?!request\.resource\.data\.keys\(\)\.hasAny\(\["productionFixture"\]\)[\s\S]*?allow update:/,
  );
  assert.match(rules, /allow create: if isAdmin\(\) && !request\.resource\.data\.keys\(\)\.hasAny\(\["cagnotte", "referral"\]\)/);
  assert.match(rules, /!resource\.data\.keys\(\)\.hasAny\(\["cagnotte", "referral"\]\)[\s\S]*!request\.resource\.data\.keys\(\)\.hasAny\(\["cagnotte", "referral"\]\)/);
  assert.match(rules, /allow delete: if isAdmin\(\) && !resource\.data\.keys\(\)\.hasAny\(\["cagnotte", "referral"\]\)/);
});

await check("index candidat exact raccordé localement dans firebase.json", () => {
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
    }, {
      collectionGroup: "referrals", queryScope: "COLLECTION",
      fields: [
        { fieldPath: "sponsorUid", order: "ASCENDING" },
        { fieldPath: "createdAtEpochMs", order: "DESCENDING" },
        { fieldPath: "__name__", order: "DESCENDING" },
      ],
    }, {
      collectionGroup: "orders", queryScope: "COLLECTION",
      fields: [
        { fieldPath: "customerId", order: "ASCENDING" },
        { fieldPath: "paymentStatus", order: "ASCENDING" },
        { fieldPath: "orderStatus", order: "ASCENDING" },
      ],
    }],
    fieldOverrides: [],
  });
  const firebase = JSON.parse(read("firebase.json"));
  assert.equal(firebase.firestore.rules, "firestore.rules");
  assert.equal(firebase.firestore.indexes, "firestore.cagnotte-read.indexes.json");
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

await check("régressions du contrôle strict du modèle .env.example", () => {
  const healthyTemplate = read(allowedRootEnvironmentTemplate);

  assert.deepEqual(
    [allowedRootEnvironmentTemplate].filter((file) => sensitiveVersionedPathPattern.test(file)),
    [allowedRootEnvironmentTemplate],
    "l'ancien contrôle par nom doit bien rejeter le modèle racine sain",
  );
  assert.deepEqual(findForbiddenSensitivePathNames([allowedRootEnvironmentTemplate]), []);
  assert.deepEqual(findVersionedSecretContentFindings([
    { file: allowedRootEnvironmentTemplate, source: healthyTemplate },
  ]), []);

  for (const forbidden of [
    ".env",
    ".env.local",
    ".env.production",
    ".env.example.bak",
    ".env.production.example",
    "config/.env.example",
    "credentials.json",
    "service-account.json",
    "private.pem",
    "private.key",
    "certificate.p12",
  ]) {
    assert.deepEqual(findForbiddenSensitivePathNames([forbidden]), [forbidden]);
  }

  const syntheticSignature = ["AI", "za", "A".repeat(32)].join("");
  assert.deepEqual(findVersionedSecretContentFindings([
    { file: allowedRootEnvironmentTemplate, source: `VITE_APP_NAME="${syntheticSignature}"` },
  ]), [`${allowedRootEnvironmentTemplate}:secret-signature`]);
  assert.deepEqual(findVersionedSecretContentFindings([
    { file: allowedRootEnvironmentTemplate, source: `# commentaire ${syntheticSignature}` },
  ]), [`${allowedRootEnvironmentTemplate}:secret-signature`]);
  assert.deepEqual(findVersionedSecretContentFindings([
    { file: allowedRootEnvironmentTemplate, source: "RESEND_API_KEY=\"synthetic-non-empty-value\"" },
  ]), [`${allowedRootEnvironmentTemplate}:non-empty-sensitive-field:RESEND_API_KEY`]);
  assert.deepEqual(findVersionedSecretContentFindings([
    {
      file: allowedRootEnvironmentTemplate,
      source: [
        "VITE_GTM_ID=\"GTM-W76PFW2X\"",
        "VITE_GA4_MEASUREMENT_ID=\"G-E9XNP7BJ2Y\"",
        "# CAGNOTTE_RUNTIME_ENVIRONMENT=\"production\"",
        "# CAGNOTTE_READ_CURSOR_SECRET=\"\"",
      ].join("\n"),
    },
  ]), []);
});

await check("aucun secret manifeste dans le delta versionné", () => {
  const delta = git(["diff", "--name-only", `${baseMain}..HEAD`]).split(/\r?\n/).filter(Boolean);
  const candidates = new Set([
    ...delta,
    "scripts/verifyCagnotteProductionReadiness.ts",
    "docs/cagnotte/PREPRODUCTION-FINALE-V1.md",
    "package.json",
  ]);
  const suspiciousNames = findForbiddenSensitivePathNames(candidates);
  assert.deepEqual(suspiciousNames, []);

  const versionedSources: Array<{ file: string; source: string }> = [];
  for (const file of candidates) {
    if (!existsSync(resolve(file)) || statSync(resolve(file)).size > 2_000_000) continue;
    versionedSources.push({ file, source: read(file) });
  }
  const findings = findVersionedSecretContentFindings(versionedSources);
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

function findForbiddenSensitivePathNames(files: Iterable<string>) {
  return [...files].filter((file) => (
    file !== allowedRootEnvironmentTemplate && sensitiveVersionedPathPattern.test(file)
  ));
}

function findVersionedSecretContentFindings(files: Iterable<{ file: string; source: string }>) {
  const findings: string[] = [];
  for (const { file, source } of files) {
    if (secretSignatures.some((signature) => signature.test(source))) {
      findings.push(`${file}:secret-signature`);
    }
    if (file !== allowedRootEnvironmentTemplate) continue;
    for (const key of findNonEmptySensitiveEnvironmentTemplateKeys(source)) {
      findings.push(`${file}:non-empty-sensitive-field:${key}`);
    }
  }
  return findings;
}

function findNonEmptySensitiveEnvironmentTemplateKeys(source: string) {
  const findings: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*(?:#\s*)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || !sensitiveEnvironmentTemplateKeys.has(match[1]!)) continue;
    const rawValue = match[2]!.trim();
    const isQuoted = rawValue.length >= 2 && (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    );
    const value = (isQuoted ? rawValue.slice(1, -1) : rawValue).trim();
    if (value !== "") findings.push(match[1]!);
  }
  return findings;
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

function assertHistoricalCagnotteBaselineAvailable(commit: string) {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Historical cagnotte baseline commit unavailable. CI checkout must provide full Git history.");
  }
}

function request(method: string, url: string, body?: unknown, authorization?: string) {
  return { method, url, body, headers: authorization ? { authorization } : {} };
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
