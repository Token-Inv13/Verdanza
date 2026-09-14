import { appendFile, mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { createOrderHandler } from "../../api/create-order.js";
import { createQuoteOrderHandler } from "../../api/quote-order.js";
import { readCagnotte } from "../../api/_server/cagnotteRead.js";
import { createCagnotteReadHandler } from "../../api/_server/cagnotteReadRoute.js";
import { CAGNOTTE_RESERVATION_VERSION } from "../../api/_server/cagnotteLedgerTypes.js";
import { createOrderRefundHandler } from "../../api/_server/orderRefundRoute.js";
import { createOrderStatusHandler } from "../../api/_server/orderStatusRoute.js";
import { enforcePublicSubmissionRateLimit } from "../../api/_server/publicRateLimit.js";
import type { VercelRequestLike, VercelResponseLike } from "../../api/_server/http.js";
import {
  localUrl,
  RECIPE_CURSOR_SECRET,
  RECIPE_HOST,
  RECIPE_PORTS,
  RECIPE_PROGRAM_VERSION,
  RECIPE_PROJECT_ID,
  RECIPE_RATE_LIMIT_SECRET,
} from "./constants.js";
import { validateCurrentRecipeProcess } from "./environment.js";
import { closeRecipeFirestore, getRecipeFirestore } from "./firestore.js";
import { verifyLocalAuthEmulatorToken } from "./authVerifier.js";
import {
  API_DIAGNOSTICS_PATH,
  API_SHUTDOWN_PATH,
  createDiagnosticJournal,
  createDiagnosticRequestLifecycle,
  createJournaledRequestListener,
  diagnosticErrorCode,
} from "./diagnosticJournal.js";

validateCurrentRecipeProcess();
const runDirectory = process.env.VERDANZA_RECETTE_RUN_DIR;
if (!runDirectory) throw new Error("ISOLATION: dossier d’exécution absent.");
await mkdir(runDirectory, { recursive: true });
const requestLogPath = resolve(runDirectory, "api-requests.jsonl");
const diagnosticJournal = createDiagnosticJournal({
  appendLine: (line) => appendFile(requestLogPath, line, "utf8"),
  reportFailure: (failure) => {
    console.error(
      `[diagnostic-journal] écriture impossible kind=${failure.kind} ` +
      `code=${failure.code} sequence=${failure.sequence}`,
    );
  },
});
const requestLifecycle = createDiagnosticRequestLifecycle({ journal: diagnosticJournal });
const db = getRecipeFirestore();
const localProgram = Object.freeze({
  mode: "local_test" as const,
  programVersion: RECIPE_PROGRAM_VERSION,
  calculationVersion: "cagnotte-math-v1" as const,
  startsAtEpochMs: Date.UTC(2000, 0, 1),
  newAccrualsEnabled: true,
});
const localReservationProgram = Object.freeze({
  mode: "local_test" as const,
  programVersion: RECIPE_PROGRAM_VERSION,
  calculationVersion: "cagnotte-math-v1" as const,
  startsAtEpochMs: Date.UTC(2000, 0, 1),
  reservationVersion: CAGNOTTE_RESERVATION_VERSION,
  reservationsEnabled: true,
});

const quoteOrder = createQuoteOrderHandler({
  getDb: () => db,
  verifyToken: verifyLocalAuthEmulatorToken,
  accrualProgram: localProgram,
  reservationProgram: localReservationProgram,
  getFirebaseProjectId: () => RECIPE_PROJECT_ID,
});
const createOrder = createOrderHandler({
  getDb: () => db,
  verifyToken: verifyLocalAuthEmulatorToken,
  accrualProgram: localProgram,
  reservationProgram: localReservationProgram,
  getFirebaseProjectId: () => RECIPE_PROJECT_ID,
  enforceRateLimit: (input) => enforcePublicSubmissionRateLimit({
    ...input,
    db,
    secret: RECIPE_RATE_LIMIT_SECRET,
  }),
  processSideEffects: async () => ({
    client: { status: "skipped" as const, reason: "local_recipe_external_effects_disabled" },
    admin: { status: "skipped" as const, reason: "local_recipe_external_effects_disabled" },
  }),
});
const cagnotteRead = createCagnotteReadHandler({
  enabled: true,
  getDb: () => db,
  verifyToken: verifyLocalAuthEmulatorToken,
  read: readCagnotte,
  cursorSecret: () => RECIPE_CURSOR_SECRET,
  capabilities: { canRequestReservation: true, canAccrueLoyalty: true },
});
const updateOrderStatus = createOrderStatusHandler({
  getDb: () => db,
  verifyToken: verifyLocalAuthEmulatorToken,
  accrualProgram: localProgram,
  reservationProgram: localReservationProgram,
  getFirebaseProjectId: () => RECIPE_PROJECT_ID,
  sendStatusEmail: async () => ({ status: "skipped", reason: "local_recipe_external_effects_disabled" }),
  processAnalytics: async () => ({ status: "skipped", code: "local_recipe_external_effects_disabled" }),
});
const orderRefund = createOrderRefundHandler({
  enabled: true,
  getDb: () => db,
  verifyToken: verifyLocalAuthEmulatorToken,
  log: (entry) => {
    void diagnosticJournal.record({ kind: "refund-audit", details: sanitizeDetails(entry) });
  },
});

await assertEmulatorsReady();

const server = createServer(createJournaledRequestListener({
  journal: diagnosticJournal,
  lifecycle: requestLifecycle,
  resolveRoute: (request) => new URL(request.url || "/", localUrl(RECIPE_PORTS.api)).pathname,
  handle: async ({ request, response, route, setStatus }) => {
    const apiResponse = decorateResponse(response, setStatus);
    if (route === API_DIAGNOSTICS_PATH || route === API_SHUTDOWN_PATH) {
      const diagnostics = await requestLifecycle.finalize();
      if (route === API_SHUTDOWN_PATH) response.once("finish", requestShutdown);
      apiResponse.status(diagnostics.complete ? 200 : 503).json(diagnostics);
      return;
    }
    if (route === "/__recette/health" || route === "/api/__recette/health") {
      return apiResponse.status(200).json({
        ok: true,
        mode: "local-interactive",
        projectId: RECIPE_PROJECT_ID,
        listeners: { host: RECIPE_HOST, ...RECIPE_PORTS },
        externalEffects: { payment: false, email: false, sms: false, analytics: false, storage: false },
        localCapabilities: { read: true, reservations: true, accruals: true, adminTools: true, refunds: true },
      });
    }
    if (route === "/api/public-promo-banners") {
      apiResponse.status(503).json({
        code: "local_external_service_disabled",
        error: "Service extérieur neutralisé dans la recette locale.",
      });
      return;
    }
    const handler = new Map<string, (req: VercelRequestLike, res: VercelResponseLike) => Promise<void>>([
      ["/api/quote-order", quoteOrder],
      ["/api/create-order", createOrder],
      ["/api/cagnotte", cagnotteRead],
      ["/api/update-order-status", updateOrderStatus],
      ["/api/order-refunds", orderRefund],
    ]).get(route);
    if (handler) {
      await handler(await decorateRequest(request), apiResponse);
      return;
    }
    apiResponse.status(503).json({
      code: "local_external_service_disabled",
      error: "Service extérieur neutralisé dans la recette locale.",
    });
  },
  handleRejected: ({ response, setStatus }) => {
    if (!response.headersSent) response.setHeader("connection", "close");
    decorateResponse(response, setStatus).status(503).json({
      code: "local_api_shutting_down",
      error: "La recette locale est en cours d’arrêt.",
    });
  },
  handleError: ({ error, response, setStatus }) => {
    setStatus(500);
    if (!response.headersSent) {
      decorateResponse(response, () => undefined).status(500).json({
        code: "local_handler_failed_closed",
        error: "Le handler local a échoué sans repli distant.",
      });
    } else if (!response.writableEnded) {
      response.end();
    }
    console.error("local API handler failed closed", error);
  },
  isControlRoute: (route) => route === API_DIAGNOSTICS_PATH || route === API_SHUTDOWN_PATH,
  shouldRecord: (route) => route !== API_DIAGNOSTICS_PATH && route !== API_SHUTDOWN_PATH,
  reportListenerFailure: (failure) => {
    console.error(`[diagnostic-listener] échec interne contenu code=${failure.code}`);
  },
}));

server.on("error", (error) => {
  console.error("RECETTE LOCALE API indisponible", error);
  process.exitCode = 1;
});
server.listen(RECIPE_PORTS.api, RECIPE_HOST, () => {
  console.log(`RECETTE_API_READY ${localUrl(RECIPE_PORTS.api, "/__recette/health")}`);
});

const shutdownSignals = ["SIGINT", "SIGTERM"] as const;
let shutdownPromise: Promise<void> | undefined;
function requestShutdown() {
  requestLifecycle.closeAdmission();
  if (!shutdownPromise) {
    shutdownPromise = (async () => {
      const failures: Array<{ phase: string; error: unknown }> = [];
      try {
        const diagnostics = await requestLifecycle.finalize();
        if (!diagnostics.complete) {
          process.exitCode = 1;
          console.error(
            "[diagnostic-journal] arrêt avec preuves incomplètes " +
            `failed=${diagnostics.writes.failed} timedOut=${diagnostics.writes.timedOut} ` +
            `pending=${diagnostics.writes.pending}`,
          );
        }
      } catch (error) {
        failures.push({ phase: "diagnostics", error });
      }
      try {
        await closeHttpServer(server);
      } catch (error) {
        failures.push({ phase: "http", error });
      }
      try {
        await closeRecipeFirestore();
      } catch (error) {
        failures.push({ phase: "firestore", error });
      }
      for (const signal of shutdownSignals) process.off(signal, requestShutdown);
      if (failures.length > 0) {
        process.exitCode = 1;
        for (const failure of failures) {
          console.error(
            `[recette-shutdown:${failure.phase}] échec contenu code=${diagnosticErrorCode(failure.error)}`,
          );
        }
      }
    })();
  }
}
for (const signal of shutdownSignals) process.on(signal, requestShutdown);

async function decorateRequest(request: IncomingMessage): Promise<VercelRequestLike> {
  const target = request as VercelRequestLike;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > 1_000_000) throw new Error("Payload local trop volumineux.");
      chunks.push(bytes);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    target.body = raw ? JSON.parse(raw) : undefined;
  }
  return target;
}

