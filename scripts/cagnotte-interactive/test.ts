import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response as PlaywrightResponse,
} from "playwright";
import {
  localUrl,
  RECIPE_ACCOUNTS,
  RECIPE_ALLOWED_PORTS,
  RECIPE_CACHE_ROOT,
  RECIPE_PORTS,
  RECIPE_PRODUCT,
  RECIPE_PROGRAM_VERSION,
  RECIPE_PROJECT_ID,
} from "./constants.js";
import {
  ownedProcessReliabilitySnapshot,
  runRecipeScript,
  startRecipeHarness,
  type RecipeHarness,
} from "./harness.js";
import {
  configureOwnedResource,
  runWithViewportResources,
  type CleanupStepResult,
} from "./resourceLifecycle.js";
import {
  assertExpectedFailClosedApiUnavailable,
  assertNoUnexpectedRuntimeFailures,
  isFirestoreListen400Response,
  type ConsoleEvidence,
  type FirestoreListenProbeEvidence,
  type NetworkEvidence,
  type RequestShape,
  type ResponseSignature,
} from "./runtimeDiagnostics.js";
import { assertDiagnosticJournalComplete } from "./diagnosticJournal.js";

type RecipeState = {
  projectId: string;
  uid: string;
  wallet: null | {
    pendingCents: number;
    availableCents: number;
    reservedCents: number;
    regularizationCents: number;
  };
  orders: Array<{
    id: string;
    totalCents: number;
    paymentAmountCents: number;
    paymentStatus: string;
    orderStatus: string;
    programVersion: string;
    loyaltyCents: number;
    appliedCagnotteCents: number;
  }>;
  accruals: Array<{
    id: string;
    initialGainCents: number;
    remainingGainCents: number;
    compartment: string;
    paymentConfirmed: boolean;
    deliveryConfirmed: boolean;
  }>;
  reservations: Array<{
    id: string;
    amountCents: number;
    state: string;
    cumulativeRestitutedCents: number;
  }>;
  movements: Array<{
    id: string;
    orderId: string;
    businessEvent: string;
    pendingDeltaCents: number;
    availableDeltaCents: number;
    reservedDeltaCents: number;
    regularizationDeltaCents: number;
    recordedAtEpochMs: number;
  }>;
  refunds: Array<{
    id: string;
    orderId: string;
    totalFinancialCents: number;
    cagnotteRestitutionCents: number;
    cancelledGainCents: number;
  }>;
  rateLimits: Array<{
    kind: string;
    route: string;
    signalType: string;
    windowId: string;
    count: number;
  }>;
};

type ViewportDefinition = {
  label: "desktop" | "mobile";
  width: number;
  height: number;
};

type MonitoredContext = {
  context: BrowserContext;
  contextId: string;
  network: NetworkEvidence[];
  console: ConsoleEvidence[];
  setPhase: (phase: string) => void;
  currentPhase: () => string;
  pageId: (page: Page) => string;
  flushEvidence: () => Promise<void>;
  lastCagnotteAuthorization: () => string;
};

type EvidenceClock = {
  next: () => { sequence: number; occurredAtEpochMs: number };
};

const viewportDefinitions: ViewportDefinition[] = [
  { label: "desktop", width: 1440, height: 1000 },
  { label: "mobile", width: 390, height: 844 },
];
const allowedPorts = new Set<number>(RECIPE_ALLOWED_PORTS);
await mkdir(RECIPE_CACHE_ROOT, { recursive: true });
const latestEvidence = resolve(RECIPE_CACHE_ROOT, "latest-result.json");
const latestFailureEvidence = resolve(RECIPE_CACHE_ROOT, "latest-failure.json");
await Promise.all([
  rm(latestEvidence, { force: true }),
  rm(latestFailureEvidence, { force: true }),
]);
const executions: Array<Record<string, unknown>> = [];
let activeRunDirectory: string | undefined;
let browser: Browser | undefined;
let executionError: unknown;

try {
  browser = await chromium.launch({ headless: true });
  for (const viewport of viewportDefinitions) {
    executions.push(await runViewport(browser, viewport, (runDirectory) => {
      activeRunDirectory = runDirectory;
    }));
  }
} catch (error) {
  executionError = error;
  const failedRunDirectory = record(error).runDirectory;
  if (typeof failedRunDirectory === "string") activeRunDirectory = failedRunDirectory;
}

if (browser) {
  try {
    await closeBrowserBounded(browser);
  } catch (error) {
    console.error(`[cleanup:browser] ${safeError(error)}`);
    if (executionError === undefined) executionError = error;
  }
}

if (executionError !== undefined) {
  try {
    await writeFile(latestFailureEvidence, `${JSON.stringify({
      status: "FAIL",
      generatedAt: new Date().toISOString(),
      projectId: RECIPE_PROJECT_ID,
      origin: localUrl(RECIPE_PORTS.app),
      error: safeError(executionError),
      activeRunDirectory,
      completedExecutions: executions,
    }, null, 2)}\n`, "utf8");
    console.error(`Preuve interactive d’échec : ${latestFailureEvidence}`);
  } catch (evidenceError) {
    console.error(`[failure-evidence] ${safeError(evidenceError)}`);
  }
  throw executionError;
}

await writeFile(latestEvidence, `${JSON.stringify({
  status: "PASS",
  generatedAt: new Date().toISOString(),
  projectId: RECIPE_PROJECT_ID,
  origin: localUrl(RECIPE_PORTS.app),
  executions,
}, null, 2)}\n`, "utf8");
console.log(`Preuve interactive consolidée : ${latestEvidence}`);
console.log("Recette interactive locale réussie sur desktop et viewport mobile ; tous les processus sont arrêtés.");

