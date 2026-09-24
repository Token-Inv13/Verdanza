import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  installRecipeTerminalOutputProtection,
  ownedProcessReliabilitySnapshot,
  runRecipeScript,
  startRecipeHarness,
  type RecipeHarness,
  writeRecipeStderrLine,
  writeRecipeStdoutLine,
} from "./harness.js";
import {
  configureOwnedResource,
  createSharedResourceClosure,
  runWithViewportResources,
  type CleanupStepResult,
  type SharedResourceClosure,
  type ViewportTerminalOutcome,
} from "./resourceLifecycle.js";
import {
  assertExpectedFailClosedApiUnavailable,
  assertNoUnexpectedRuntimeFailures,
  isFirestoreListen400Response,
  type ConsoleEvidence,
  type FirestoreListenProbeEvidence,
  type FirestoreListenRecoveryExpectation,
  type NetworkEvidence,
  type RequestShape,
  type ResponseSignature,
} from "./runtimeDiagnostics.js";
import { assertDiagnosticJournalComplete } from "./diagnosticJournal.js";
import {
  assertCreateOrderRateLimitEvidence,
  type RateLimitEvidence,
} from "./rateLimitEvidence.js";
import { refundConfirmationDateTimeLocal } from "./refundConfirmationDate.js";
import {
  installRecipeSignalCancellation,
  isRecipeSignalCancellation,
  type RecipeSignal,
  type RecipeSignalCancellation,
  type RecipeSignalSource,
} from "./run.js";

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
    paidAt: string;
    paymentConfirmedAt: string;
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
  rateLimits: RateLimitEvidence[];
};

type ViewportDefinition = {
  label: "desktop" | "mobile";
  width: number;
  height: number;
};

type BrowserFirestoreListenResponse = {
  method: string;
  origin: string;
  pathname: string;
  status: number;
  occurredAtEpochMs: number;
  requestShape: RequestShape;
  responseSignature: ResponseSignature;
};

export type BrowserEvidenceCollectionSnapshot = {
  status: "not-collected" | "collecting" | "collected" | "interrupted" | "failed";
  completedCollections: number;
  interruptedCollections: number;
  cancellationClosureRequested: boolean;
};

type BrowserEvidenceCollection = {
  collect: () => Promise<void>;
  stopForCoordinatedCancellation: (reason: string) => void;
  settle: () => Promise<void>;
  snapshot: () => BrowserEvidenceCollectionSnapshot;
};

export function createBrowserEvidenceCollection(options: {
  collect: () => Promise<void>;
  isCoordinatedClosureError: (error: unknown, reason: string) => boolean;
}): BrowserEvidenceCollection {
  type ActiveCollection = {
    cancellationReason?: string;
    release: () => void;
    settled: Promise<void>;
  };
  const active = new Set<ActiveCollection>();
  const failures: unknown[] = [];
  let acceptingCollections = true;
  let completedCollections = 0;
  let interruptedCollections = 0;

  const collect = async () => {
    if (!acceptingCollections) return;
    let release: () => void = () => undefined;
    const interrupted = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    const current = {
      cancellationReason: undefined,
      release,
      settled: Promise.resolve(),
    } satisfies ActiveCollection;
    current.settled = Promise.resolve()
      .then(options.collect)
      .then(() => { completedCollections += 1; })
      .catch((error) => {
        if (
          current.cancellationReason &&
          options.isCoordinatedClosureError(error, current.cancellationReason)
        ) {
          interruptedCollections += 1;
          return;
        }
        failures.push(error);
        throw error;
      })
      .finally(() => { active.delete(current); });
    active.add(current);
    // Si l'appelant est libéré par l'annulation, le rejet tardif reste mémorisé et sera relu par settle().
    void current.settled.then(undefined, () => undefined);
    await Promise.race([current.settled, interrupted]);
  };

  return {
    collect,
    stopForCoordinatedCancellation(reason) {
      if (!acceptingCollections) return;
      acceptingCollections = false;
      for (const current of active) {
        current.cancellationReason = reason;
        current.release();
      }
    },
    async settle() {
      while (active.size > 0) await Promise.allSettled([...active].map((entry) => entry.settled));
      if (failures.length > 0) {
        throw new AggregateError(
          [...failures],
          "Une ou plusieurs collectes navigateur ont échoué hors fermeture coordonnée.",
        );
      }
    },
    snapshot() {
      const interrupted = interruptedCollections > 0 || [...active].some(
        (entry) => Boolean(entry.cancellationReason),
      );
      return {
        status: failures.length > 0
          ? "failed"
          : interrupted
            ? "interrupted"
            : active.size > 0
              ? "collecting"
              : completedCollections > 0
                ? "collected"
                : "not-collected",
        completedCollections,
        interruptedCollections,
        cancellationClosureRequested: !acceptingCollections,
      };
    },
  };
}

type RunnerSignalProbe = "after-resources" | "during-active-wait";

export type AutomatedRecipeResult =
  | { status: "PASS"; exitCode: 0 }
  | { status: "CANCELLED"; signal: RecipeSignal; exitCode: 1 | 130 | 143 };

