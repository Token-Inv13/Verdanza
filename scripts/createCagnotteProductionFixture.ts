import { isDeepStrictEqual } from "node:util";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";
import type { Firestore } from "firebase-admin/firestore";
import { commitCheckoutOrder } from "../api/_server/checkoutOrder.js";
import type { CheckoutRequestBody, PricedCheckout } from "../api/_server/checkout.js";
import { checkoutPayloadFingerprint } from "../api/_server/orderSideEffects.js";
import {
  commitOrderStatusTransition,
  processOrderStatusTransitionEffects,
  type OrderStatusChange,
} from "../api/_server/orderStatusTransition.js";
import { resolveCagnotteProductionProgram } from "../api/_server/cagnotteProgram.js";
import type { CagnotteProductionProgram } from "../api/_server/cagnotteLedgerTypes.js";
import { getAdminAuth, getAdminDb, getAdminProjectId } from "../api/_server/firebaseAdmin.js";
import {
  CAGNOTTE_PRODUCTION_FIXTURE_CHALLENGE,
  CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_DELIVERED_AT,
  CAGNOTTE_PRODUCTION_FIXTURE_EMAIL,
  CAGNOTTE_PRODUCTION_FIXTURE_INITIAL_STOCK,
  CAGNOTTE_PRODUCTION_FIXTURE_MARKER,
  CAGNOTTE_PRODUCTION_FIXTURE_OPERATION_EPOCH_MS,
  CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT,
  CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
  CAGNOTTE_PRODUCTION_FIXTURE_UID,
  CAGNOTTE_PRODUCTION_FIXTURE_WRITE_CHALLENGE,
  cagnotteProductionFixtureCheckoutBody,
  cagnotteProductionFixtureCustomerDocument,
  cagnotteProductionFixtureDeliveredStatusChange,
  cagnotteProductionFixturePaidStatusChange,
  cagnotteProductionFixturePricedCheckout,
  cagnotteProductionFixtureProductDocument,
  assertCagnotteProductionFixtureCapability,
  createCagnotteProductionFixtureCapability,
  type CagnotteProductionFixtureCapability,
} from "../api/_server/cagnotteProductionFixture.js";
import {
  cagnotteProductionFixtureReferences,
  validateCagnotteProductionFixtureAccountingArtifacts,
  validateCagnotteProductionFixtureExternalArtifacts,
  validateCagnotteProductionFixtureMovements,
  validateCagnotteProductionFixtureState,
  validateCagnotteProductionFixtureStockMovements,
} from "../api/_server/cagnotteProductionFixtureState.js";

export type CagnotteProductionFixtureCommand =
  | "create"
  | "mark-paid"
  | "mark-delivered"
  | "inspect";

export type CagnotteProductionFixturePlan = Readonly<{
  mode: "dry-run" | "write";
  command: CagnotteProductionFixtureCommand;
  projectId: typeof CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID;
  uid: typeof CAGNOTTE_PRODUCTION_FIXTURE_UID;
  email: typeof CAGNOTTE_PRODUCTION_FIXTURE_EMAIL;
  productId: typeof CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID;
  orderId: typeof CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID;
  checkoutRequestId: typeof CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID;
  marker: typeof CAGNOTTE_PRODUCTION_FIXTURE_MARKER;
  actions: readonly string[];
}>;

type FixtureRunInput = Readonly<{
  db: Firestore;
  command: CagnotteProductionFixtureCommand;
  capability: CagnotteProductionFixtureCapability;
  firebaseProjectId: typeof CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID;
  auth?: CagnotteProductionFixtureAuthLookup;
}>;

export type CagnotteProductionFixtureAuthLookup = Readonly<{
  getUser: (uid: string) => Promise<unknown>;
}>;

const internalActor = Object.freeze({
  uid: "verdanza-cagnotte-production-fixture-tool-v1",
  email: null,
});

export function cagnotteProductionFixtureProgram(): CagnotteProductionProgram {
  const program = resolveCagnotteProductionProgram({
    runtimeEnvironment: "production",
    mode: "accrue",
    startsAtEpochMs: CAGNOTTE_PRODUCTION_FIXTURE_OPERATION_EPOCH_MS,
    firebaseProjectId: CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
  });
  if (!program) throw new Error("production_fixture_program_unavailable");
  return program;
}

export function assertCagnotteProductionFixtureProductionEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
) {
  if (
    environment.CI ||
    environment.GITHUB_ACTIONS ||
    environment.VERCEL ||
    environment.VERCEL_ENV ||
    environment.NOW_BUILDER ||
    environment.FIRESTORE_EMULATOR_HOST ||
    environment.FIREBASE_AUTH_EMULATOR_HOST
  ) {
    throw new Error("production_fixture_environment_refused");
  }
}

export function buildCagnotteProductionFixturePlan(input: {
  command: CagnotteProductionFixtureCommand;
  write: boolean;
  projectId: string | null;
}): CagnotteProductionFixturePlan {
  if (input.projectId !== CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID) {
    throw new Error("production_fixture_project_invalid");
  }
  const actionsByCommand: Record<CagnotteProductionFixtureCommand, readonly string[]> = {
    create: [
      "verify deterministic customer and inactive product",
      "commit checkout transaction with a production accrual enrollment",
      "persist every order side effect as skipped:production_fixture",
    ],
    "mark-paid": [
      "commit paid transition with finalPaymentMethod=other",
      "keep reservation and every outbound effect disabled",
    ],
    "mark-delivered": [
      "commit delivered transition",
      "release the earned amount through the normal ledger transaction",
    ],
    inspect: [
      "read the deterministic fixture documents",
      "report enrollment, journal and outbound-effect state without writes",
    ],
  };
  return Object.freeze({
    mode: input.write ? "write" : "dry-run",
    command: input.command,
    projectId: CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
    uid: CAGNOTTE_PRODUCTION_FIXTURE_UID,
    email: CAGNOTTE_PRODUCTION_FIXTURE_EMAIL,
    productId: CAGNOTTE_PRODUCTION_FIXTURE_PRODUCT_ID,
    orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
    checkoutRequestId: CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID,
    marker: CAGNOTTE_PRODUCTION_FIXTURE_MARKER,
    actions: actionsByCommand[input.command],
  });
}

export async function runCagnotteProductionFixtureCommand(input: FixtureRunInput) {
  assertCagnotteProductionFixtureCapability(input.capability);
  if (input.firebaseProjectId !== CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID) {
    throw new Error("production_fixture_project_invalid");
  }
  if (input.command !== "inspect") {
    await assertCagnotteProductionFixtureAuthUidAvailable(input.auth);
  }
  switch (input.command) {
    case "create":
      return createFixture(input);
    case "mark-paid":
      return transitionFixture(
        input,
        cagnotteProductionFixturePaidStatusChange(),
        CAGNOTTE_PRODUCTION_FIXTURE_PAID_AT,
      );
    case "mark-delivered":
      return transitionFixture(
        input,
        cagnotteProductionFixtureDeliveredStatusChange(),
        CAGNOTTE_PRODUCTION_FIXTURE_DELIVERED_AT,
      );
    case "inspect":
      return inspectCagnotteProductionFixture(input.db);
  }
}

export async function assertCagnotteProductionFixtureAuthUidAvailable(
  auth: CagnotteProductionFixtureAuthLookup | undefined,
) {
  if (!auth) throw new Error("production_fixture_auth_verification_failed");
  try {
    await auth.getUser(CAGNOTTE_PRODUCTION_FIXTURE_UID);
  } catch (error) {
    if (firebaseAuthErrorCode(error) === "auth/user-not-found") return;
    throw new Error("production_fixture_auth_verification_failed");
  }
  throw new Error("production_fixture_auth_collision");
}