async function runViewport(
  browserInstance: Browser,
  viewport: ViewportDefinition,
  onHarnessStarted: (runDirectory: string) => void,
) {
  let stoppedForFailClosed = false;
  let evidenceSequence = 0;
  let executionStatus: "running" | "pass" = "running";
  const screenshots: string[] = [];
  const stages: Array<{ label: string; state: RecipeState }> = [];
  const firestoreProbeEvidence: FirestoreListenProbeEvidence[] = [];
  const firestoreProbeId = `${viewport.label}-${process.pid}-${Date.now()}`;
  const evidenceClock: EvidenceClock = {
    next: () => ({ sequence: ++evidenceSequence, occurredAtEpochMs: Date.now() }),
  };
  return runWithViewportResources({
    label: viewport.label,
    startHarness: async () => {
      const harness = await startRecipeHarness(viewport.label);
      onHarnessStarted(harness.runDirectory);
      return harness;
    },
    createMonitor: (role) => monitoredContext(browserInstance, viewport, role, evidenceClock),
    createPage: (monitor) => monitor.context.newPage(),
    persistEvidence: async (resources) => {
      if (!resources.harness) return;
      const evidenceFailures: unknown[] = [];
      if (resources.clientPage && resources.clientMonitor) {
        try {
          await collectFirestoreProbeEvidence(
            resources.clientPage,
            resources.clientMonitor,
            evidenceClock,
            firestoreProbeEvidence,
          );
        } catch (error) {
          evidenceFailures.push(error);
        }
      }
      const evidenceWrites = await Promise.allSettled([
        persistBrowserEvidence(
          resources.harness,
          ...[resources.clientMonitor, resources.adminMonitor].filter(
            (monitor): monitor is MonitoredContext => Boolean(monitor),
          ),
        ),
        writeFile(
          resolve(resources.harness.runDirectory, "firestore-listen-probe.json"),
          `${JSON.stringify(firestoreProbeEvidence, null, 2)}\n`,
          "utf8",
        ),
        writeFile(
          resolve(resources.harness.runDirectory, "execution-summary.json"),
          `${JSON.stringify({
          status: executionStatus === "pass" ? "PASS" : "INTERRUPTED",
          viewport,
          runDirectory: resources.harness.runDirectory,
          currentPhases: {
            client: resources.clientMonitor?.currentPhase(),
            admin: resources.adminMonitor?.currentPhase(),
          },
          completedStages: stages.map(({ label, state }) => ({
            label,
            wallet: state.wallet,
            movements: state.movements.length,
          })),
          apiDiagnostics: resources.harness.diagnosticsSnapshot() ?? null,
          screenshots,
          listen400Incidents: [
            ...(resources.clientMonitor?.network ?? []),
            ...(resources.adminMonitor?.network ?? []),
          ].filter(isFirestoreListen400Response),
          }, null, 2)}\n`,
          "utf8",
        ),
      ]);
      evidenceFailures.push(...evidenceWrites
        .filter((entry): entry is PromiseRejectedResult => entry.status === "rejected")
        .map((entry) => entry.reason));
      if (evidenceFailures.length > 0) {
        throw new AggregateError(
          evidenceFailures,
          "Une ou plusieurs preuves interactives n’ont pas pu être enregistrées.",
        );
      }
    },
    closePage: (page) => page.close(),
    closeMonitor: (monitor) => monitor.context.close(),
    stopHarness: (harness) => harness.stop(),
    writeCleanupReport: async (report, resources) => {
      if (!resources.harness) return;
      await Promise.all([
        writeFile(
          resolve(resources.harness.runDirectory, "cleanup.json"),
          `${JSON.stringify({
            ...report,
            ownedProcesses: resources.harness.processes.map(ownedProcessReliabilitySnapshot),
          }, null, 2)}\n`,
          "utf8",
        ),
        persistSanitizedHarnessDiagnostics(resources.harness),
      ]);
    },
    onCleanupIssue: (step) => logCleanupIssue(viewport.label, step),
  }, async ({ harness, clientMonitor, adminMonitor, clientPage, adminPage }) => {
    await assertInitialOwnedProcessInventory(harness);
    const fixtures = JSON.parse(await readFile(resolve(harness.runDirectory, "fixtures.json"), "utf8")) as {
      projectId: string;
      productId: string;
      walletDocumentsInitiallyPresent: number;
      identities: {
        client1: { uid: string; email: string };
        client2: { uid: string; email: string };
        admin: { uid: string; email: string };
      };
    };
    assert.equal(fixtures.projectId, RECIPE_PROJECT_ID);
    assert.equal(fixtures.productId, RECIPE_PRODUCT.id);
    assert.equal(fixtures.walletDocumentsInitiallyPresent, 0);

    const initial = await inspectState(harness, `${viewport.label}-00-initial`, fixtures.identities.client1.uid);
    stages.push({ label: "initial", state: initial });
    assert.equal(initial.wallet, null, "aucun portefeuille ne doit être précrédité");
    assert.equal(initial.orders.length, 0);
    assert.equal(initial.movements.length, 0);
    assert.equal(initial.rateLimits.length, 0);

    clientMonitor.setPhase("client1-auth");
    await signIn(clientPage, RECIPE_ACCOUNTS.client1, async () => {
      await clientPage.evaluate(
        async ({ documentId, probeId }) => window.__VERDANZA_RECETTE__?.startFirestoreListenProbe(documentId, probeId),
        { documentId: RECIPE_PRODUCT.id, probeId: firestoreProbeId },
      );
    });
    await collectFirestoreProbeEvidence(
      clientPage,
      clientMonitor,
      evidenceClock,
      firestoreProbeEvidence,
    );
    await openAdvantages(clientPage, RECIPE_ACCOUNTS.client1.email);
    await waitForMainText(clientPage, (text) => text.includes("Portefeuille non créé"), "portefeuille initial absent");
    await assertRecipeBanner(clientPage);
    await capture(clientPage, harness, viewport, "01-portefeuille-vide", screenshots);

    const orderAResponse = await createOrderThroughUi(clientPage, false, viewport.label);
    const orderAId = orderAResponse.orderId;
    assert.deepEqual({
      total: orderAResponse.total,
      paymentAmount: orderAResponse.paymentAmount,
      paymentStatus: orderAResponse.paymentStatus,
      orderStatus: orderAResponse.orderStatus,
      cagnotteUse: orderAResponse.cagnotteUse ?? null,
    }, {
      total: 100,
      paymentAmount: 100,
      paymentStatus: "to_confirm",
      orderStatus: "contact_required",
      cagnotteUse: null,
    });

    const aCreated = await inspectState(harness, `${viewport.label}-01-a-created`, fixtures.identities.client1.uid);
    stages.push({ label: "A créée", state: aCreated });
    assert.equal(aCreated.wallet, null);
    assertOrder(aCreated, orderAId, {
      totalCents: 10_000,
      paymentAmountCents: 10_000,
      loyaltyCents: 500,
      appliedCagnotteCents: 0,
      paymentStatus: "to_confirm",
      orderStatus: "contact_required",
    });
    assertRateLimiter(aCreated, 1);

    adminMonitor.setPhase("admin-auth");
    await signIn(adminPage, RECIPE_ACCOUNTS.admin);
    await openAdminOrders(adminPage, "Toutes");
    await assertRecipeBanner(adminPage);
    assert.equal(await clientPage.url().includes("127.0.0.1"), true, "le contexte client doit rester indépendant");

    adminMonitor.setPhase("admin-a-payment");
    await updateOrder(adminPage, orderAId, "payment", "paid");
    clientMonitor.setPhase("client-a-pending");
    await openAdvantages(clientPage, RECIPE_ACCOUNTS.client1.email);
    await refreshAdvantages(clientPage);
    await waitForBalance(clientPage, "En attente", "5,00 €");
    await waitForBalance(clientPage, "Disponible", "0,00 €");
    await capture(clientPage, harness, viewport, "02-gain-a-en-attente", screenshots);
    const aPaid = await inspectState(harness, `${viewport.label}-02-a-paid`, fixtures.identities.client1.uid);
    stages.push({ label: "A payée", state: aPaid });
    assertWallet(aPaid, [500, 0, 0, 0]);
    assertAccrual(aPaid, orderAId, [500, 500, "pending", true, false]);
    assert.equal(aPaid.movements.length, 1);

    adminMonitor.setPhase("admin-a-delivery");
    await updateOrder(adminPage, orderAId, "order", "delivered");
    clientMonitor.setPhase("client-a-available");
    await openAdvantages(clientPage, RECIPE_ACCOUNTS.client1.email);
    await refreshAdvantages(clientPage);
    await waitForBalance(clientPage, "En attente", "0,00 €");
    await waitForBalance(clientPage, "Disponible", "5,00 €");
    await capture(clientPage, harness, viewport, "03-gain-a-disponible", screenshots);
    const aDelivered = await inspectState(harness, `${viewport.label}-03-a-delivered`, fixtures.identities.client1.uid);
    stages.push({ label: "A livrée", state: aDelivered });
    assertWallet(aDelivered, [0, 500, 0, 0]);
    assertAccrual(aDelivered, orderAId, [500, 500, "available", true, true]);
    assert.equal(aDelivered.movements[0]?.businessEvent, "payment_confirmed");
    assert.deepEqual(
      aDelivered.movements.slice(1).map((entry) => entry.businessEvent).sort(),
      ["delivery_confirmed", "made_available"].sort(),
    );
    assert.equal(
      aDelivered.movements[1]?.recordedAtEpochMs,
      aDelivered.movements[2]?.recordedAtEpochMs,
      "livraison et mise à disposition doivent partager l'horodatage atomique",
    );

    clientMonitor.setPhase("client-b-checkout");
    const orderBResponse = await createOrderThroughUi(clientPage, true, viewport.label, async () => {
      await capture(clientPage, harness, viewport, "04-devis-b-95-euros", screenshots);
    });
    const orderBId = orderBResponse.orderId;
    assert.deepEqual({
      total: orderBResponse.total,
      paymentAmount: orderBResponse.paymentAmount,
      paymentStatus: orderBResponse.paymentStatus,
      orderStatus: orderBResponse.orderStatus,
      cagnotteUse: orderBResponse.cagnotteUse,
    }, {
      total: 100,
      paymentAmount: 95,
      paymentStatus: "to_confirm",
      orderStatus: "contact_required",
      cagnotteUse: { amountCents: 500, state: "reserved" },
    });
    await openAdvantages(clientPage, RECIPE_ACCOUNTS.client1.email);
    await waitForBalance(clientPage, "Disponible", "0,00 €");
    await waitForBalance(clientPage, "Réservé", "5,00 €");
    await capture(clientPage, harness, viewport, "05-reservation-b", screenshots);
    const bReserved = await inspectState(harness, `${viewport.label}-04-b-reserved`, fixtures.identities.client1.uid);
    stages.push({ label: "B réservée", state: bReserved });
    assertWallet(bReserved, [0, 0, 500, 0]);
    assertOrder(bReserved, orderBId, {
      totalCents: 10_000,
      paymentAmountCents: 9_500,
      loyaltyCents: 475,
      appliedCagnotteCents: 500,
      paymentStatus: "to_confirm",
      orderStatus: "contact_required",
    });
    assertReservation(bReserved, orderBId, [500, "reserved", 0]);
    assert.equal(bReserved.movements.length, 4);
    assertRateLimiter(bReserved, 2);

    adminMonitor.setPhase("admin-b-payment");
    await openAdminOrders(adminPage, "Toutes");
    await updateOrder(adminPage, orderBId, "payment", "paid");
    clientMonitor.setPhase("client-b-pending");
    await openAdvantages(clientPage, RECIPE_ACCOUNTS.client1.email);
    await refreshAdvantages(clientPage);
    await waitForBalance(clientPage, "En attente", "4,75 €");
    await waitForBalance(clientPage, "Réservé", "0,00 €");
    const bPaid = await inspectState(harness, `${viewport.label}-05-b-paid`, fixtures.identities.client1.uid);
    stages.push({ label: "B payée", state: bPaid });
    assertWallet(bPaid, [475, 0, 0, 0]);
    assertAccrual(bPaid, orderBId, [475, 475, "pending", true, false]);
    assertReservation(bPaid, orderBId, [500, "consumed", 0]);
    assert.equal(bPaid.movements.length, 6);

    adminMonitor.setPhase("admin-b-delivery");
    await updateOrder(adminPage, orderBId, "order", "delivered");
    clientMonitor.setPhase("client-b-available");
    await openAdvantages(clientPage, RECIPE_ACCOUNTS.client1.email);
    await refreshAdvantages(clientPage);
    await waitForBalance(clientPage, "Disponible", "4,75 €");
    const bDelivered = await inspectState(harness, `${viewport.label}-06-b-delivered`, fixtures.identities.client1.uid);
    stages.push({ label: "B livrée", state: bDelivered });
    assertWallet(bDelivered, [0, 475, 0, 0]);
    assertAccrual(bDelivered, orderBId, [475, 475, "available", true, true]);
    assert.equal(bDelivered.movements.length, 8);

    adminMonitor.setPhase("admin-b-refund");
    await openAdminOrders(adminPage, "Livrées");
    await recordFullRefund(adminPage, orderBId, viewport.label);
    await capture(adminPage, harness, viewport, "06-remboursement-b-admin", screenshots);
    clientMonitor.setPhase("client-final-wallet");
    await openAdvantages(clientPage, RECIPE_ACCOUNTS.client1.email);
    await refreshAdvantages(clientPage);
    await waitForBalance(clientPage, "Disponible", "5,00 €");
    await waitForBalance(clientPage, "En attente", "0,00 €");
    await waitForBalance(clientPage, "Réservé", "0,00 €");
    await waitForMainText(clientPage, (text) => text.includes("Cagnotte restituée après retour"), "restitution visible dans l’historique");
    await capture(clientPage, harness, viewport, "07-solde-final-5-euros", screenshots);
    const refunded = await inspectState(harness, `${viewport.label}-07-b-refunded`, fixtures.identities.client1.uid);
    stages.push({ label: "B remboursée", state: refunded });
    assertWallet(refunded, [0, 500, 0, 0]);
    assertAccrual(refunded, orderBId, [475, 0, "available", true, true]);
    assertReservation(refunded, orderBId, [500, "consumed", 500]);
    assert.equal(refunded.movements.length, 10);
    assert.equal(refunded.refunds.length, 1);
    assert.deepEqual(pickRefund(refunded.refunds[0]), {
      orderId: orderBId,
      totalFinancialCents: 9_500,
      cagnotteRestitutionCents: 500,
      cancelledGainCents: 475,
    });

    clientMonitor.setPhase("client-account-switch");
    await signOut(clientPage);
    await signIn(clientPage, RECIPE_ACCOUNTS.client2);
    await openAdvantages(clientPage, RECIPE_ACCOUNTS.client2.email);
    await waitForMainText(clientPage, (text) => text.includes("Portefeuille non créé"), "second portefeuille absent");
    const client2Text = await mainText(clientPage);
    assert.equal(client2Text.includes(RECIPE_ACCOUNTS.client1.email), false, "le premier compte ne doit pas rester affiché");

    clientMonitor.setPhase("negative-auth-checks");
    const authorization = clientMonitor.lastCagnotteAuthorization();
    assert.match(authorization, /^Bearer\s+\S+$/, "un jeton Auth Emulator doit avoir accompagné la lecture client 2");
    const negativeResponses = await clientPage.evaluate(async ({ auth, targetUid, orderId }) => {
      const foreignSelfResponse = await fetch(`/api/cagnotte?scope=self&targetUid=${encodeURIComponent(targetUid)}`, {
        headers: { authorization: auth },
      });
      const foreignAdminResponse = await fetch(`/api/cagnotte?scope=admin&targetUid=${encodeURIComponent(targetUid)}`, {
        headers: { authorization: auth },
      });
      const adminMutationResponse = await fetch("/api/update-order-status", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: JSON.stringify({ orderId, paymentStatus: "paid", finalPaymentMethod: "card_payment_link" }),
      });
      return {
        foreignSelf: { status: foreignSelfResponse.status, body: await foreignSelfResponse.json() },
        foreignAdmin: { status: foreignAdminResponse.status, body: await foreignAdminResponse.json() },
        adminMutation: { status: adminMutationResponse.status, body: await adminMutationResponse.json() },
      };
    }, { auth: authorization, targetUid: fixtures.identities.client1.uid, orderId: orderBId });
    assert.equal(negativeResponses.foreignSelf.status, 403);
    assert.equal(record(negativeResponses.foreignSelf.body).code, "foreign_account_forbidden");
    assert.equal(negativeResponses.foreignAdmin.status, 403);
    assert.equal(record(negativeResponses.foreignAdmin.body).code, "admin_required");
    assert.equal(negativeResponses.adminMutation.status, 403);

    const directFirestoreDenial = await clientPage.evaluate(async (targetUid) => {
      try {
        const result = await window.__VERDANZA_RECETTE__?.readWalletDocument(targetUid);
        return { denied: false, result };
      } catch (error) {
        const value = error as { code?: string; message?: string };
        return { denied: true, code: value.code || "", message: value.message || "" };
      }
    }, fixtures.identities.client1.uid);
    assert.equal(directFirestoreDenial.denied, true, "les règles Firestore doivent refuser le portefeuille étranger");
    assert.match(String(directFirestoreDenial.code), /permission-denied/);
    const afterNegative = await inspectState(harness, `${viewport.label}-08-negative-denials`, fixtures.identities.client1.uid);
    assert.deepEqual(afterNegative, refunded, "les refus client/non-admin ne doivent modifier aucune donnée métier");

    await signOut(clientPage);
    await signIn(clientPage, RECIPE_ACCOUNTS.client1);
    await openAdvantages(clientPage, RECIPE_ACCOUNTS.client1.email);
    await waitForBalance(clientPage, "Disponible", "5,00 €");
    clientMonitor.setPhase("firestore-listen-recovery");
    const recoveryGeneration = `recovery-${viewport.label}-${Date.now()}`;
    await runRecipeScript(
      harness,
      `${viewport.label}-touch-listen-probe`,
      "scripts/cagnotte-interactive/touchListenProbe.ts",
      [recoveryGeneration],
    );
    let recoveryWaitError: unknown;
    try {
      await clientPage.waitForFunction(
        (generation) => window.__VERDANZA_RECETTE__?.readFirestoreListenProbe()
          .some((entry) => entry.generation === generation && entry.fromCache === false && entry.hasPendingWrites === false),
        recoveryGeneration,
      );
    } catch (error) {
      recoveryWaitError = error;
    }
    try {
      await collectFirestoreProbeEvidence(
        clientPage,
        clientMonitor,
        evidenceClock,
        firestoreProbeEvidence,
      );
    } catch (evidenceError) {
      if (recoveryWaitError === undefined) throw evidenceError;
      console.error(`[firestore-probe-evidence] ${safeError(evidenceError)}`);
    }
    if (recoveryWaitError !== undefined) throw recoveryWaitError;
    clientMonitor.setPhase("client-final-reload");
    await clientPage.reload({ waitUntil: "domcontentloaded" });
    await clientPage.getByRole("heading", { name: "Mes avantages" }).waitFor();
    await waitForBalance(clientPage, "Disponible", "5,00 €");
    assert.match(await mainText(clientPage), new RegExp(escapeRegex(RECIPE_ACCOUNTS.client1.email)));

    await Promise.all([clientMonitor.flushEvidence(), adminMonitor.flushEvidence()]);
    const runtimeIsolation = assertNoUnexpectedRuntimeFailures(
      [...clientMonitor.network, ...adminMonitor.network],
      [...clientMonitor.console, ...adminMonitor.console],
      firestoreProbeEvidence,
    );
    assert.deepEqual(await clientPage.evaluate(() => window.__VERDANZA_RECETTE_NETWORK__ ?? []), []);
    assert.deepEqual(await adminPage.evaluate(() => window.__VERDANZA_RECETTE_NETWORK__ ?? []), []);

    clientMonitor.setPhase("fail-closed-api-unavailable");
    const failClosedNetworkStart = clientMonitor.network.length;
    const failClosedConsoleStart = clientMonitor.console.length;
    const apiDiagnostics = await harness.finalizeDiagnostics();
    assertDiagnosticJournalComplete(apiDiagnostics);
    await harness.stopService("local-api");
    stoppedForFailClosed = true;
    await clientPage.getByRole("button", { name: "Actualiser" }).click();
    await waitForMainText(
      clientPage,
      (text) => text.includes("Historique indisponible. Aucun solde ne peut être affiché pour le moment."),
      "erreur explicite sans solde inventé quand l’API locale est arrêtée",
    );
    await capture(clientPage, harness, viewport, "08-api-indisponible-fail-closed", screenshots);
    assert.deepEqual(await clientPage.evaluate(() => window.__VERDANZA_RECETTE_NETWORK__ ?? []), []);
    await clientMonitor.flushEvidence();
    const failClosedEvidence = assertExpectedFailClosedApiUnavailable(
      clientMonitor.network.slice(failClosedNetworkStart),
      clientMonitor.console.slice(failClosedConsoleStart),
      { contextId: clientMonitor.contextId, pageId: clientMonitor.pageId(clientPage) },
    );

    await persistBrowserEvidence(harness, clientMonitor, adminMonitor);
    const apiRequests = await readJsonLines(resolve(harness.runDirectory, "api-requests.jsonl"));
    assertApiRequestLog(apiRequests);
    const serverBlocks = await readJsonLines(resolve(harness.runDirectory, "server-network-blocks.jsonl"), true);
    assertServerNetworkIsolation(serverBlocks);

    const result = {
      viewport,
      runDirectory: harness.runDirectory,
      projectId: RECIPE_PROJECT_ID,
      origin: localUrl(RECIPE_PORTS.app),
      auth: {
        emulator: localUrl(RECIPE_PORTS.auth),
        realForms: [RECIPE_ACCOUNTS.client1.email, RECIPE_ACCOUNTS.client2.email, RECIPE_ACCOUNTS.admin.email],
      },
      firestoreEmulator: localUrl(RECIPE_PORTS.firestore),
      orders: { A: orderAId, B: orderBId },
      observed: {
        orderA: { grossCents: 10_000, externalPaymentCents: 10_000, gainCents: 500 },
        orderB: { grossCents: 10_000, usedCagnotteCents: 500, externalPaymentCents: 9_500, gainCents: 475 },
        refundB: { externalFinancialCents: 9_500, restoredCagnotteCents: 500, cancelledGainCents: 475 },
        finalWallet: refunded.wallet,
        movements: refunded.movements.length,
        rateLimitDocuments: refunded.rateLimits.length,
      },
      denials: {
        foreignSelf: negativeResponses.foreignSelf.status,
        foreignAdmin: negativeResponses.foreignAdmin.status,
        nonAdminMutation: negativeResponses.adminMutation.status,
        directFirestore: directFirestoreDenial.code,
      },
      failClosedApiUnavailable: true,
      failClosedEvidence,
      diagnostics: {
        business: "PASS",
        journal: apiDiagnostics,
      },
      blockedBrowserDestinations: runtimeIsolation.blockedBrowserDestinations,
      firestoreTransportRecoveries: runtimeIsolation.firestoreTransportRecoveries,
      screenshots,
      networkEvidence: resolve(harness.runDirectory, "browser-network.json"),
      consoleEvidence: resolve(harness.runDirectory, "browser-console.json"),
      apiEvidence: resolve(harness.runDirectory, "api-requests.jsonl"),
      serverBlockedDestinations: serverBlocks,
      stages: stages.map(({ label, state }) => ({
        label,
        wallet: state.wallet,
        movements: state.movements.length,
      })),
    };
    await writeFile(resolve(harness.runDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    executionStatus = "pass";
    return result;
  }).finally(() => {
    if (!stoppedForFailClosed) console.log(`${viewport.label}: arrêt de sécurité appliqué avant la fin du scénario.`);
  });
}

async function assertInitialOwnedProcessInventory(harness: RecipeHarness) {
  const expected = [
    ["firebase-emulators", "service"],
    ["seed", "one-shot"],
    ["warm-firestore-listen", "one-shot"],
    ["local-api", "service"],
    ["vite-app", "service"],
  ];
  assert.deepEqual(
    harness.processes.map((entry) => [entry.name, entry.kind]),
    expected,
    "chaque service et one-shot initial doit être enregistré comme processus possédé",
  );
  assert.equal(
    new Set(harness.processes.map((entry) => entry.child.pid)).size,
    expected.length,
    "chaque processus possédé doit avoir une identité distincte",
  );
  const manifest = JSON.parse(await readFile(resolve(harness.runDirectory, "processes.json"), "utf8")) as {
    ports?: Record<string, number>;
    processes?: Array<{ name?: string; kind?: string; pid?: number }>;
  };
  assert.deepEqual(Object.values(manifest.ports ?? {}).sort((a, b) => a - b), Object.values(RECIPE_PORTS).sort((a, b) => a - b));
  assert.deepEqual(
    manifest.processes?.map((entry) => [entry.name, entry.kind, entry.pid]),
    harness.processes.map((entry) => [entry.name, entry.kind, entry.child.pid]),
    "le manifeste doit correspondre aux processus réellement possédés",
  );
}

async function monitoredContext(
  browserInstance: Browser,
  viewport: ViewportDefinition,
  role: string,
  evidenceClock: EvidenceClock,
): Promise<MonitoredContext> {
  const network: NetworkEvidence[] = [];
  const console: ConsoleEvidence[] = [];
  const contextId = `${viewport.label}:${role}`;
  const pageIds = new WeakMap<Page, string>();
  const requestIds = new WeakMap<Request, string>();
  const pendingEvidence = new Set<Promise<void>>();
  let pageCount = 0;
  let requestCount = 0;
  let phase = `${role}-boot`;
  let lastCagnotteAuthorization = "";
  const pageId = (page: Page) => {
    const existing = pageIds.get(page);
    if (existing) return existing;
    const created = `${contextId}:page-${++pageCount}`;
    pageIds.set(page, created);
    return created;
  };
  const requestId = (request: Request) => {
    const existing = requestIds.get(request);
    if (existing) return existing;
    const created = `${contextId}:request-${++requestCount}`;
    requestIds.set(request, created);
    return created;
  };
  const requestPageId = (request: Request) => {
    try {
      return pageId(request.frame().page());
    } catch {
      return undefined;
    }
  };
  const context = await configureOwnedResource({
    label: `${contextId}-context`,
    create: () => browserInstance.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      locale: "fr-FR",
    }),
    configure: async (ownedContext) => {
      await ownedContext.route("**/*", async (route) => {
        const request = route.request();
        const parsed = safeUrl(request.url());
        if (!parsed || isNonNetworkProtocol(parsed)) return route.continue();
        if (!isAllowedLocalUrl(parsed)) {
          network.push(networkEntry({
            phase,
            contextId,
            pageId: requestPageId(request),
            clock: evidenceClock,
            requestId: requestId(request),
            direction: "request",
            url: parsed,
            request,
            blocked: true,
          }));
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      });
      ownedContext.on("request", (request) => {
        const parsed = safeUrl(request.url());
        if (!parsed || isNonNetworkProtocol(parsed)) return;
        if (parsed.pathname === "/api/cagnotte") {
          const authorization = request.headers().authorization || "";
          if (authorization.startsWith("Bearer ")) lastCagnotteAuthorization = authorization;
        }
        if (isAllowedLocalUrl(parsed)) network.push(networkEntry({
          phase,
          contextId,
          pageId: requestPageId(request),
          clock: evidenceClock,
          requestId: requestId(request),
          direction: "request",
          url: parsed,
          request,
        }));
      });
      ownedContext.on("response", (response) => {
        const parsed = safeUrl(response.url());
        if (!parsed || isNonNetworkProtocol(parsed)) return;
        const request = response.request();
        const evidence = networkEntry({
          phase,
          contextId,
          pageId: requestPageId(request),
          clock: evidenceClock,
          requestId: requestId(request),
          direction: "response",
          url: parsed,
          request,
          status: response.status(),
        });
        network.push(evidence);
        if (isFirestoreListen400Response(evidence)) {
          const task = captureResponseSignature(response)
            .then((signature) => { evidence.responseSignature = signature; })
            .finally(() => { pendingEvidence.delete(task); });
          pendingEvidence.add(task);
        }
      });
      ownedContext.on("page", (page) => {
        const ownedPageId = pageId(page);
        page.on("console", (message) => console.push(consoleEntry({
          phase,
          contextId,
          pageId: ownedPageId,
          clock: evidenceClock,
          message,
        })));
        page.on("pageerror", (error) => console.push({
          phase,
          contextId,
          pageId: ownedPageId,
          ...evidenceClock.next(),
          source: "pageerror",
          type: "error",
          text: sanitizedConsoleText(error.message),
        }));
        page.on("websocket", (socket) => {
          const parsed = safeUrl(socket.url());
          if (parsed) network.push({
            phase,
            contextId,
            pageId: ownedPageId,
            ...evidenceClock.next(),
            requestId: `${contextId}:websocket-${++requestCount}`,
            direction: "websocket",
            origin: parsed.origin,
            pathname: parsed.pathname,
            blocked: !isAllowedLocalUrl(parsed, true),
          });
        });
      });
    },
    close: (ownedContext) => ownedContext.close(),
    onCleanupIssue: (step) => logCleanupIssue(viewport.label, step),
  });
  return {
    context,
    contextId,
    network,
    console,
    setPhase(value) { phase = value; },
    currentPhase() { return phase; },
    pageId,
    async flushEvidence() {
      while (pendingEvidence.size > 0) await Promise.allSettled([...pendingEvidence]);
    },
    lastCagnotteAuthorization() { return lastCagnotteAuthorization; },
  };
}

