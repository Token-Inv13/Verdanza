import assert from "node:assert/strict";
import { createOrderStatusHandler } from "../api/_server/orderStatusRoute.js";
import { createCagnotteReadHandler } from "../api/_server/cagnotteReadRoute.js";
import { createOrderRefundHandler } from "../api/_server/orderRefundRoute.js";
import {
  cagnotteRuntimeCapabilities,
  CAGNOTTE_CLOSED_RUNTIME_CONFIGURATION,
  CagnotteRuntimeConfigurationError,
  resolveCagnotteRuntimeConfiguration,
  type CagnotteRuntimeConfiguration,
} from "../api/_server/cagnotteRuntimeConfig.js";
import { CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID } from "../api/_server/cagnotteProgram.js";
import { createOrderHandler } from "../api/create-order.js";
import { createQuoteOrderHandler } from "../api/quote-order.js";
import { resolveCagnotteDisplayConfiguration } from "../src/config/cagnotteFeatures.js";

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

const start = 1_800_000_000_000;
const secret = "synthetic-cursor-secret-32-characters-minimum";
const closedEnvironment = {
  CAGNOTTE_RUNTIME_ENVIRONMENT: "production",
  CAGNOTTE_ACCRUAL_MODE: "off",
  CAGNOTTE_RESERVATION_MODE: "off",
  CAGNOTTE_STARTS_AT_EPOCH_MS: String(start),
  CAGNOTTE_READ_SERVER_ENABLED: "false",
  ORDER_REFUNDS_ENABLED: "false",
} as const;

let projectReads = 0;
const absent = resolveCagnotteRuntimeConfiguration({
  environment: {},
  getFirebaseProjectId: () => {
    projectReads += 1;
    throw new Error("closed configuration must not resolve Firebase identity");
  },
});
assert.strictEqual(absent, CAGNOTTE_CLOSED_RUNTIME_CONFIGURATION);
assert.equal(projectReads, 0);

const displayClosed = resolveCagnotteDisplayConfiguration({});
assert.deepEqual(displayClosed, {
  readDisplayEnabled: false,
  checkoutUseDisplayEnabled: false,
  adminToolsDisplayEnabled: false,
});
assert.deepEqual([
  absent.accrualProgram,
  absent.reservationProgram,
  absent.readServerEnabled,
  absent.orderRefundsEnabled,
  displayClosed.readDisplayEnabled,
  displayClosed.checkoutUseDisplayEnabled,
  displayClosed.adminToolsDisplayEnabled,
], [null, null, false, false, false, false, false]);

const explicitClosed = resolveCagnotteRuntimeConfiguration({
  environment: closedEnvironment,
  deploymentEnvironment: "production",
  getFirebaseProjectId: () => {
    projectReads += 1;
    throw new Error("fully closed configuration must not resolve Firebase identity");
  },
});
assert.equal(explicitClosed.configured, true);
assert.equal(explicitClosed.accrualProgram, null);
assert.equal(explicitClosed.reservationProgram, null);
assert.equal(explicitClosed.readServerEnabled, false);
assert.equal(explicitClosed.orderRefundsEnabled, false);
assert.equal(projectReads, 0);

const active = configuration({
  CAGNOTTE_ACCRUAL_MODE: "accrue",
  CAGNOTTE_RESERVATION_MODE: "reserve",
  CAGNOTTE_READ_SERVER_ENABLED: "true",
  ORDER_REFUNDS_ENABLED: "true",
  CAGNOTTE_READ_CURSOR_SECRET: secret,
});
assert.equal(active.accrualProgram?.mode, "production");
assert.equal(active.accrualProgram?.startsAtEpochMs, start);
assert.equal(active.accrualProgram?.newAccrualsEnabled, true);
assert.equal(active.reservationProgram?.startsAtEpochMs, start);
assert.equal(active.reservationProgram?.reservationsEnabled, true);
assert.equal(active.firebaseProjectId, CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID);
assert.equal(active.readCursorSecret, secret);
assert.deepEqual(cagnotteRuntimeCapabilities(active, start - 1), {
  canRequestReservation: false,
  canAccrueLoyalty: false,
});
assert.deepEqual(cagnotteRuntimeCapabilities(active, start), {
  canRequestReservation: true,
  canAccrueLoyalty: true,
});

const drain = configuration({
  CAGNOTTE_ACCRUAL_MODE: "drain",
  CAGNOTTE_RESERVATION_MODE: "drain",
});
assert.ok(drain.accrualProgram, "drain acquisition must retain the production program identity");
assert.ok(drain.reservationProgram, "drain reservation must retain the production program identity");
assert.equal(drain.accrualProgram.newAccrualsEnabled, false);
assert.equal(drain.reservationProgram.reservationsEnabled, false);
assert.deepEqual(cagnotteRuntimeCapabilities(drain, start + 1), {
  canRequestReservation: false,
  canAccrueLoyalty: false,
});