export async function inspectCagnotteProductionFixture(db: Firestore) {
  const refs = cagnotteProductionFixtureReferences(db);
  const [customer, product, order, checkoutRequest, sideEffects, stockMovement, wallet, accrual, reservation] =
    await Promise.all([
      refs.customer.get(),
      refs.product.get(),
      refs.order.get(),
      refs.checkoutRequest.get(),
      refs.sideEffects.get(),
      refs.stockMovement.get(),
      refs.wallet.get(),
      refs.accrual.get(),
      refs.reservation.get(),
    ]);
  const movements = await db.collection("cagnotteMovements")
    .where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID)
    .get();
  const invoices = await db.collection("invoices")
    .where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID)
    .get();
  const analytics = await db.collection("analyticsOutbox")
    .where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID)
    .get();
  const paymentLinkRequests = await db.collection("paymentLinkRequests")
    .where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID)
    .get();
  const refunds = await db.collection("cagnotteRefunds")
    .where("orderId", "==", CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID)
    .get();
  return {
    customer: documentState(customer),
    product: documentState(product),
    order: documentState(order),
    checkoutRequest: documentState(checkoutRequest),
    sideEffects: documentState(sideEffects),
    stockMovement: documentState(stockMovement),
    wallet: documentState(wallet),
    accrual: documentState(accrual),
    reservation: documentState(reservation),
    movements: movements.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
    invoiceCount: invoices.size,
    analyticsOutboxCount: analytics.size,
    paymentLinkRequestCount: paymentLinkRequests.size,
    refundCount: refunds.size,
  };
}

export function isCagnotteProductionFixtureOutboundTargetAllowed(
  candidate: unknown,
  encrypted: boolean,
) {
  const url = requestUrl(candidate, encrypted);
  const localEmulator = url.hostname === "127.0.0.1" && url.port === "18085";
  const firebaseAdmin = encrypted && (
    url.hostname === "oauth2.googleapis.com" ||
    url.hostname === "firestore.googleapis.com" ||
    url.hostname === "identitytoolkit.googleapis.com"
  );
  return localEmulator || firebaseAdmin;
}

export function installCagnotteProductionFixtureOutboundGuard() {
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpGet = http.get;
  const originalHttpsRequest = https.request;
  const originalHttpsGet = https.get;
  const assertAllowed = (candidate: unknown, encrypted: boolean) => {
    const url = requestUrl(candidate, encrypted);
    if (!isCagnotteProductionFixtureOutboundTargetAllowed(url, encrypted)) {
      throw new Error(`production_fixture_network_blocked:${url.hostname || "unknown"}`);
    }
  };
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    assertAllowed(input, true);
    return originalFetch(input, init);
  }) as typeof fetch;
  Reflect.set(http, "request", new Proxy(originalHttpRequest, {
    apply(target, receiver, args) {
      assertAllowed(args[0], false);
      return Reflect.apply(target, receiver, args);
    },
  }));
  Reflect.set(http, "get", new Proxy(originalHttpGet, {
    apply(target, receiver, args) {
      assertAllowed(args[0], false);
      return Reflect.apply(target, receiver, args);
    },
  }));
  Reflect.set(https, "request", new Proxy(originalHttpsRequest, {
    apply(target, receiver, args) {
      assertAllowed(args[0], true);
      return Reflect.apply(target, receiver, args);
    },
  }));
  Reflect.set(https, "get", new Proxy(originalHttpsGet, {
    apply(target, receiver, args) {
      assertAllowed(args[0], true);
      return Reflect.apply(target, receiver, args);
    },
  }));
  syncBuiltinESMExports();
  return () => {
    globalThis.fetch = originalFetch;
    Reflect.set(http, "request", originalHttpRequest);
    Reflect.set(http, "get", originalHttpGet);
    Reflect.set(https, "request", originalHttpsRequest);
    Reflect.set(https, "get", originalHttpsGet);
    syncBuiltinESMExports();
  };
}

async function createFixture(input: FixtureRunInput) {
  const state = await prepareFixtureDocuments(input.db);
  if (state === "existing") return inspectCagnotteProductionFixture(input.db);
  const body = cagnotteProductionFixtureCheckoutBody() as CheckoutRequestBody;
  const priced = cagnotteProductionFixturePricedCheckout() as PricedCheckout;
  const result = await commitCheckoutOrder({
    db: input.db,
    body,
    priced,
    checkoutRequestId: CAGNOTTE_PRODUCTION_FIXTURE_CHECKOUT_REQUEST_ID,
    payloadFingerprint: checkoutPayloadFingerprint(body),
    customerId: CAGNOTTE_PRODUCTION_FIXTURE_UID,
    orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID,
    accrualProgram: cagnotteProductionFixtureProgram(),
    reservationProgram: null,
    firebaseProjectId: input.firebaseProjectId,
    nowEpochMs: CAGNOTTE_PRODUCTION_FIXTURE_OPERATION_EPOCH_MS,
    productionFixtureCapability: input.capability,
  });
  if (!result.created || result.orderId !== CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID) {
    throw new Error("production_fixture_creation_result_invalid");
  }
  return inspectCagnotteProductionFixture(input.db);
}