async function persistBrowserEvidence(
  harness: RecipeHarness,
  ...monitors: MonitoredContext[]
) {
  await Promise.all(monitors.map((monitor) => monitor.flushEvidence()));
  await Promise.all([
    writeFile(resolve(harness.runDirectory, "browser-network.json"), `${JSON.stringify(
      monitors.flatMap((monitor) => monitor.network),
      null,
      2,
    )}\n`, "utf8"),
    writeFile(resolve(harness.runDirectory, "browser-console.json"), `${JSON.stringify(
      monitors.flatMap((monitor) => monitor.console),
      null,
      2,
    )}\n`, "utf8"),
  ]);
}

async function collectFirestoreProbeEvidence(
  page: Page,
  monitor: MonitoredContext,
  clock: EvidenceClock,
  target: FirestoreListenProbeEvidence[],
) {
  const browserEvidence = await page.evaluate(
    () => window.__VERDANZA_RECETTE__?.readFirestoreListenProbe() ?? [],
  );
  const ownedPageId = monitor.pageId(page);
  for (const entry of browserEvidence) {
    const duplicate = target.some((existing) => (
      existing.probeId === entry.probeId &&
      existing.generation === entry.generation &&
      existing.occurredAtEpochMs === entry.receivedAtEpochMs &&
      existing.terminalErrorCode === entry.terminalErrorCode
    ));
    if (duplicate) continue;
    const order = clock.next();
    target.push({
      phase: monitor.currentPhase(),
      contextId: monitor.contextId,
      pageId: ownedPageId,
      sequence: order.sequence,
      occurredAtEpochMs: entry.receivedAtEpochMs,
      probeId: entry.probeId,
      generation: entry.generation,
      fromCache: entry.fromCache,
      hasPendingWrites: entry.hasPendingWrites,
      ...(entry.terminalErrorCode ? { terminalErrorCode: entry.terminalErrorCode } : {}),
    });
  }
}