type MonitoredContext = {
  context: BrowserContext;
  contextId: string;
  network: NetworkEvidence[];
  console: ConsoleEvidence[];
  setPhase: (phase: string) => void;
  currentPhase: () => string;
  pageId: (page: Page) => string;
  collectBrowserEvidence: () => Promise<void>;
  stopBrowserEvidenceForCancellation: (reason: string) => void;
  settleBrowserEvidence: () => Promise<void>;
  browserEvidenceCollection: () => BrowserEvidenceCollectionSnapshot & {
    interruptedPendingReads: number;
  };
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
const pageCancellations = new WeakMap<Page, RecipeSignalCancellation>();

export async function runViewportSequence<Item, Result>(options: {
  items: readonly Item[];
  cancellation: RecipeSignalCancellation;
  run: (item: Item) => Promise<Result>;
  onCompleted: (result: Result) => void;
}) {
  for (const item of options.items) {
    options.cancellation.throwIfRequested();
    const result = await options.run(item);
    options.onCompleted(result);
    options.cancellation.throwIfRequested();
  }
}

export async function publishCurrentPassEvidence(options: {
  path: string;
  contents: string;
  cancellation: RecipeSignalCancellation;
  afterWrite?: () => void | Promise<void>;
}) {
  await writeFile(options.path, options.contents, "utf8");
  await options.afterWrite?.();
  try {
    options.cancellation.throwIfRequested();
  } catch (error) {
    try {
      await rm(options.path, { force: true });
    } catch (cleanupError) {
      attachRunnerCleanupIssue(error, "remove-current-pass", cleanupError);
    }
    throw error;
  }
}

export async function publishViewportTerminalEvidence(options: {
  path: string;
  contents: string;
  cancellation: RecipeSignalCancellation;
  requireUninterrupted: boolean;
  beforeCommit?: () => void | Promise<void>;
  fileOperations?: {
    rename?: (source: string, destination: string) => Promise<void>;
    remove?: (path: string) => Promise<void>;
  };
}) {
  const temporaryPath = `${options.path}.${process.pid}.${randomUUID()}.tmp`;
  const renameFile = options.fileOperations?.rename ?? rename;
  const removeFile = options.fileOperations?.remove ?? ((path: string) => rm(path, { force: true }));
  let committed = false;
  let accepted = false;
  let publicationError: unknown;
  try {
    await writeFile(temporaryPath, options.contents, "utf8");
    await options.beforeCommit?.();
    if (options.requireUninterrupted) options.cancellation.throwIfRequested();
    await renameFile(temporaryPath, options.path);
    committed = true;
  } catch (error) {
    publicationError = error;
  }
  try {
    await removeFile(temporaryPath);
  } catch (cleanupError) {
    if (publicationError === undefined) publicationError = cleanupError;
    else attachRunnerCleanupIssue(publicationError, "remove-terminal-temporary", cleanupError);
  }

  if (publicationError === undefined) {
    if (options.requireUninterrupted) {
      try {
        options.cancellation.throwIfRequested();
        accepted = true;
      } catch (error) {
        publicationError = error;
      }
    } else {
      accepted = true;
    }
  }
  if (accepted) return;

  if (committed) {
    try {
      await removeFile(options.path);
    } catch (cleanupError) {
      if (publicationError === undefined) publicationError = cleanupError;
      else attachRunnerCleanupIssue(publicationError, "invalidate-terminal-outcome", cleanupError);
    }
  }
  if (publicationError === undefined) throw new Error("Publication terminale refusée sans cause identifiable.");
  throw publicationError;
}

export async function runAutomatedRecipe(options: {
  signalSource?: RecipeSignalSource;
  signalProbe?: RunnerSignalProbe;
  viewportRunner?: typeof runViewport;
} = {}): Promise<AutomatedRecipeResult> {
  const cancellation = installRecipeSignalCancellation(options.signalSource ?? process);
  const latestEvidence = resolve(RECIPE_CACHE_ROOT, "latest-result.json");
  const latestFailureEvidence = resolve(RECIPE_CACHE_ROOT, "latest-failure.json");
  const executions: Array<Record<string, unknown>> = [];
  let activeRunDirectory: string | undefined;
  let browser: Browser | undefined;
  let browserClosure: SharedResourceClosure | undefined;
  let browserCloseError: unknown;
  let executionError: unknown;
  let interruptionError: unknown;
  const closeBrowser = () => browserClosure?.close() ?? Promise.resolve();

  try {
    try {
      await mkdir(RECIPE_CACHE_ROOT, { recursive: true });
      cancellation.throwIfRequested();
      await Promise.all([
        rm(latestEvidence, { force: true }),
        rm(latestFailureEvidence, { force: true }),
      ]);
      cancellation.throwIfRequested();
      // Le runner ferme lui-même Chromium et ses services avant de choisir le code de sortie.
      const launchedBrowser = await chromium.launch({
        headless: true,
        handleSIGINT: false,
        handleSIGTERM: false,
      });
      browser = launchedBrowser;
      browserClosure = createSharedResourceClosure(() => closeBrowserBounded(launchedBrowser));
      cancellation.throwIfRequested();
      await runViewportSequence({
        items: viewportDefinitions,
        cancellation,
        run: async (viewport) => {
          if (options.signalProbe) writeRecipeStdoutLine(`RUNNER_VIEWPORT_START ${viewport.label}`);
          return (options.viewportRunner ?? runViewport)(
            browser as Browser,
            viewport,
            cancellation,
            options.signalProbe,
            (runDirectory) => { activeRunDirectory = runDirectory; },
            (error) => { executionError ??= error; },
            closeBrowser,
          );
        },
        onCompleted: (result) => executions.push(result),
      });
    } catch (error) {
      const failedRunDirectory = record(error).runDirectory;
      if (typeof failedRunDirectory === "string") activeRunDirectory = failedRunDirectory;
      if (executionError === undefined) {
        if (cancellation.isCancellationError(error)) interruptionError ??= error;
        else executionError = error;
      } else if (cancellation.isCancellationError(error)) {
        interruptionError ??= error;
      }
    }

    try {
      await closeBrowser();
    } catch (error) {
      browserCloseError ??= error;
    }
    if (browserCloseError !== undefined) {
      writeRecipeStderrLine(`[cleanup:browser] ${safeError(browserCloseError)}`);
      if (executionError === undefined && !cancellation.signal.aborted) executionError = browserCloseError;
    }

    if (executionError !== undefined) {
      await writeFailureEvidence(latestFailureEvidence, {
        status: "FAIL",
        error: safeError(executionError),
        activeRunDirectory,
        completedExecutions: executions,
        ...(cancellation.requestedSignal() ? { interruptedBy: cancellation.requestedSignal() } : {}),
        cleanupIssues: [
          ...attachedCleanupIssues(executionError),
          ...cancellationCleanupIssues(interruptionError, browserCloseError),
        ],
      });
      writeRecipeStderrLine(`Preuve interactive d’échec : ${latestFailureEvidence}`);
      throw executionError;
    }

    if (cancellation.signal.aborted) {
      return await writeCancellationResult({
        cancellation,
        latestEvidence,
        latestFailureEvidence,
        activeRunDirectory,
        executions,
        interruptionError,
        browserCloseError,
      });
    }

    try {
      await publishCurrentPassEvidence({
        path: latestEvidence,
        cancellation,
        contents: `${JSON.stringify({
          status: "PASS",
          generatedAt: new Date().toISOString(),
          projectId: RECIPE_PROJECT_ID,
          origin: localUrl(RECIPE_PORTS.app),
          executions,
        }, null, 2)}\n`,
      });
      writeRecipeStdoutLine(`Preuve interactive consolidée : ${latestEvidence}`);
      writeRecipeStdoutLine("Recette interactive locale réussie sur desktop et viewport mobile ; tous les processus sont arrêtés.");
      cancellation.throwIfRequested();
      return { status: "PASS", exitCode: 0 };
    } catch (error) {
      if (!cancellation.signal.aborted || !isRecipeSignalCancellation(error)) throw error;
      return await writeCancellationResult({
        cancellation,
        latestEvidence,
        latestFailureEvidence,
        activeRunDirectory,
        executions,
        interruptionError: error,
        browserCloseError,
      });
    }
  } finally {
    cancellation.dispose();
  }
}

async function writeFailureEvidence(
  path: string,
  details: Record<string, unknown>,
) {
  try {
    await writeFile(path, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      projectId: RECIPE_PROJECT_ID,
      origin: localUrl(RECIPE_PORTS.app),
      ...details,
    }, null, 2)}\n`, "utf8");
  } catch (evidenceError) {
    writeRecipeStderrLine(`[failure-evidence] ${safeError(evidenceError)}`);
    return evidenceError;
  }
}

async function writeCancellationResult(options: {
  cancellation: RecipeSignalCancellation;
  latestEvidence: string;
  latestFailureEvidence: string;
  activeRunDirectory?: string;
  executions: Array<Record<string, unknown>>;
  interruptionError?: unknown;
  browserCloseError?: unknown;
}): Promise<AutomatedRecipeResult> {
  const signal = options.cancellation.requestedSignal();
  if (!signal) throw new Error("Annulation sans signal mémorisé.");
  const cleanupIssues = cancellationCleanupIssues(options.interruptionError, options.browserCloseError);
  try {
    await rm(options.latestEvidence, { force: true });
  } catch (error) {
    cleanupIssues.push(`remove-current-pass: ${safeError(error)}`);
  }
  let exitCode: 1 | 130 | 143 = cleanupIssues.length > 0
    ? 1
    : options.cancellation.exitCode() ?? 1;
  const evidenceError = await writeFailureEvidence(options.latestFailureEvidence, {
    status: "CANCELLED",
    signal,
    exitCode,
    error: isRecipeSignalCancellation(options.interruptionError)
      ? safeError(options.interruptionError)
      : undefined,
    activeRunDirectory: options.activeRunDirectory,
    completedExecutions: options.executions,
    cleanupIssues,
  });
  if (evidenceError !== undefined) exitCode = 1;
  writeRecipeStderrLine(
    `Recette interactive ANNULÉE par ${signal}; aucun PASS global publié ` +
    `(code de sortie ${exitCode}).`,
  );
  return { status: "CANCELLED", signal, exitCode };
}

function cancellationCleanupIssues(...errors: unknown[]) {
  const issues: string[] = [];
  for (const error of errors) {
    if (error === undefined) continue;
    const cleanupFailures = record(error).cleanupFailures;
    if (Array.isArray(cleanupFailures)) {
      for (const failure of cleanupFailures) issues.push(safeCleanupIssue(failure));
      continue;
    }
    if (isRecipeSignalCancellation(error)) continue;
    issues.push(safeError(error));
  }
  return [...new Set(issues)];
}

function attachedCleanupIssues(error: unknown) {
  const cleanupFailures = record(error).cleanupFailures;
  if (!Array.isArray(cleanupFailures)) return [];
  return cleanupFailures.map(safeCleanupIssue);
}

function attachRunnerCleanupIssue(primaryError: unknown, name: string, cleanupError: unknown) {
  if (!(primaryError instanceof Error)) return;
  try {
    const current = (primaryError as Error & { cleanupFailures?: unknown[] }).cleanupFailures;
    Object.defineProperty(primaryError, "cleanupFailures", {
      configurable: true,
      enumerable: false,
      value: [
        ...(Array.isArray(current) ? current : []),
        { name, status: "failed", durationMs: 0, error: safeError(cleanupError) },
      ],
    });
  } catch {
    // L'annulation initiale reste prioritaire si l'erreur n'est pas extensible.
  }
}

function safeCleanupIssue(value: unknown) {
  const issue = record(value);
  const name = typeof issue.name === "string" ? issue.name : "cleanup";
  const error = typeof issue.error === "string" ? issue.error : safeError(value);
  return `${name}: ${error}`;
}

function selectedSignalProbe(): RunnerSignalProbe | undefined {
  const prefix = "--runner-signal-probe=";
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (value === undefined) return undefined;
  if (value === "after-resources" || value === "during-active-wait") return value;
  throw new Error(`Point de synchronisation runner inconnu : ${value}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installRecipeTerminalOutputProtection();
  const result = await runAutomatedRecipe({ signalProbe: selectedSignalProbe() });
  if (result.status === "CANCELLED") process.exitCode = result.exitCode;
}