function decorateResponse(response: ServerResponse, observeStatus: (status: number) => void) {
  const target = response as VercelResponseLike;
  target.status = (statusCode: number) => {
    observeStatus(statusCode);
    target.statusCode = statusCode;
    return target;
  };
  target.json = (data: unknown) => {
    if (!target.headersSent) target.setHeader("content-type", "application/json; charset=utf-8");
    target.end(JSON.stringify(data));
  };
  return target;
}

async function assertEmulatorsReady() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== `${RECIPE_HOST}:${RECIPE_PORTS.firestore}` ||
      process.env.FIREBASE_AUTH_EMULATOR_HOST !== `${RECIPE_HOST}:${RECIPE_PORTS.auth}`) {
    throw new Error("ISOLATION: endpoints émulateurs incohérents.");
  }
  const auth = await fetch(localUrl(RECIPE_PORTS.auth, "/identitytoolkit.googleapis.com/v1/accounts:lookup?key=demo-api-key"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: "recette-local-presence-probe" }),
  });
  if (auth.status >= 500 || auth.status === 404 || auth.status === 405) {
    throw new Error(`ISOLATION: Auth Emulator indisponible (HTTP ${auth.status}).`);
  }
  await db.listCollections();
}

function sanitizeDetails(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/token|password|authorization/i.test(key))
    .map(([key, entry]) => [key, typeof entry === "string" && entry.length > 200 ? `${entry.slice(0, 200)}…` : entry]));
}

async function closeHttpServer(target: typeof server) {
  if (!target.listening) return;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      new Promise<void>((resolvePromise, reject) => {
        target.close((error) => {
          if (error) reject(error);
          else resolvePromise();
        });
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          target.closeAllConnections();
          reject(new Error("Arrêt HTTP local hors délai."));
        }, 2_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