async function signIn(
  page: Page,
  account: { email: string; password: string },
  afterNavigation?: () => Promise<void>,
) {
  await goto(page, "/connexion");
  await afterNavigation?.();
  const ageConfirmed = await page.evaluate(() => (
    window.localStorage.getItem("verdanza-age-confirmed") === "true"
  ));
  const ageButton = page.getByRole("button", { name: "J'ai 18 ans ou plus", exact: true });
  if (!ageConfirmed) {
    await ageButton.waitFor({ state: "visible", timeout: 15_000 });
    await ageButton.click();
    await ageButton.waitFor({ state: "detached", timeout: 5_000 });
  }
  const rejectCookies = page.getByRole("button", { name: "Tout refuser" });
  if (await rejectCookies.waitFor({ state: "visible", timeout: 2_000 }).then(() => true).catch(() => false)) {
    await rejectCookies.click();
  }
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  try {
    await page.waitForURL((url) => url.pathname === "/compte" || url.pathname.startsWith("/compte/"), { timeout: 20_000 });
  } catch (error) {
    console.error(`Échec du formulaire Auth Emulator (${page.url()}) : ${(await mainText(page)).slice(0, 1_500)}`);
    throw error;
  }
}

async function signOut(page: Page) {
  await goto(page, "/compte/avantages");
  await page.getByRole("heading", { name: "Mes avantages" }).waitFor();
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/connexion", { timeout: 15_000 }),
    page.getByRole("button", { name: "Deconnexion" }).click(),
  ]);
}