async function prepareFixtureDocuments(db: Firestore): Promise<"prepared" | "existing"> {
  const refs = cagnotteProductionFixtureReferences(db);
  return db.runTransaction(async (transaction) => {
    const [
      customer,
      product,
      admin,
      order,
      checkoutRequest,
      sideEffects,
      wallet,
      accrual,
      reservation,
    ] = await Promise.all([
      transaction.get(refs.customer),
      transaction.get(refs.product),
      transaction.get(refs.admin),
      transaction.get(refs.order),
      transaction.get(refs.checkoutRequest),
      transaction.get(refs.sideEffects),
      transaction.get(refs.wallet),
      transaction.get(refs.accrual),
      transaction.get(refs.reservation),
    ]);
    const existingOrderState = [order.exists, checkoutRequest.exists, sideEffects.exists];
    if (existingOrderState.every(Boolean)) {
      await validateCagnotteProductionFixtureState({
        db,
        transaction,
        orderSnapshot: order,
        expectedTransition: "existing",
      });
      return "existing";
    }
    if (existingOrderState.some(Boolean)) {
      throw new Error("production_fixture_partial_collision");
    }
    await validateCagnotteProductionFixtureStockMovements({
      db,
      transaction,
      expected: "absent",
    });
    await validateCagnotteProductionFixtureMovements({
      db,
      transaction,
      expected: "absent",
    });
    await validateCagnotteProductionFixtureExternalArtifacts({ db, transaction });
    await validateCagnotteProductionFixtureAccountingArtifacts({ db, transaction });
    if (reservation.exists) {
      throw new Error("production_fixture_reservation_collision");
    }
    if (admin.exists) throw new Error("production_fixture_admin_collision");
    if (wallet.exists || accrual.exists) {
      throw new Error("production_fixture_wallet_collision");
    }
    if (customer.exists && !isDeepStrictEqual(customer.data(), cagnotteProductionFixtureCustomerDocument())) {
      throw new Error("production_fixture_customer_collision");
    }
    if (product.exists && !isDeepStrictEqual(
      product.data(),
      cagnotteProductionFixtureProductDocument(CAGNOTTE_PRODUCTION_FIXTURE_INITIAL_STOCK),
    )) {
      throw new Error("production_fixture_product_collision");
    }
    if (!customer.exists) transaction.create(refs.customer, cagnotteProductionFixtureCustomerDocument());
    if (!product.exists) transaction.create(
      refs.product,
      cagnotteProductionFixtureProductDocument(CAGNOTTE_PRODUCTION_FIXTURE_INITIAL_STOCK),
    );
    return "prepared";
  });
}

async function transitionFixture(
  input: FixtureRunInput,
  body: Omit<OrderStatusChange, "orderId">,
  instant: string,
) {
  const committed = await commitOrderStatusTransition({
    db: input.db,
    body: { orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, ...body },
    admin: internalActor,
    accrualProgram: cagnotteProductionFixtureProgram(),
    reservationProgram: null,
    firebaseProjectId: input.firebaseProjectId,
    productionFixtureCapability: input.capability,
    now: () => instant,
  });
  await processOrderStatusTransitionEffects({
    db: input.db,
    body: { orderId: CAGNOTTE_PRODUCTION_FIXTURE_ORDER_ID, ...body },
    committed,
    sendStatusEmail: async () => ({ status: "skipped", reason: "production_fixture" }),
    processAnalytics: async () => ({ status: "skipped", code: "production_fixture" }),
  });
  return inspectCagnotteProductionFixture(input.db);
}

function documentState(snapshot: FirebaseFirestore.DocumentSnapshot) {
  return snapshot.exists ? { exists: true as const, id: snapshot.id, data: snapshot.data() } : {
    exists: false as const,
    id: snapshot.id,
    data: null,
  };
}

function firebaseAuthErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const direct = Reflect.get(error, "code");
  if (typeof direct === "string") return direct;
  const errorInfo = Reflect.get(error, "errorInfo");
  if (!errorInfo || typeof errorInfo !== "object") return null;
  const nested = Reflect.get(errorInfo, "code");
  return typeof nested === "string" ? nested : null;
}