assert.deepEqual(resolveCagnotteDisplayConfiguration({
  VITE_CAGNOTTE_READ_DISPLAY_ENABLED: "true",
  VITE_CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED: "true",
  VITE_CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED: "true",
}), {
  readDisplayEnabled: true,
  checkoutUseDisplayEnabled: true,
  adminToolsDisplayEnabled: true,
});
assert.deepEqual(resolveCagnotteDisplayConfiguration({
  VITE_CAGNOTTE_READ_DISPLAY_ENABLED: "false",
  VITE_CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED: true,
  VITE_CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED: "TRUE",
}), displayClosed);
assert.equal(absent.readServerEnabled, false, "display-only activation must not grant server access");
assert.equal(absent.accrualProgram, null, "display-only activation must not enroll orders");

for (const invalid of [
  () => resolveCagnotteRuntimeConfiguration({
    environment: { CAGNOTTE_ACCRUAL_MODE: "accrue" },
    deploymentEnvironment: "production",
    getFirebaseProjectId: validProject,
  }),
  () => resolveCagnotteRuntimeConfiguration({
    environment: { ...closedEnvironment, CAGNOTTE_READ_SERVER_ENABLED: "yes" },
    deploymentEnvironment: "production",
    getFirebaseProjectId: validProject,
  }),
  () => resolveCagnotteRuntimeConfiguration({
    environment: { ...closedEnvironment, CAGNOTTE_STARTS_AT_EPOCH_MS: "now" },
    deploymentEnvironment: "production",
    getFirebaseProjectId: validProject,
  }),
  () => resolveCagnotteRuntimeConfiguration({
    environment: { ...closedEnvironment, CAGNOTTE_ACCRUAL_MODE: "accrue" },
    deploymentEnvironment: "preview",
    getFirebaseProjectId: validProject,
  }),
  () => resolveCagnotteRuntimeConfiguration({
    environment: { ...closedEnvironment, NODE_ENV: "production", CAGNOTTE_ACCRUAL_MODE: "accrue" },
    getFirebaseProjectId: validProject,
  }),
  () => resolveCagnotteRuntimeConfiguration({
    environment: { ...closedEnvironment, CAGNOTTE_ACCRUAL_MODE: "accrue" },
    deploymentEnvironment: "production",
    getFirebaseProjectId: () => "wrong-project",
  }),
  () => resolveCagnotteRuntimeConfiguration({
    environment: {
      ...closedEnvironment,
      CAGNOTTE_RUNTIME_ENVIRONMENT: "preview",
      CAGNOTTE_ACCRUAL_MODE: "accrue",
    },
    deploymentEnvironment: "preview",
    getFirebaseProjectId: validProject,
  }),
  () => resolveCagnotteRuntimeConfiguration({
    environment: { ...closedEnvironment, CAGNOTTE_READ_SERVER_ENABLED: "true" },
    deploymentEnvironment: "production",
    getFirebaseProjectId: validProject,
  }),
]) assert.throws(invalid, CagnotteRuntimeConfigurationError);

let readInput: Parameters<Parameters<typeof createCagnotteReadHandler>[0]["read"]>[0] | undefined;
const readHandler = createCagnotteReadHandler({
  getDb: () => ({}) as never,
  verifyToken: async () => ({ uid: "synthetic-user", email: null }),
  read: async (input) => {
    readInput = input;
    return { synthetic: true } as never;
  },
  getRuntimeConfiguration: () => active,
  now: () => start - 1,
});
const readResponse = new FakeResponse();
await readHandler(request("GET", "/api/cagnotte?scope=self", undefined, "Bearer synthetic"), readResponse as never);
assert.equal(readResponse.statusCode, 200);
assert.deepEqual(readInput?.capabilities, {
  canRequestReservation: false,
  canAccrueLoyalty: false,
});
assert.equal(readInput?.cursorSecret, secret);

let forbiddenDependencyCalls = 0;
const invalidConfiguration = () => {
  throw new CagnotteRuntimeConfigurationError("synthetic invalid configuration");
};
const invalidRead = createCagnotteReadHandler({
  getDb: () => {
    forbiddenDependencyCalls += 1;
    return {} as never;
  },
  verifyToken: async () => {
    forbiddenDependencyCalls += 1;
    return { uid: "unexpected", email: null };
  },
  read: async () => {
    forbiddenDependencyCalls += 1;
    return {} as never;
  },
  getRuntimeConfiguration: invalidConfiguration,
});
const invalidReadResponse = new FakeResponse();
await invalidRead(request("GET", "/api/cagnotte?scope=self", undefined, "Bearer synthetic"), invalidReadResponse as never);
assert.equal(invalidReadResponse.statusCode, 503);
assert.deepEqual(invalidReadResponse.body, {
  code: "cagnotte_configuration_invalid",
  error: "Configuration cagnotte indisponible.",
});