async function openAdvantages(page: Page, email: string) {
  await goto(page, "/compte/avantages");
  await page.getByRole("heading", { name: "Mes avantages" }).waitFor({ timeout: 15_000 });
  await waitForMainText(page, (text) => text.includes(email), `session visible pour ${email}`);
}

async function refreshAdvantages(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => {
      const url = safeUrl(candidate.url());
      return candidate.request().method() === "GET" && url?.pathname === "/api/cagnotte";
    }, { timeout: 15_000 }),
    page.getByRole("button", { name: "Actualiser" }).click(),
  ]);
  assert.equal(response.status(), 200, "la lecture cagnotte locale doit répondre 200");
}

async function createOrderThroughUi(
  page: Page,
  useCagnotte: boolean,
  label: string,
  beforeSubmit?: () => Promise<void>,
) {
  await goto(page, "/boutique");
  await page.getByRole("heading", { name: "Boutique CBD" }).waitFor();
  await page.getByRole("button", { name: "Ajouter 1 g — 100,00 €" }).click();
  await page.waitForFunction((productId) => {
    try {
      const items = JSON.parse(window.localStorage.getItem("verdanza-cart") || "[]") as Array<{
        productId?: string;
        quantity?: number;
      }>;
      return items.some((item) => item.productId === productId && Number(item.quantity) >= 1);
    } catch {
      return false;
    }
  }, RECIPE_PRODUCT.id, { timeout: 10_000 });
  await goto(page, "/panier");
  await page.getByRole("heading", { name: "Panier" }).waitFor();
  await waitForMainText(page, (text) => text.includes(RECIPE_PRODUCT.name) && text.includes("100,00 EUR"), "panier fictif à 100 euros");
  if (useCagnotte) await waitForBalance(page, "Disponible", "5,00 €");
  await page.getByRole("link", { name: "Continuer" }).click();
  await page.waitForURL((url) => url.pathname === "/checkout");
  await page.getByRole("heading", { name: "Finaliser ma commande" }).waitFor();
  await page.getByLabel("Prénom", { exact: true }).fill("Client");
  await page.getByLabel("Nom", { exact: true }).fill("Fictif");
  await page.getByLabel("Téléphone", { exact: true }).fill(label === "desktop" ? "0600000101" : "0600000202");
  await page.getByLabel("Adresse", { exact: true }).fill("1 rue Fictive");
  await page.getByLabel("Code postal", { exact: true }).fill("13100");
  await page.getByLabel("Ville", { exact: true }).fill("Aix-en-Provence");
  await page.getByLabel("Pays", { exact: true }).fill("France");

  if (useCagnotte) {
    await waitForBalance(page, "Disponible", "5,00 €");
    const [quoteResponse] = await Promise.all([
      page.waitForResponse((candidate) => safeUrl(candidate.url())?.pathname === "/api/quote-order" && candidate.request().method() === "POST"),
      page.getByRole("checkbox", { name: "Utiliser ma cagnotte" }).check(),
    ]);
    assert.equal(quoteResponse.status(), 200);
    await waitForMainText(page, (text) =>
      text.includes("Financé par votre cagnotte") &&
      text.includes("À régler hors cagnotte") &&
      text.includes("95,00 €") &&
      text.includes("Gain estimé après paiement et livraison : 4,75 €"), "devis B 5/95/4,75");
    await page.getByRole("button", { name: /Accepter.*95,00/ }).click();
    await page.getByRole("button", { name: /Montant accepté.*95,00/ }).waitFor();
  }

  await page.getByRole("checkbox", { name: /Je confirme être majeur/ }).check();
  await beforeSubmit?.();
  await page.waitForTimeout(950);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => safeUrl(candidate.url())?.pathname === "/api/create-order" && candidate.request().method() === "POST", { timeout: 20_000 }),
    page.getByRole("button", { name: /Valider (?:ma commande|la commande)/ }).click(),
  ]);
  const body = await response.json() as {
    orderId: string;
    total: number;
    paymentAmount: number;
    paymentStatus: string;
    orderStatus: string;
    cagnotteUse?: { amountCents: number; state: string };
  };
  assert.equal(response.status(), 200, JSON.stringify(body));
  assert.match(body.orderId, /^[A-Za-z0-9_-]{8,}$/);
  await page.waitForURL((url) => url.pathname === "/checkout/success", { timeout: 20_000 });
  await page.getByRole("heading", { name: "Commande enregistrée" }).waitFor({ timeout: 15_000 });
  if (useCagnotte) {
    await waitForMainText(page, (text) =>
      text.includes("Financement prévu par cagnotte : 5,00 EUR") &&
      text.includes("À régler hors cagnotte : 95,00 EUR"), "récapitulatif B réservé");
  }
  return body;
}