async function runViewport(
  browserInstance: Browser,
  viewport: ViewportDefinition,
  cancellation: RecipeSignalCancellation,
  signalProbe: RunnerSignalProbe | undefined,
  onHarnessStarted: (runDirectory: string) => void,
  onPrimaryError: (error: unknown) => void,
  closeBrowserAfterContextFailure: () => Promise<void>,
): Promise<Record<string, unknown>> {
  let stoppedForFailClosed = false;
  let cleanupProbeReported = false;
  let evidenceSequence = 0;
  let businessScenarioCompleted = false;
  const recordPrimaryOperationError = (error: unknown) => {
    onPrimaryError(error);
  };
  const screenshots: string[] = [];
  const stages: Array<{ label: string; state: RecipeState }> = [];
  const firestoreProbeEvidence: FirestoreListenProbeEvidence[] = [];
  const firestoreProbeIds = {
    client: `${viewport.label}-client-${process.pid}-${Date.now()}`,
    admin: `${viewport.label}-admin-${process.pid}-${Date.now()}`,
  };
  const firestoreRecoveryGenerations = {
    clientAndAdminRoute: `recovery-${viewport.label}-route-${Date.now()}`,
    adminAuth: `recovery-${viewport.label}-admin-auth-${Date.now()}`,
  };
  const evidenceClock: EvidenceClock = {
    next: () => ({ sequence: ++evidenceSequence, occurredAtEpochMs: Date.now() }),
  };
  return runWithViewportResources({
    label: viewport.label,
    startHarness: async () => {
      const harness = await startRecipeHarness(viewport.label, { signal: cancellation.signal });
      onHarnessStarted(harness.runDirectory);
      return harness;
    },
    createMonitor: (role) => monitoredContext(browserInstance, viewport, role, evidenceClock, cancellation),
    createPage: async (monitor) => {
      const page = await monitor.context.newPage();
      pageCancellations.set(page, cancellation);
      const probeId = monitor.contextId.endsWith(":admin")
        ? firestoreProbeIds.admin
        : firestoreProbeIds.client;
      await page.addInitScript(({ documentId, configuredProbeId }) => {
        window.sessionStorage.setItem("verdanza-recette-firestore-probe", JSON.stringify({
          documentId,
          probeId: configuredProbeId,
        }));
      }, { documentId: RECIPE_PRODUCT.id, configuredProbeId: probeId });
      return page;
    },
    persistEvidence: async (resources) => {
      if (!resources.harness) return;
      if (signalProbe && !cleanupProbeReported) {
        cleanupProbeReported = true;
        writeRecipeStdoutLine(`RUNNER_SIGNAL_PROBE CLEANUP_START ${viewport.label} ${resources.harness.runDirectory}`);
      }
      const evidenceFailures: unknown[] = [];
      const monitors = [resources.clientMonitor, resources.adminMonitor].filter(
        (monitor): monitor is MonitoredContext => Boolean(monitor),
      );
      const browserEvidenceWrite = await Promise.allSettled([
        persistBrowserEvidence(
          resources.harness,
          ...monitors,
        ),
      ]);
      const evidenceWrites = [
        ...browserEvidenceWrite,
        ...await Promise.allSettled([
        writeFile(
          resolve(resources.harness.runDirectory, "firestore-listen-probe.json"),
          `${JSON.stringify(firestoreProbeEvidence, null, 2)}\n`,
          "utf8",
        ),
        ]),
      ];
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
    closeMonitor: async (monitor, _role, options) => {
      if (options?.reason) monitor.stopBrowserEvidenceForCancellation(options.reason);
      await monitor.context.close(options?.reason ? { reason: options.reason } : undefined);
    },
    closeCancellationFallback: () => closeBrowserAfterContextFailure(),
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
    cancellation,
    onPrimaryError: recordPrimaryOperationError,
    onCleanupIssue: (step) => logCleanupIssue(viewport.label, step),
  }, async ({ harness, clientMonitor, adminMonitor, clientPage, adminPage }) => {
    cancellation.throwIfRequested();
    if (signalProbe === "after-resources") {
      writeRecipeStdoutLine(
        `RUNNER_SIGNAL_PROBE READY after-resources ${viewport.label} ${harness.runDirectory}`,
      );
      await cancellation.waitForRequest();
      cancellation.throwIfRequested();
    }
    if (signalProbe === "during-active-wait") {
      clientMonitor.setPhase("signal-probe-active-wait");
      await goto(clientPage, "/connexion");
      cancellation.throwIfRequested();
      const activeWait = clientPage.waitForFunction(() => false, undefined, { timeout: 60_000 });
      writeRecipeStdoutLine(
        `RUNNER_SIGNAL_PROBE READY during-active-wait ${viewport.label} ${harness.runDirectory}`,
      );
      await activeWait;
      throw new Error("Le point d’attente du signal s’est terminé sans interruption.");
    }

    cancellation.throwIfRequested();
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

    const initial = await inspectState(
      harness,
      `${viewport.label}-00-initial`,
      fixtures.identities.client1.uid,
      cancellation.signal,
    );
    stages.push({ label: "initial", state: initial });
    assert.equal(initial.wallet, null, "aucun portefeuille ne doit être précrédité");
    assert.equal(initial.orders.length, 0);
    assert.equal(initial.movements.length, 0);
    assert.equal(initial.rateLimits.length, 0);

    cancellation.throwIfRequested();
    clientMonitor.setPhase("client1-auth");
    await signIn(clientPage, RECIPE_ACCOUNTS.client1);
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

    cancellation.throwIfRequested();
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

    const aCreated = await inspectState(
      harness,
      `${viewport.label}-01-a-created`,
      fixtures.identities.client1.uid,
      cancellation.signal,
    );
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

    cancellation.throwIfRequested();
    adminMonitor.setPhase("admin-auth");
    await signIn(adminPage, RECIPE_ACCOUNTS.admin);
    await collectFirestoreProbeEvidence(
      adminPage,
      adminMonitor,
      evidenceClock,
      firestoreProbeEvidence,
    );
    adminMonitor.setPhase("admin-firestore-auth-recovery");
    await writeAndObserveFirestoreProbeGeneration({
      harness,
      viewport,
      page: adminPage,
      monitor: adminMonitor,
      probeId: firestoreProbeIds.admin,
      generation: firestoreRecoveryGenerations.adminAuth,
      evidenceClock,
      firestoreProbeEvidence,
      signal: cancellation.signal,
    });
    await adminMonitor.collectBrowserEvidence();
    adminMonitor.setPhase("admin-auth");
    await openAdminOrders(adminPage, "Toutes");
    await assertRecipeBanner(adminPage);
    assert.equal(await clientPage.url().includes("127.0.0.1"), true, "le contexte client doit rester indépendant");

    cancellation.throwIfRequested();
    adminMonitor.setPhase("admin-a-payment");
    await updateOrder(adminPage, orderAId, "payment", "paid");
    clientMonitor.setPhase("client-a-pending");
    await openAdvantages(clientPage, RECIPE_ACCOUNTS.client1.email);
    await refreshAdvantages(clientPage);
    await waitForBalance(clientPage, "En attente", "5,00 €");
    await waitForBalance(clientPage, "Disponible", "0,00 €");
    await capture(clientPage, harness, viewport, "02-gain-a-en-attente", screenshots);
    const aPaid = await inspectState(
      harness,
      `${viewport.label}-02-a-paid`,
      fixtures.identities.client1.uid,
      cancellation.signal,
    );
    stages.push({ label: "A payée", state: aPaid });
    assertWallet(aPaid, [500, 0, 0, 0]);
    assertAccrual(aPaid, orderAId, [500, 500, "pending", true, false]);
    assert.equal(aPaid.movements.length, 1);

    cancellation.throwIfRequested();
    adminMonitor.setPhase("admin-a-delivery");
    await updateOrder(adminPage, orderAId, "order", "delivered");
    clientMonitor.setPhase("client-a-available");
    await openAdvantages(clientPage, RECIPE_ACCOUNTS.client1.email);
    await refreshAdvantages(clientPage);
    await waitForBalance(clientPage, "En attente", "0,00 €");
    await waitForBalance(clientPage, "Disponible", "5,00 €");
    await capture(clientPage, harness, viewport, "03-gain-a-disponible", screenshots);
    const aDelivered = await inspectState(
      harness,
      `${viewport.label}-03-a-delivered`,
      fixtures.identities.client1.uid,
      cancellation.signal,
    );
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

    cancellation.throwIfRequested();
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
    const bReserved = await inspectState(
      harness,
      `${viewport.label}-04-b-reserved`,
      fixtures.identities.client1.uid,
      cancellation.signal,
    );
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

    cancellation.throwIfRequested();
    adminMonitor.setPhase("admin-b-payment");
    await openAdminOrders(adminPage, "Toutes");
    await updateOrder(adminPage, orderBId, "payment", "paid");
    clientMonitor.setPhase("client-b-pending");
    await openAdvantages(clientPage, RECIPE_ACCOUNTS.client1.email);
    await refreshAdvantages(clientPage);
    await waitForBalance(clientPage, "En attente", "4,75 €");
    await waitForBalance(clientPage, "Réservé", "0,00 €");
    const bPaid = await inspectState(
      harness,
      `${viewport.label}-05-b-paid`,
      fixtures.identities.client1.uid,
      cancellation.signal,
    );
    stages.push({ label: "B payée", state: bPaid });
    assertWallet(bPaid, [475, 0, 0, 0]);
    assertAccrual(bPaid, orderBId, [475, 475, "pending", true, false]);
    assertReservation(bPaid, orderBId, [500, "consumed", 0]);
    assert.equal(bPaid.movements.length, 6);

    cancellation.throwIfRequested();
    adminMonitor.setPhase("admin-b-delivery");
    await updateOrder(adminPage, orderBId, "order", "delivered");
    clientMonitor.setPhase("client-b-available");
    await openAdvantages(clientPage, RECIPE_ACCOUNTS.client1.email);
    await refreshAdvantages(clientPage);
    await waitForBalance(clientPage, "Disponible", "4,75 €");
    const bDelivered = await inspectState(
      harness,
      `${viewport.label}-06-b-delivered`,
      fixtures.identities.client1.uid,
      cancellation.signal,
    );
    stages.push({ label: "B livrée", state: bDelivered });
    assertWallet(bDelivered, [0, 475, 0, 0]);
    assertAccrual(bDelivered, orderBId, [475, 475, "available", true, true]);
    assert.equal(bDelivered.movements.length, 8);
    const bDeliveredOrder = bDelivered.orders.find((order) => order.id === orderBId);
    assert.ok(bDeliveredOrder, `commande ${orderBId} absente après livraison`);
    assert.equal(bDeliveredOrder.paidAt, bDeliveredOrder.paymentConfirmedAt);
    const refundConfirmedAt = refundConfirmationDateTimeLocal({
      paidAt: bDeliveredOrder.paidAt,
    });

    cancellation.throwIfRequested();
    adminMonitor.setPhase("admin-b-refund");
    await openAdminOrders(adminPage, "Livrées");
    await recordFullRefund(adminPage, orderBId, viewport.label, refundConfirmedAt);
    await capture(adminPage, harness, viewport, "06-remboursement-b-admin", screenshots);
    clientMonitor.setPhase("client-final-wallet");
    await openAdvantages(clientPage, RECIPE_ACCOUNTS.client1.email);
    await refreshAdvantages(clientPage);
    await waitForBalance(clientPage, "Disponible", "5,00 €");
    await waitForBalance(clientPage, "En attente", "0,00 €");
    await waitForBalance(clientPage, "Réservé", "0,00 €");
    await waitForMainText(clientPage, (text) => text.includes("Cagnotte restituée après retour"), "restitution visible dans l’historique");
    await capture(clientPage, harness, viewport, "07-solde-final-5-euros", screenshots);
    const refunded = await inspectState(
      harness,
      `${viewport.label}-07-b-refunded`,
      fixtures.identities.client1.uid,
      cancellation.signal,
    );
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

    cancellation.throwIfRequested();
    clientMonitor.setPhase("client-account-switch");
    await signOut(clientPage);
    await signIn(clientPage, RECIPE_ACCOUNTS.client2);
    await openAdvantages(clientPage, RECIPE_ACCOUNTS.client2.email);
    await waitForMainText(clientPage, (text) => text.includes("Portefeuille non créé"), "second portefeuille absent");
    const client2Text = await mainText(clientPage);
    assert.equal(client2Text.includes(RECIPE_ACCOUNTS.client1.email), false, "le premier compte ne doit pas rester affiché");

    cancellation.throwIfRequested();
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

    cancellation.throwIfRequested();
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
    const afterNegative = await inspectState(
      harness,
      `${viewport.label}-08-negative-denials`,
      fixtures.identities.client1.uid,
      cancellation.signal,
    );
    assert.deepEqual(afterNegative, refunded, "les refus client/non-admin ne doivent modifier aucune donnée métier");

    cancellation.throwIfRequested();
    await signOut(clientPage);
    await signIn(clientPage, RECIPE_ACCOUNTS.client1);
    await openAdvantages(clientPage, RECIPE_ACCOUNTS.client1.email);
    await waitForBalance(clientPage, "Disponible", "5,00 €");
    clientMonitor.setPhase("client-firestore-listen-recovery");
    adminMonitor.setPhase("admin-firestore-listen-recovery");
    const recoveryGeneration = firestoreRecoveryGenerations.clientAndAdminRoute;
    await runRecipeScript(
      harness,
      `${viewport.label}-touch-listen-probe`,
      "scripts/cagnotte-interactive/touchListenProbe.ts",
      [recoveryGeneration],
      cancellation.signal,
    );
    const probeTargets = [
      { page: clientPage, monitor: clientMonitor, probeId: firestoreProbeIds.client },
      { page: adminPage, monitor: adminMonitor, probeId: firestoreProbeIds.admin },
    ];
    const recoveryWaits = await Promise.allSettled(probeTargets.map(async ({ page, monitor, probeId }) => {
      await page.waitForFunction(
        ({ generation, expectedProbeId }) => window.__VERDANZA_RECETTE__?.readFirestoreListenProbe()
          .some((entry) => (
            entry.probeId === expectedProbeId &&
            entry.generation === generation &&
            entry.fromCache === false &&
            entry.hasPendingWrites === false
          )),
        { generation: recoveryGeneration, expectedProbeId: probeId },
      );
      await collectFirestoreProbeEvidence(page, monitor, evidenceClock, firestoreProbeEvidence);
    }));
    const recoveryFailures = recoveryWaits
      .filter((entry): entry is PromiseRejectedResult => entry.status === "rejected")
      .map((entry) => entry.reason);
    if (recoveryFailures.length > 0) {
      throw new AggregateError(recoveryFailures, "Une ou plusieurs sondes Firestore n'ont pas prouvé leur reprise.");
    }
    cancellation.throwIfRequested();
    await clientMonitor.collectBrowserEvidence();
    clientMonitor.setPhase("client-final-reload");
    await clientPage.reload({ waitUntil: "domcontentloaded" });
    await clientPage.getByRole("heading", { name: "Mes avantages" }).waitFor();
    await waitForBalance(clientPage, "Disponible", "5,00 €");
    assert.match(await mainText(clientPage), new RegExp(escapeRegex(RECIPE_ACCOUNTS.client1.email)));

    cancellation.throwIfRequested();
    await Promise.all([
      clientMonitor.collectBrowserEvidence(),
      adminMonitor.collectBrowserEvidence(),
    ]);
    cancellation.throwIfRequested();
    const firestoreRecoveryExpectations: FirestoreListenRecoveryExpectation[] = [
      {
        incidentPhase: "client1-auth",
        contextId: clientMonitor.contextId,
        pageId: clientMonitor.pageId(clientPage),
        probeId: firestoreProbeIds.client,
        databaseId: RECIPE_PROJECT_ID,
        documentPath: `products/${RECIPE_PRODUCT.id}`,
        generations: [recoveryGeneration],
      },
      {
        incidentPhase: "admin-auth",
        contextId: adminMonitor.contextId,
        pageId: adminMonitor.pageId(adminPage),
        probeId: firestoreProbeIds.admin,
        databaseId: RECIPE_PROJECT_ID,
        documentPath: `products/${RECIPE_PRODUCT.id}`,
        generations: [firestoreRecoveryGenerations.adminAuth, recoveryGeneration],
      },
    ];
    const runtimeIsolation = assertNoUnexpectedRuntimeFailures(
      [...clientMonitor.network, ...adminMonitor.network],
      [...clientMonitor.console, ...adminMonitor.console],
      firestoreProbeEvidence,
      firestoreRecoveryExpectations,
    );
    assert.deepEqual(await clientPage.evaluate(() => window.__VERDANZA_RECETTE_NETWORK__ ?? []), []);
    assert.deepEqual(await adminPage.evaluate(() => window.__VERDANZA_RECETTE_NETWORK__ ?? []), []);

    cancellation.throwIfRequested();
    clientMonitor.setPhase("fail-closed-api-unavailable");
    const failClosedNetworkStart = clientMonitor.network.length;
    const failClosedConsoleStart = clientMonitor.console.length;
    const apiDiagnostics = await harness.finalizeDiagnostics();
    assertDiagnosticJournalComplete(apiDiagnostics);
    await harness.stopService("local-api");
    stoppedForFailClosed = true;
    cancellation.throwIfRequested();
    await clientPage.getByRole("button", { name: "Actualiser" }).click();
    await waitForMainText(
      clientPage,
      (text) => text.includes("Historique indisponible. Aucun solde ne peut être affiché pour le moment."),
      "erreur explicite sans solde inventé quand l’API locale est arrêtée",
    );
    await capture(clientPage, harness, viewport, "08-api-indisponible-fail-closed", screenshots);
    cancellation.throwIfRequested();
    assert.deepEqual(await clientPage.evaluate(() => window.__VERDANZA_RECETTE_NETWORK__ ?? []), []);
    await clientMonitor.collectBrowserEvidence();
    const failClosedEvidence = assertExpectedFailClosedApiUnavailable(
      clientMonitor.network.slice(failClosedNetworkStart),
      clientMonitor.console.slice(failClosedConsoleStart),
      { contextId: clientMonitor.contextId, pageId: clientMonitor.pageId(clientPage) },
    );

    cancellation.throwIfRequested();
    await persistBrowserEvidence(harness, clientMonitor, adminMonitor);
    const apiRequests = await readJsonLines(resolve(harness.runDirectory, "api-requests.jsonl"));
    assertApiRequestLog(apiRequests);
    const serverBlocks = await readJsonLines(resolve(harness.runDirectory, "server-network-blocks.jsonl"), true);
    assertServerNetworkIsolation(serverBlocks);

    const rateLimit = assertRateLimiter(refunded, 2);
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
        rateLimit,
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
    cancellation.throwIfRequested();
    businessScenarioCompleted = true;
    return result;
  }, async (outcome: ViewportTerminalOutcome<Record<string, unknown>>, resources) => {
    const harness = resources.harness;
    if (!harness) return;
    const monitors = [resources.clientMonitor, resources.adminMonitor].filter(
      (monitor): monitor is MonitoredContext => Boolean(monitor),
    );
    const outcomeError = outcome.status === "PASS" ? undefined : outcome.error;
    await publishViewportTerminalEvidence({
      path: resolve(harness.runDirectory, "execution-summary.json"),
      cancellation,
      requireUninterrupted: outcome.status === "PASS",
      contents: `${JSON.stringify({
        status: outcome.status,
        error: outcomeError === undefined ? null : safeError(outcomeError),
        cleanupIssues: outcomeError === undefined ? [] : attachedCleanupIssues(outcomeError),
        interruption: cancellation.requestedSignal()
          ? { status: "CANCELLED", signal: cancellation.requestedSignal() }
          : null,
        viewport,
        runDirectory: harness.runDirectory,
        currentPhases: {
          client: resources.clientMonitor?.currentPhase(),
          admin: resources.adminMonitor?.currentPhase(),
        },
        businessScenario: businessScenarioCompleted ? "completed" : "incomplete",
        completedStages: stages.map(({ label, state }) => ({
          label,
          wallet: state.wallet,
          movements: state.movements.length,
        })),
        apiDiagnostics: harness.diagnosticsSnapshot() ?? null,
        screenshots,
        evidenceCollection: {
          browser: monitors.map((monitor) => ({
            contextId: monitor.contextId,
            ...monitor.browserEvidenceCollection(),
          })),
          firestoreProbe: {
            status: businessScenarioCompleted
              ? "collected"
              : firestoreProbeEvidence.length > 0
                ? "partial"
                : "not-collected",
            observations: firestoreProbeEvidence.length,
          },
        },
        listen400Incidents: [
          ...(resources.clientMonitor?.network ?? []),
          ...(resources.adminMonitor?.network ?? []),
        ].filter(isFirestoreListen400Response),
      }, null, 2)}\n`,
    });
  }).finally(() => {
    if (!stoppedForFailClosed) writeRecipeStdoutLine(`${viewport.label}: arrêt de sécurité appliqué avant la fin du scénario.`);
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
  cancellation: RecipeSignalCancellation,
): Promise<MonitoredContext> {
  const network: NetworkEvidence[] = [];
  const console: ConsoleEvidence[] = [];
  const contextId = `${viewport.label}:${role}`;
  const pageIds = new WeakMap<Page, string>();
  const pages = new Set<Page>();
  const requestIds = new WeakMap<Request, string>();
  const pendingEvidence = new Set<Promise<void>>();
  const pendingEvidenceFailures: unknown[] = [];
  let coordinatedCancellationClosureReason: string | undefined;
  let interruptedPendingReads = 0;
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
  const settlePendingEvidence = async () => {
    while (pendingEvidence.size > 0) {
      await Promise.allSettled([...pendingEvidence]);
    }
    if (pendingEvidenceFailures.length > 0) {
      throw new AggregateError(
        [...pendingEvidenceFailures],
        "La capture Playwright des réponses Listen a échoué.",
      );
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
        if (isFirestoreListen400Response(evidence) && !cancellation.signal.aborted) {
          const task = captureResponseSignature(response)
            .then((signature) => { evidence.responseSignature = signature; })
            .catch((error) => {
              if (
                coordinatedCancellationClosureReason &&
                isPlaywrightClosureReason(error, coordinatedCancellationClosureReason)
              ) {
                interruptedPendingReads += 1;
                return;
              }
              pendingEvidenceFailures.push(error);
              throw error;
            })
            .finally(() => { pendingEvidence.delete(task); });
          pendingEvidence.add(task);
          void task.then(undefined, () => undefined);
        }
      });
      ownedContext.on("page", (page) => {
        pages.add(page);
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
  const browserEvidenceCollection = createBrowserEvidenceCollection({
    collect: async () => {
      await settlePendingEvidence();
      for (const page of pages) {
        await mergeBrowserFirestoreResponseEvidence(page, pageId(page), network);
      }
    },
    isCoordinatedClosureError: isPlaywrightClosureReason,
  });
  const stopBrowserEvidenceForCancellation = (reason: string) => {
    coordinatedCancellationClosureReason = reason;
    browserEvidenceCollection.stopForCoordinatedCancellation(reason);
  };
  return {
    context,
    contextId,
    network,
    console,
    setPhase(value) { phase = value; },
    currentPhase() { return phase; },
    pageId,
    async collectBrowserEvidence() {
      if (cancellation.signal.aborted) {
        cancellation.throwIfRequested();
      }
      await browserEvidenceCollection.collect();
      cancellation.throwIfRequested();
    },
    stopBrowserEvidenceForCancellation,
    async settleBrowserEvidence() {
      const pendingResult = settlePendingEvidence();
      const collectionResult = browserEvidenceCollection.settle();
      const results = await Promise.allSettled([pendingResult, collectionResult]);
      const failures = results
        .filter((entry): entry is PromiseRejectedResult => entry.status === "rejected")
        .map((entry) => entry.reason);
      if (failures.length > 0) {
        throw new AggregateError(failures, "La capture navigateur engagée n'a pas pu être finalisée.");
      }
    },
    browserEvidenceCollection() {
      const snapshot = browserEvidenceCollection.snapshot();
      return {
        ...snapshot,
        status: pendingEvidenceFailures.length > 0
          ? "failed"
          : interruptedPendingReads > 0
            ? "interrupted"
            : snapshot.status,
        interruptedPendingReads,
      };
    },
    lastCagnotteAuthorization() { return lastCagnotteAuthorization; },
  };
}

function isPlaywrightClosureReason(error: unknown, reason: string): boolean {
  if (error instanceof AggregateError) {
    return error.errors.length > 0 && error.errors.every((entry) => isPlaywrightClosureReason(entry, reason));
  }
  return safeError(error).includes(reason);
}

async function mergeBrowserFirestoreResponseEvidence(
  page: Page,
  ownedPageId: string,
  network: NetworkEvidence[],
) {
  const browserEvidence = await page.evaluate(
    async () => window.__VERDANZA_RECETTE__?.readFirestoreListenResponses() ?? [],
  ) as BrowserFirestoreListenResponse[];
  const claimedIncidents = new Set<NetworkEvidence>();
  for (const entry of browserEvidence) {
    const matches = network.filter((candidate) => (
      !claimedIncidents.has(candidate) &&
      isFirestoreListen400Response(candidate) &&
      candidate.pageId === ownedPageId &&
      candidate.method === entry.method &&
      candidate.origin === entry.origin &&
      candidate.pathname === entry.pathname &&
      candidate.status === entry.status &&
      Math.abs(candidate.occurredAtEpochMs - entry.occurredAtEpochMs) <= 2_000 &&
      sameRequestShape(candidate.requestShape, entry.requestShape)
    ));
    assert.equal(
      matches.length,
      1,
      `capture navigateur Listen 400 sans réponse Playwright unique : ${JSON.stringify(entry)}`,
    );
    const incident = matches[0]!;
    claimedIncidents.add(incident);
    const current = incident.responseSignature;
    if (!entry.responseSignature.captureError) {
      if (current && !current.captureError) {
        assert.deepEqual(
          responseSignaturePayload(current),
          responseSignaturePayload(entry.responseSignature),
          `signatures Playwright et navigateur divergentes : ${JSON.stringify({ current, browser: entry.responseSignature })}`,
        );
      }
      incident.responseSignature = { ...entry.responseSignature };
    } else if (!current || current.captureError) {
      incident.responseSignature = { ...entry.responseSignature };
    }
  }
}

function sameRequestShape(left: RequestShape | undefined, right: RequestShape) {
  return Boolean(left) &&
    left!.hasSessionId === right.hasSessionId &&
    left!.requestIdKind === right.requestIdKind &&
    left!.transportType === right.transportType &&
    left!.protocolVersion === right.protocolVersion &&
    JSON.stringify(left!.queryParameterNames) === JSON.stringify(right.queryParameterNames);
}

function responseSignaturePayload(signature: ResponseSignature) {
  return {
    byteLength: signature.byteLength,
    sha256: signature.sha256,
    contentType: signature.contentType,
    bodyPrefix: signature.bodyPrefix,
    truncated: signature.truncated,
  };
}

export type BrowserEvidencePersistenceMonitor = Pick<
  MonitoredContext,
  "network" | "console" | "settleBrowserEvidence"
>;

export async function persistBrowserEvidence(
  harness: Pick<RecipeHarness, "runDirectory">,
  ...monitors: BrowserEvidencePersistenceMonitor[]
) {
  await Promise.all(monitors.map((monitor) => monitor.settleBrowserEvidence()));
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
  assertPageActive(page);
  const browserEvidence = await page.evaluate(
    () => window.__VERDANZA_RECETTE__?.readFirestoreListenProbe() ?? [],
  );
  const ownedPageId = monitor.pageId(page);
  for (const entry of browserEvidence) {
    const duplicate = target.some((existing) => (
      existing.probeId === entry.probeId &&
      existing.probeInstanceId === entry.probeInstanceId &&
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
      probeInstanceId: entry.probeInstanceId,
      databaseId: entry.databaseId,
      documentPath: entry.documentPath,
      generation: entry.generation,
      fromCache: entry.fromCache,
      hasPendingWrites: entry.hasPendingWrites,
      ...(entry.terminalErrorCode ? { terminalErrorCode: entry.terminalErrorCode } : {}),
    });
  }
}

async function writeAndObserveFirestoreProbeGeneration(options: {
  harness: RecipeHarness;
  viewport: ViewportDefinition;
  page: Page;
  monitor: MonitoredContext;
  probeId: string;
  generation: string;
  evidenceClock: EvidenceClock;
  firestoreProbeEvidence: FirestoreListenProbeEvidence[];
  signal: AbortSignal;
}) {
  await runRecipeScript(
    options.harness,
    `${options.viewport.label}-touch-listen-probe-${options.generation}`,
    "scripts/cagnotte-interactive/touchListenProbe.ts",
    [options.generation],
    options.signal,
  );
  await options.page.waitForFunction(
    ({ generation, expectedProbeId }) => window.__VERDANZA_RECETTE__?.readFirestoreListenProbe()
      .some((entry) => (
        entry.probeId === expectedProbeId &&
        entry.generation === generation &&
        entry.fromCache === false &&
        entry.hasPendingWrites === false &&
        !entry.terminalErrorCode
      )),
    { generation: options.generation, expectedProbeId: options.probeId },
  );
  await collectFirestoreProbeEvidence(
    options.page,
    options.monitor,
    options.evidenceClock,
    options.firestoreProbeEvidence,
  );
}

async function signIn(
  page: Page,
  account: { email: string; password: string },
  afterNavigation?: () => Promise<void>,
) {
  assertPageActive(page);
  await goto(page, "/connexion");
  await afterNavigation?.();
  assertPageActive(page);
  const ageConfirmed = await page.evaluate(() => (
    window.localStorage.getItem("verdanza-age-confirmed") === "true"
  ));
  const ageButton = page.getByRole("button", { name: "J'ai 18 ans ou plus", exact: true });
  if (!ageConfirmed) {
    assertPageActive(page);
    await ageButton.waitFor({ state: "visible", timeout: 15_000 });
    assertPageActive(page);
    await ageButton.click();
    assertPageActive(page);
    await ageButton.waitFor({ state: "detached", timeout: 5_000 });
  }
  const rejectCookies = page.getByRole("button", { name: "Tout refuser" });
  assertPageActive(page);
  if (await rejectCookies.waitFor({ state: "visible", timeout: 2_000 }).then(() => true).catch(() => false)) {
    assertPageActive(page);
    await rejectCookies.click();
  }
  assertPageActive(page);
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  assertPageActive(page);
  await page.locator('input[type="password"]').fill(account.password);
  assertPageActive(page);
  await page.getByRole("button", { name: "Se connecter" }).click();
  try {
    assertPageActive(page);
    await page.waitForURL((url) => url.pathname === "/compte" || url.pathname.startsWith("/compte/"), { timeout: 20_000 });
  } catch (error) {
    writeRecipeStderrLine(`Échec du formulaire Auth Emulator (${page.url()}) : ${(await mainText(page)).slice(0, 1_500)}`);
    throw error;
  }
}

async function signOut(page: Page) {
  assertPageActive(page);
  await goto(page, "/compte/avantages");
  assertPageActive(page);
  await page.getByRole("heading", { name: "Mes avantages" }).waitFor();
  assertPageActive(page);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/connexion", { timeout: 15_000 }),
    page.getByRole("button", { name: "Deconnexion" }).click(),
  ]);
}

async function openAdvantages(page: Page, email: string) {
  assertPageActive(page);
  await goto(page, "/compte/avantages");
  assertPageActive(page);
  await page.getByRole("heading", { name: "Mes avantages" }).waitFor({ timeout: 15_000 });
  await waitForMainText(page, (text) => text.includes(email), `session visible pour ${email}`);
}

async function refreshAdvantages(page: Page) {
  assertPageActive(page);
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
  assertPageActive(page);
  await goto(page, "/boutique");
  assertPageActive(page);
  await page.getByRole("heading", { name: "Trouvez votre sélection", exact: true }).waitFor();
  assertPageActive(page);
  await page.getByRole("button", { name: `Ajouter 1 g de ${RECIPE_PRODUCT.name} au panier`, exact: true }).click();
  assertPageActive(page);
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
  assertPageActive(page);
  await goto(page, "/panier");
  assertPageActive(page);
  await page.getByRole("heading", { name: "Panier" }).waitFor();
  await waitForMainText(page, (text) => text.includes(RECIPE_PRODUCT.name) && text.includes("100,00 EUR"), "panier fictif à 100 euros");
  if (useCagnotte) await waitForBalance(page, "Disponible", "5,00 €");
  assertPageActive(page);
  await page.getByRole("link", { name: "Continuer" }).click();
  assertPageActive(page);
  await page.waitForURL((url) => url.pathname === "/checkout");
  assertPageActive(page);
  await page.getByRole("heading", { name: "Finaliser ma commande" }).waitFor();
  assertPageActive(page);
  await page.getByLabel("Prénom", { exact: true }).fill("Client");
  assertPageActive(page);
  await page.getByLabel("Nom", { exact: true }).fill("Fictif");
  assertPageActive(page);
  await page.getByLabel("Téléphone", { exact: true }).fill(label === "desktop" ? "0600000101" : "0600000202");
  assertPageActive(page);
  await page.getByLabel("Adresse", { exact: true }).fill("1 rue Fictive");
  assertPageActive(page);
  await page.getByLabel("Code postal", { exact: true }).fill("13100");
  assertPageActive(page);
  await page.getByLabel("Ville", { exact: true }).fill("Aix-en-Provence");
  assertPageActive(page);
  await page.getByLabel("Pays", { exact: true }).fill("France");

  if (useCagnotte) {
    await waitForBalance(page, "Disponible", "5,00 €");
    assertPageActive(page);
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
    assertPageActive(page);
    await page.getByRole("button", { name: /Accepter.*95,00/ }).click();
    assertPageActive(page);
    await page.getByRole("button", { name: /Montant accepté.*95,00/ }).waitFor();
  }

  assertPageActive(page);
  await page.getByRole("checkbox", { name: /Je confirme être majeur/ }).check();
  await beforeSubmit?.();
  assertPageActive(page);
  await page.waitForTimeout(950);
  assertPageActive(page);
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
  assertPageActive(page);
  await page.waitForURL((url) => url.pathname === "/checkout/success", { timeout: 20_000 });
  assertPageActive(page);
  await page.getByRole("heading", { name: "Commande enregistrée" }).waitFor({ timeout: 15_000 });
  if (useCagnotte) {
    await waitForMainText(page, (text) =>
      text.includes("Financement prévu par cagnotte : 5,00 EUR") &&
      text.includes("À régler hors cagnotte : 95,00 EUR"), "récapitulatif B réservé");
  }
  return body;
}

async function openAdminOrders(page: Page, filter: "Toutes" | "Livrées") {
  assertPageActive(page);
  const wasAlreadyOpen = safeUrl(page.url())?.pathname === "/admin/commandes";
  await goto(page, "/admin/commandes");
  assertPageActive(page);
  await page.getByRole("heading", { name: "Commandes" }).waitFor({ timeout: 20_000 });
  const loading = page.getByText("Chargement des donnees...", { exact: true });
  if (wasAlreadyOpen) {
    assertPageActive(page);
    await page.getByRole("button", { name: "Rafraichir", exact: true }).click();
    assertPageActive(page);
    await loading.waitFor({ state: "visible", timeout: 5_000 });
  }
  assertPageActive(page);
  await loading.waitFor({ state: "hidden", timeout: 20_000 });
  const filterButton = page.getByRole("button", { name: filter, exact: true });
  assertPageActive(page);
  await filterButton.waitFor({ state: "visible", timeout: 20_000 });
  assertPageActive(page);
  await filterButton.click();
}

async function updateOrder(
  page: Page,
  orderId: string,
  kind: "payment" | "order",
  value: "paid" | "delivered",
) {
  assertPageActive(page);
  const card = await visibleOrderCard(page, orderId);
  const selector = kind === "payment"
    ? card.locator('select:has(option[value="paid"])')
    : card.locator('select:has(option[value="delivered"])');
  page.once("dialog", (dialog) => void dialog.accept(kind === "payment" ? "card_payment_link" : "Recette locale fictive"));
  assertPageActive(page);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => safeUrl(candidate.url())?.pathname === "/api/update-order-status" && candidate.request().method() === "POST", { timeout: 20_000 }),
    selector.selectOption(value),
  ]);
  const body = await response.text();
  assert.equal(response.status(), 200, `${kind} ${orderId}: ${body}`);
  assertPageActive(page);
  await page.waitForTimeout(350);
}