const invalidRefund = createOrderRefundHandler({
  getDb: () => {
    forbiddenDependencyCalls += 1;
    return {} as never;
  },
  verifyToken: async () => {
    forbiddenDependencyCalls += 1;
    return { uid: "unexpected", email: null };
  },
  getRuntimeConfiguration: invalidConfiguration,
});
const invalidRefundResponse = new FakeResponse();
await invalidRefund(request("POST", "/api/order-refunds", "not-json"), invalidRefundResponse as never);
assert.equal(invalidRefundResponse.statusCode, 503);
assert.equal((invalidRefundResponse.body as { code?: string }).code, "cagnotte_configuration_invalid");

const invalidQuote = createQuoteOrderHandler({
  getDb: forbiddenDependency,
  verifyToken: forbiddenAsyncDependency,
  getRuntimeConfiguration: invalidConfiguration,
});
const invalidQuoteResponse = new FakeResponse();
await invalidQuote(request("POST", "/api/quote-order", "not-json"), invalidQuoteResponse as never);
assertInvalidConfigurationResponse(invalidQuoteResponse);

const invalidCreate = createOrderHandler({
  getDb: forbiddenDependency,
  verifyToken: forbiddenAsyncDependency,
  getRuntimeConfiguration: invalidConfiguration,
});
const invalidCreateResponse = new FakeResponse();
await invalidCreate(request("POST", "/api/create-order", "not-json"), invalidCreateResponse as never);
assertInvalidConfigurationResponse(invalidCreateResponse);

const invalidStatus = createOrderStatusHandler({
  getDb: forbiddenDependency,
  verifyToken: forbiddenAsyncDependency,
  sendStatusEmail: forbiddenAsyncDependency,
  processAnalytics: forbiddenAsyncDependency,
  getRuntimeConfiguration: invalidConfiguration,
});
const invalidStatusResponse = new FakeResponse();
await invalidStatus(request("POST", "/api/update-order-status", "not-json"), invalidStatusResponse as never);
assertInvalidConfigurationResponse(invalidStatusResponse);

let publicRuntimeCalls = 0;
const publicQuote = createQuoteOrderHandler({
  getDb: () => emptyCatalogueDb() as never,
  verifyToken: forbiddenAsyncDependency,
  getRuntimeConfiguration: () => {
    publicRuntimeCalls += 1;
    return invalidConfiguration();
  },
});
const publicQuoteResponse = new FakeResponse();
await publicQuote(request("GET", "/api/quote-order?publicPromoBanners=1"), publicQuoteResponse as never);
assert.equal(publicQuoteResponse.statusCode, 200);
assert.deepEqual(publicQuoteResponse.body, { banners: [] });
assert.equal(publicRuntimeCalls, 0, "public promotion reads must remain independent from cagnotte configuration");
assert.equal(forbiddenDependencyCalls, 0, "invalid configuration must fail before Auth, Firestore or body parsing");

console.log("Configuration runtime cagnotte vérifiée : défaut fermé, parsing strict, identité Firebase réelle, drain, démarrage futur, capacités et erreurs avant dépendances.");

function configuration(overrides: Record<string, string>): CagnotteRuntimeConfiguration {
  return resolveCagnotteRuntimeConfiguration({
    environment: { ...closedEnvironment, ...overrides },
    deploymentEnvironment: "production",
    getFirebaseProjectId: validProject,
  });
}

function validProject() {
  return CAGNOTTE_PRODUCTION_FIREBASE_PROJECT_ID;
}

function forbiddenDependency() {
  forbiddenDependencyCalls += 1;
  return {} as never;
}

async function forbiddenAsyncDependency() {
  forbiddenDependencyCalls += 1;
  return {} as never;
}

function assertInvalidConfigurationResponse(response: FakeResponse) {
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    code: "cagnotte_configuration_invalid",
    error: "Configuration cagnotte indisponible.",
  });
}

function emptyCatalogueDb() {
  const query = {
    where() { return query; },
    async get() { return { docs: [] }; },
  };
  return { collection: () => query };
}

function request(method: string, url: string, body?: unknown, authorization?: string) {
  return { method, url, body, headers: authorization ? { authorization } : {} };
}