async function openAdminOrders(page: Page, filter: "Toutes" | "Livrées") {
  const wasAlreadyOpen = safeUrl(page.url())?.pathname === "/admin/commandes";
  await goto(page, "/admin/commandes");
  await page.getByRole("heading", { name: "Commandes" }).waitFor({ timeout: 20_000 });
  const loading = page.getByText("Chargement des donnees...", { exact: true });
  if (wasAlreadyOpen) {
    await page.getByRole("button", { name: "Rafraichir", exact: true }).click();
    await loading.waitFor({ state: "visible", timeout: 5_000 });
  }
  await loading.waitFor({ state: "hidden", timeout: 20_000 });
  const filterButton = page.getByRole("button", { name: filter, exact: true });
  await filterButton.waitFor({ state: "visible", timeout: 20_000 });
  await filterButton.click();
}

async function updateOrder(
  page: Page,
  orderId: string,
  kind: "payment" | "order",
  value: "paid" | "delivered",
) {
  const card = await visibleOrderCard(page, orderId);
  const selector = kind === "payment"
    ? card.locator('select:has(option[value="paid"])')
    : card.locator('select:has(option[value="delivered"])');
  page.once("dialog", (dialog) => void dialog.accept(kind === "payment" ? "card_payment_link" : "Recette locale fictive"));
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => safeUrl(candidate.url())?.pathname === "/api/update-order-status" && candidate.request().method() === "POST", { timeout: 20_000 }),
    selector.selectOption(value),
  ]);
  const body = await response.text();
  assert.equal(response.status(), 200, `${kind} ${orderId}: ${body}`);
  await page.waitForTimeout(350);
}

async function recordFullRefund(page: Page, orderId: string, viewport: string) {
  const card = await visibleOrderCard(page, orderId);
  const tools = card.locator('section[aria-label="Outils administratifs de cagnotte"]');
  await tools.waitFor({ state: "visible", timeout: 20_000 });
  await tools.getByRole("heading", { name: "Enregistrer un remboursement déjà confirmé" }).waitFor();
  await tools.getByRole("button", { name: "Tout le montant restant" }).click();
  await tools.getByLabel("Montant financier déclaré (€)", { exact: true }).fill("95,00");
  await tools.getByLabel("Référence métier", { exact: true }).fill(`recette-interactive-${viewport}`);
  await setDateTimeLocal(
    tools.getByLabel("Date de confirmation", { exact: true }),
    recentLocalDateTime(),
  );
  const [preview] = await Promise.all([
    page.waitForResponse((candidate) => isJsonAction(candidate, "/api/order-refunds", "preview")),
    tools.getByRole("button", { name: "Prévisualiser sur le serveur" }).click(),
  ]);
  const previewJson = await preview.json();
  assert.equal(preview.status(), 200, JSON.stringify(previewJson));
  const previewBody = record(record(previewJson).result);
  assert.deepEqual([
    previewBody.totalFinancialCents,
    previewBody.cagnotteRestitutionCents,
    record(previewBody.correction).theoreticalCents,
  ], [9_500, 500, 475]);
  await tools.getByText("Conséquences calculées par le serveur", { exact: true }).waitFor();
  await tools.getByText("Prévisualisation serveur prête.", { exact: true }).waitFor();
  const confirmButton = tools.getByRole("button", { name: "Confirmer l’enregistrement" });
  await waitForButtonEnabled(confirmButton);
  await page.waitForTimeout(100);
  let confirmed: PlaywrightResponse;
  try {
    [confirmed] = await Promise.all([
      page.waitForResponse((candidate) => isJsonAction(candidate, "/api/order-refunds", "record_confirmed")),
      confirmButton.click(),
    ]);
  } catch (error) {
    throw new Error(
      `La confirmation admin n'a émis aucune déclaration. disabled=${await confirmButton.isDisabled().catch(() => true)}; ` +
      `texte=${(await tools.innerText().catch(() => "indisponible")).slice(0, 2_000)}`,
      { cause: error },
    );
  }
  const confirmedJson = await confirmed.json();
  assert.equal(confirmed.status(), 200, JSON.stringify(confirmedJson));
  const confirmedBody = record(record(confirmedJson).result);
  assert.deepEqual([
    confirmedBody.totalFinancialCents,
    confirmedBody.cagnotteRestitutionCents,
    record(confirmedBody.correction).appliedCents,
    record(confirmedBody.restitution).availableIncreaseCents,
  ], [9_500, 500, 475, 500]);
  await waitForMainText(page, (text) =>
    text.includes("REMBOURSEMENT/CORRECTION ENREGISTRÉ") &&
    /Remboursement financier enregistré\s+95,00 EUR/.test(text) &&
    /Cagnotte brute restituée\s+5,00 EUR/.test(text), "confirmation administrative persistante");
}