function parseCli(argv: readonly string[], environment: NodeJS.ProcessEnv) {
  assertCagnotteProductionFixtureProductionEnvironment(environment);
  const commands = argv.filter((arg) => !arg.startsWith("--"));
  if (commands.length > 1) throw new Error("production_fixture_command_invalid");
  const command = (commands[0] || "create") as CagnotteProductionFixtureCommand;
  if (!["create", "mark-paid", "mark-delivered", "inspect"].includes(command)) {
    throw new Error("production_fixture_command_invalid");
  }
  const allowed = new Set([
    ...(commands[0] ? [commands[0]] : []),
    ...argv.filter((arg) => arg.startsWith("--project-id=") || arg.startsWith("--write-challenge=")),
  ]);
  if (argv.some((arg) => !allowed.has(arg))) throw new Error("production_fixture_option_invalid");
  const projectArgument = singleOption(argv, "--project-id=");
  const writeChallenge = singleOption(argv, "--write-challenge=");
  const configuredProject = getAdminProjectId();
  if (projectArgument && configuredProject && projectArgument !== configuredProject) {
    throw new Error("production_fixture_project_sources_conflict");
  }
  const projectId = projectArgument || configuredProject;
  if (projectId !== CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID) {
    throw new Error("production_fixture_project_invalid");
  }
  return {
    command,
    projectId,
    write: writeChallenge !== undefined,
    writeChallenge,
  };
}

function parseChallenge(value: string | undefined) {
  if (value !== CAGNOTTE_PRODUCTION_FIXTURE_WRITE_CHALLENGE) {
    throw new Error("production_fixture_challenge_invalid");
  }
  return { ...CAGNOTTE_PRODUCTION_FIXTURE_CHALLENGE };
}

function singleOption(argv: readonly string[], prefix: string) {
  const matches = argv.filter((arg) => arg.startsWith(prefix));
  if (matches.length > 1) throw new Error("production_fixture_option_duplicate");
  return matches[0]?.slice(prefix.length);
}

function requestUrl(candidate: unknown, encrypted: boolean) {
  if (candidate instanceof URL) return candidate;
  if (typeof candidate === "string") return new URL(candidate, `${encrypted ? "https" : "http"}://localhost`);
  if (candidate && typeof candidate === "object" && "url" in candidate) {
    return new URL(String((candidate as { url: unknown }).url));
  }
  const options = (candidate || {}) as { protocol?: string; hostname?: string; host?: string; port?: string | number; path?: string };
  const protocol = options.protocol || (encrypted ? "https:" : "http:");
  const hostname = options.hostname || options.host || "localhost";
  const port = options.port ? `:${options.port}` : "";
  return new URL(`${protocol}//${hostname}${port}${options.path || "/"}`);
}

async function main() {
  const parsed = parseCli(process.argv.slice(2), process.env);
  const plan = buildCagnotteProductionFixturePlan({
    command: parsed.command,
    write: parsed.write,
    projectId: parsed.projectId,
  });
  console.log(JSON.stringify(plan, null, 2));
  if (!parsed.write) {
    console.log("DRY-RUN: aucune connexion Firebase et aucune ecriture.");
    console.log(`Challenge d'ecriture requis: ${CAGNOTTE_PRODUCTION_FIXTURE_WRITE_CHALLENGE}`);
    return;
  }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 && !(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  )) {
    throw new Error("production_fixture_explicit_admin_credential_required");
  }
  const capability = createCagnotteProductionFixtureCapability({
    challenge: parseChallenge(parsed.writeChallenge),
    assertExecutionEnvironment: () =>
      assertCagnotteProductionFixtureProductionEnvironment(process.env),
  });
  const restoreNetwork = installCagnotteProductionFixtureOutboundGuard();
  try {
    const auth = parsed.command === "inspect" ? undefined : getAdminAuth();
    const result = await runCagnotteProductionFixtureCommand({
      db: getAdminDb(),
      command: parsed.command,
      capability,
      firebaseProjectId: CAGNOTTE_PRODUCTION_FIXTURE_PROJECT_ID,
      auth,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    restoreNetwork();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "production_fixture_failed");
    process.exitCode = 1;
  });
}