async function recordFullRefund(
  page: Page,
  orderId: string,
  viewport: string,
  confirmedAt: { localValue: string; confirmedAtEpochMs: number },
) {
  assertPageActive(page);
  const card = await visibleOrderCard(page, orderId);
  const tools = card.locator('section[aria-label="Outils administratifs de cagnotte"]');
  assertPageActive(page);
  await tools.waitFor({ state: "visible", timeout: 20_000 });
  assertPageActive(page);
  await tools.getByRole("heading", { name: "Enregistrer un remboursement déjà confirmé" }).waitFor();
  assertPageActive(page);
  await tools.getByRole("button", { name: "Tout le montant restant" }).click();
  assertPageActive(page);
  await tools.getByLabel("Montant financier déclaré (€)", { exact: true }).fill("95,00");
  assertPageActive(page);
  await tools.getByLabel("Référence métier", { exact: true }).fill(`recette-interactive-${viewport}`);
  await waitUntilPast(page, confirmedAt.confirmedAtEpochMs);
  await setDateTimeLocal(
    tools.getByLabel("Date de confirmation", { exact: true }),
    confirmedAt.localValue,
  );
  assertPageActive(page);
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
  assertPageActive(page);
  await tools.getByText("Conséquences calculées par le serveur", { exact: true }).waitFor();
  assertPageActive(page);
  await tools.getByText("Prévisualisation serveur prête.", { exact: true }).waitFor();
  const confirmButton = tools.getByRole("button", { name: "Confirmer l’enregistrement" });
  await waitForButtonEnabled(confirmButton);
  assertPageActive(page);
  await page.waitForTimeout(100);
  let confirmed: PlaywrightResponse;
  try {
    assertPageActive(page);
    [confirmed] = await Promise.all([
      page.waitForResponse((candidate) => isJsonAction(candidate, "/api/order-refunds", "record_confirmed")),
      confirmButton.click(),
    ]);
  } catch (error) {
    assertPageActive(page);
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
  assertPageActive(page);
  const card = page.locator("article.rounded-lg:visible").filter({ hasText: orderId }).first();
  await card.waitFor({ state: "visible", timeout: 20_000 });
  return card;
}

async function inspectState(
  harness: RecipeHarness,
  label: string,
  uid: string,
  signal: AbortSignal,
): Promise<RecipeState> {
  const output = resolve(harness.runDirectory, `state-${safeName(label)}.json`);
  await runRecipeScript(harness, `state-${safeName(label)}`, "scripts/cagnotte-interactive/state.ts", [
    `--uid=${uid}`,
    `--output=${output}`,
  ], signal);
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
  return assertCreateOrderRateLimitEvidence(state.rateLimits, attempts);
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
  assertPageActive(page);
  const banner = page.locator('[data-verdanza-recette="local-interactive"]');
  await banner.waitFor({ state: "visible" });
  assertPageActive(page);
  assert.equal(await banner.textContent(), "RECETTE LOCALE — DONNÉES FICTIVES");
}

async function goto(page: Page, pathname: string) {
  assertPageActive(page);
  const target = localUrl(RECIPE_PORTS.app, pathname);
  if (safeUrl(page.url())?.pathname === pathname) {
    await assertRecipeBanner(page);
    return;
  }
  const applicationLink = page.locator(`a[href="${pathname}"]`).first();
  if (page.url().startsWith(localUrl(RECIPE_PORTS.app)) && await applicationLink.count()) {
    assertPageActive(page);
    await Promise.all([
      page.waitForURL((url) => url.pathname === pathname, { timeout: 15_000 }),
      applicationLink.evaluate((element) => (element as HTMLAnchorElement).click()),
    ]);
  } else if (pathname.startsWith("/admin/")) {
    assertPageActive(page);
    const response = await page.goto(target, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200, `${pathname} doit être servi localement`);
  } else if (page.url().startsWith(localUrl(RECIPE_PORTS.app))) {
    assertPageActive(page);
    await Promise.all([
      page.waitForURL((url) => url.pathname === pathname, { timeout: 15_000 }),
      page.evaluate((nextPathname) => {
        window.history.pushState(null, "", nextPathname);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, pathname),
    ]);
  } else {
    assertPageActive(page);
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
  assertPageActive(page);
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
    assertPageActive(page);
    observed = await mainText(page).catch(() => "");
    if (predicate(observed)) return observed;
    assertPageActive(page);
    await page.waitForTimeout(100);
  }
  throw new Error(`${description} non observé. Texte final : ${observed.slice(0, 2_000)}`);
}

async function waitForButtonEnabled(button: ReturnType<Page["getByRole"]>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertPageActive(button.page());
    if (await button.isEnabled().catch(() => false)) return;
    assertPageActive(button.page());
    await button.page().waitForTimeout(25);
  }
  throw new Error("Le bouton attendu n'est pas devenu actif.");
}

async function setDateTimeLocal(input: ReturnType<Page["getByLabel"]>, value: string) {
  assertPageActive(input.page());
  await input.evaluate((element, nextValue) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Setter natif datetime-local indisponible.");
    setter.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  assert.equal(await input.inputValue(), value);
}

async function waitUntilPast(page: Page, epochMs: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() <= epochMs) {
    if (Date.now() >= deadline) throw new Error("La date de confirmation dérivée du paiement reste dans le futur.");
    assertPageActive(page);
    await page.waitForTimeout(Math.min(100, epochMs - Date.now() + 1));
  }
}

async function mainText(page: Page) {
  assertPageActive(page);
  return normalizeText(await page.locator("main").innerText());
}

function assertPageActive(page: Page) {
  pageCancellations.get(page)?.throwIfRequested();
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
      captureSource: "playwright",
    };
  } catch (error) {
    return {
      byteLength: -1,
      sha256: "",
      contentType: response.headers()["content-type"] ?? null,
      bodyPrefix: "",
      truncated: false,
      captureSource: "playwright",
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
      writeRecipeStderrLine(`[emulator-diagnostics] log auxiliaire indisponible code=${sourceReadErrorCode}`);
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
  writeRecipeStderrLine(`[cleanup:${label}] ${step.name}: ${step.error ?? "échec sans détail"}`);
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