async function visibleOrderCard(page: Page, orderId: string) {
  const card = page.locator("article.rounded-lg:visible").filter({ hasText: orderId }).first();
  await card.waitFor({ state: "visible", timeout: 20_000 });
  return card;
}

async function inspectState(harness: RecipeHarness, label: string, uid: string): Promise<RecipeState> {
  const output = resolve(harness.runDirectory, `state-${safeName(label)}.json`);
  await runRecipeScript(harness, `state-${safeName(label)}`, "scripts/cagnotte-interactive/state.ts", [
    `--uid=${uid}`,
    `--output=${output}`,
  ]);
  const state = JSON.parse(await readFile(output, "utf8")) as RecipeState;
  assert.equal(state.projectId, RECIPE_PROJECT_ID);
  assert.equal(state.uid, uid);
  return state;
}

function assertOrder(state: RecipeState, orderId: string, expected: {
  totalCents: number;
  paymentAmountCents: number;
  loyaltyCents: number;
  appliedCagnotteCents: number;
  paymentStatus: string;
  orderStatus: string;
}) {
  const order = state.orders.find((entry) => entry.id === orderId);
  assert.ok(order, `commande ${orderId} absente`);
  assert.deepEqual({
    totalCents: order.totalCents,
    paymentAmountCents: order.paymentAmountCents,
    loyaltyCents: order.loyaltyCents,
    appliedCagnotteCents: order.appliedCagnotteCents,
    paymentStatus: order.paymentStatus,
    orderStatus: order.orderStatus,
    programVersion: order.programVersion,
  }, { ...expected, programVersion: RECIPE_PROGRAM_VERSION });
}

function assertWallet(state: RecipeState, expected: [number, number, number, number]) {
  assert.ok(state.wallet, "portefeuille attendu");
  assert.deepEqual([
    state.wallet.pendingCents,
    state.wallet.availableCents,
    state.wallet.reservedCents,
    state.wallet.regularizationCents,
  ], expected);
}

function assertAccrual(
  state: RecipeState,
  orderId: string,
  expected: [number, number, string, boolean, boolean],
) {
  const accrual = state.accruals.find((entry) => entry.id === orderId);
  assert.ok(accrual, `acquisition ${orderId} absente`);
  assert.deepEqual([
    accrual.initialGainCents,
    accrual.remainingGainCents,
    accrual.compartment,
    accrual.paymentConfirmed,
    accrual.deliveryConfirmed,
  ], expected);
}

function assertReservation(
  state: RecipeState,
  orderId: string,
  expected: [number, string, number],
) {
  const reservation = state.reservations.find((entry) => entry.id === orderId);
  assert.ok(reservation, `réservation ${orderId} absente`);
  assert.deepEqual([
    reservation.amountCents,
    reservation.state,
    reservation.cumulativeRestitutedCents,
  ], expected);
}

function assertRateLimiter(state: RecipeState, attempts: number) {
  const documents = state.rateLimits.filter((entry) => entry.route === "/api/create-order");
  assert.equal(documents.filter((entry) => entry.kind === "attempt").length, attempts);
  const counters = documents.filter((entry) => entry.kind === "counter");
  assert.equal(counters.filter((entry) => entry.signalType === "network").length, 2);
  assert.equal(counters.filter((entry) => entry.signalType === "email").length, 2);
  assert.equal(counters.filter((entry) => entry.signalType === "anonymous").length, 2);
  assert.ok(
    counters.every((entry) => entry.count === attempts),
    "les fenêtres du vrai limiteur doivent cumuler exactement chaque tentative",
  );
}

function pickRefund(value: RecipeState["refunds"][number]) {
  return {
    orderId: value.orderId,
    totalFinancialCents: value.totalFinancialCents,
    cagnotteRestitutionCents: value.cagnotteRestitutionCents,
    cancelledGainCents: value.cancelledGainCents,
  };
}

async function assertRecipeBanner(page: Page) {
  const banner = page.locator('[data-verdanza-recette="local-interactive"]');
  await banner.waitFor({ state: "visible" });
  assert.equal(await banner.textContent(), "RECETTE LOCALE — DONNÉES FICTIVES");
}

async function goto(page: Page, pathname: string) {
  const target = localUrl(RECIPE_PORTS.app, pathname);
  if (safeUrl(page.url())?.pathname === pathname) {
    await assertRecipeBanner(page);
    return;
  }
  const applicationLink = page.locator(`a[href="${pathname}"]`).first();
  if (page.url().startsWith(localUrl(RECIPE_PORTS.app)) && await applicationLink.count()) {
    await Promise.all([
      page.waitForURL((url) => url.pathname === pathname, { timeout: 15_000 }),
      applicationLink.evaluate((element) => (element as HTMLAnchorElement).click()),
    ]);
  } else if (pathname.startsWith("/admin/")) {
    const response = await page.goto(target, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200, `${pathname} doit être servi localement`);
  } else if (page.url().startsWith(localUrl(RECIPE_PORTS.app))) {
    await Promise.all([
      page.waitForURL((url) => url.pathname === pathname, { timeout: 15_000 }),
      page.evaluate((nextPathname) => {
        window.history.pushState(null, "", nextPathname);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, pathname),
    ]);
  } else {
    const response = await page.goto(target, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200, `${pathname} doit être servi localement`);
  }
  await assertRecipeBanner(page);
}

async function capture(
  page: Page,
  harness: RecipeHarness,
  viewport: ViewportDefinition,
  name: string,
  screenshots: string[],
) {
  const target = resolve(harness.runDirectory, `${name}-${viewport.label}.png`);
  await page.screenshot({ path: target, fullPage: true });
  screenshots.push(target);
}

async function waitForBalance(page: Page, label: string, value: string) {
  const renderedLabel = label === "En attente"
    ? "Gains en attente"
    : label === "Réservé"
      ? "Réservé pour vos commandes"
      : label;
  if (label === "Réservé" && value === "0,00 €") {
    await waitForMainText(
      page,
      (text) => /Disponible\s+[0-9]/.test(text) && !text.includes(renderedLabel),
      `${renderedLabel} absent lorsque le montant vaut zéro`,
    );
    return;
  }
  await waitForMainText(
    page,
    (text) => new RegExp(`${escapeRegex(renderedLabel)}\\s+${escapeRegex(value)}`).test(text),
    `${renderedLabel} = ${value}`,
  );
}

async function waitForMainText(
  page: Page,
  predicate: (text: string) => boolean,
  description: string,
  timeoutMs = 15_000,
) {
  const deadline = Date.now() + timeoutMs;
  let observed = "";
  while (Date.now() < deadline) {
    observed = await mainText(page).catch(() => "");
    if (predicate(observed)) return observed;
    await page.waitForTimeout(100);
  }
  throw new Error(`${description} non observé. Texte final : ${observed.slice(0, 2_000)}`);
}

async function waitForButtonEnabled(button: ReturnType<Page["getByRole"]>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await button.isEnabled().catch(() => false)) return;
    await button.page().waitForTimeout(25);
  }
  throw new Error("Le bouton attendu n'est pas devenu actif.");
}

async function setDateTimeLocal(input: ReturnType<Page["getByLabel"]>, value: string) {
  await input.evaluate((element, nextValue) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Setter natif datetime-local indisponible.");
    setter.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  assert.equal(await input.inputValue(), value);
}

function recentLocalDateTime() {
  const date = new Date(Date.now() - 1_000);
  if (date.getSeconds() === 0) date.setTime(date.getTime() - 1_000);
  const part = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}` +
    `T${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}`;
}

async function mainText(page: Page) {
  return normalizeText(await page.locator("main").innerText());
}

function normalizeText(value: string) {
  return value.replace(/[\u00a0\u202f]/g, " ").replace(/\r/g, "");
}

function assertApiRequestLog(entries: Array<Record<string, unknown>>) {
  assert.ok(entries.some((entry) => entry.pathname === "/api/create-order" && entry.status === 200));
  assert.ok(entries.some((entry) => entry.pathname === "/api/order-refunds" && entry.status === 200));
  const failures = entries.filter((entry) => Number(entry.status) >= 500 && !(
    entry.status === 503 && ["/api/public-promo-banners", "/api/admin-payment-links", "/api/invoices"].includes(String(entry.pathname))
  ));
  assert.deepEqual(failures, [], `aucun 500 métier n’est attendu : ${JSON.stringify(failures)}`);
}

function assertServerNetworkIsolation(entries: Array<Record<string, unknown>>) {
  const firebaseCliNotifications = entries.filter((entry) => (
    entry.kind === "fetch" &&
    entry.host === "localhost" &&
    entry.port === 40_001 &&
    entry.blocked === true
  ));
  const unexpected = entries.filter((entry) => !firebaseCliNotifications.includes(entry));
  assert.equal(
    firebaseCliNotifications.length,
    1,
    `la notification locale facultative firebase-tools doit être bloquée exactement une fois avant la preuve : ${JSON.stringify(entries)}`,
  );
  assert.deepEqual(
    unexpected,
    [],
    `aucune autre destination serveur ne doit être tentée : ${JSON.stringify(unexpected)}`,
  );
}

async function readJsonLines(path: string, missingIsEmpty = false) {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (missingIsEmpty && record(error).code === "ENOENT") return [];
    throw error;
  }
  return contents.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function networkEntry(options: {
  phase: string;
  contextId: string;
  pageId?: string;
  clock: EvidenceClock;
  requestId: string;
  direction: "request" | "response";
  url: URL;
  request: Request;
  status?: number;
  blocked?: boolean;
}): NetworkEvidence {
  const requestShape = firestoreRequestShape(options.url);
  return {
    phase: options.phase,
    contextId: options.contextId,
    ...(options.pageId ? { pageId: options.pageId } : {}),
    ...options.clock.next(),
    requestId: options.requestId,
    direction: options.direction,
    method: options.request.method(),
    origin: options.url.origin,
    pathname: options.url.pathname,
    resourceType: options.request.resourceType(),
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.blocked === undefined ? {} : { blocked: options.blocked }),
    ...(requestShape ? { requestShape } : {}),
  };
}

function consoleEntry(options: {
  phase: string;
  contextId: string;
  pageId: string;
  clock: EvidenceClock;
  message: ConsoleMessage;
}): ConsoleEvidence {
  return {
    phase: options.phase,
    contextId: options.contextId,
    pageId: options.pageId,
    ...options.clock.next(),
    source: "console",
    type: options.message.type(),
    text: sanitizedConsoleText(options.message.text()),
  };
}

function firestoreRequestShape(url: URL): RequestShape | undefined {
  if (
    url.origin !== localUrl(RECIPE_PORTS.firestore).replace(/\/$/, "") ||
    url.pathname !== "/google.firestore.v1.Firestore/Listen/channel"
  ) return undefined;
  const requestId = url.searchParams.get("RID");
  const transportType = url.searchParams.get("TYPE");
  const version = url.searchParams.get("VER");
  return {
    queryParameterNames: [...new Set(url.searchParams.keys())].sort(),
    hasSessionId: url.searchParams.has("SID"),
    requestIdKind: requestId === null
      ? "absent"
      : requestId === "rpc"
        ? "rpc"
        : /^\d+$/.test(requestId)
          ? "numeric"
          : "other",
    transportType: transportType === null ? "absent" : transportType === "xmlhttp" ? "xmlhttp" : "other",
    protocolVersion: version === null ? "absent" : version === "8" ? "8" : "other",
  };
}

async function captureResponseSignature(response: PlaywrightResponse): Promise<ResponseSignature> {
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const body = await Promise.race([
      response.body(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("lecture de signature au-delà de 2 000 ms")), 2_000);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    const prefix = body.subarray(0, 256).toString("utf8");
    return {
      byteLength: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
      contentType: response.headers()["content-type"] ?? null,
      bodyPrefix: sanitizedConsoleText(prefix),
      truncated: body.byteLength > 256,
    };
  } catch (error) {
    return {
      byteLength: -1,
      sha256: "",
      contentType: response.headers()["content-type"] ?? null,
      bodyPrefix: "",
      truncated: false,
      captureError: sanitizedConsoleText(error instanceof Error ? error.message : String(error)),
    };
  }
}

function sanitizedConsoleText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9._~-]+/g, "[jwt-redacted]")
    .replace(/(https?:\/\/[^\s?]+)\?[^\s'"]+/g, "$1?[redacted]")
    .slice(0, 1_000);
}

async function persistSanitizedHarnessDiagnostics(harness: RecipeHarness) {
  const emulatorLog = harness.processes.find((entry) => entry.name === "firebase-emulators")?.logPath;
  let entries: string[] = [];
  let sourceReadErrorCode: string | undefined;
  if (emulatorLog) {
    try {
      const ansiSequence = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
      entries = (await readFile(emulatorLog, "utf8"))
        .replace(ansiSequence, "")
        .split(/\r?\n/)
        .filter((line) => /emulator|firestore|auth|shutdown|sigint|error|warn|exception/i.test(line))
        .map((line) => sanitizedConsoleText(line).slice(0, 500))
        .slice(-100);
    } catch (error) {
      sourceReadErrorCode = String(record(error).code ?? "UNKNOWN")
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, "_")
        .slice(0, 64);
      console.error(`[emulator-diagnostics] log auxiliaire indisponible code=${sourceReadErrorCode}`);
    }
  }
  await writeFile(
    resolve(harness.runDirectory, "emulator-diagnostics.json"),
    `${JSON.stringify({
      source: "firebase-emulators.log",
      entries,
      ...(sourceReadErrorCode ? { sourceReadErrorCode } : {}),
      ownedProcesses: harness.processes.map(ownedProcessReliabilitySnapshot),
    }, null, 2)}\n`,
    "utf8",
  );
}

function logCleanupIssue(label: string, step: CleanupStepResult) {
  console.error(`[cleanup:${label}] ${step.name}: ${step.error ?? "échec sans détail"}`);
}

function isAllowedLocalUrl(url: URL, websocket = false) {
  const protocol = websocket ? url.protocol === "ws:" : url.protocol === "http:";
  const port = Number(url.port || (url.protocol === "http:" ? 80 : 0));
  return protocol && url.hostname === "127.0.0.1" && allowedPorts.has(port);
}

function isNonNetworkProtocol(url: URL) {
  return ["data:", "blob:", "about:"].includes(url.protocol);
}

function safeUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isJsonAction(response: PlaywrightResponse, pathname: string, action: string) {
  if (safeUrl(response.url())?.pathname !== pathname || response.request().method() !== "POST") return false;
  try {
    return record(response.request().postDataJSON()).action === action;
  } catch {
    return false;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function closeBrowserBounded(browserInstance: Browser) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      browserInstance.close(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("fermeture du navigateur au-delà de 10 000 ms")), 10_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeError(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
