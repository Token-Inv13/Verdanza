import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import {
  assertDiagnosticJournalComplete,
  createDiagnosticJournal,
  createJournaledRequestListener,
  type DiagnosticJournalSnapshot,
} from "./diagnosticJournal.js";

if (process.argv.includes("--strict-http-child")) {
  await runStrictHttpChild();
} else {
  await runTests();
}

async function runTests() {
  const failures: Array<{ name: string; error: string }> = [];
  const check = async (name: string, test: () => Promise<void>) => {
    try {
      await test();
      console.log(`[OK] ${name}`);
    } catch (error) {
      failures.push({ name, error: safeError(error) });
      console.error(`[ECHEC] ${name}: ${safeError(error)}`);
    }
  };

  await check("échec void du journal refund-audit consommé et expurgé", async () => {
    const reported: unknown[] = [];
    const journal = createDiagnosticJournal({
      appendLine: async () => { throw syntheticFsError("EACCES", "password=secret cookie=session"); },
      reportFailure: (failure) => { reported.push(failure); },
    });
    void journal.record({ kind: "refund-audit", details: { result: "recorded" } });
    const snapshot = await journal.sealAndSynchronize(100);
    assert.equal(snapshot.writes.failed, 1);
    assert.equal(snapshot.writes.pending, 0);
    assert.equal(snapshot.failureSamples[0]?.code, "EACCES");
    assert.doesNotMatch(JSON.stringify({ snapshot, reported }), /password|secret|cookie|session/i);
  });

  await check("reprise d’écriture sans effacer la perte antérieure", async () => {
    let calls = 0;
    const journal = createDiagnosticJournal({
      appendLine: async () => {
        calls += 1;
        if (calls === 1) throw syntheticFsError("ENOSPC", "first-write");
      },
    });
    await journal.record({ kind: "api-request", status: 204 });
    await journal.record({ kind: "api-request", status: 200 });
    const snapshot = await journal.sealAndSynchronize(100);
    assert.equal(snapshot.writes.attempted, 2);
    assert.equal(snapshot.writes.failed, 1);
    assert.equal(snapshot.writes.succeeded, 1);
    assert.equal(snapshot.complete, false, "une écriture ultérieure réussie ne doit pas effacer la perte");
  });

  await check("rejet tardif consommé après une synchronisation bornée", async () => {
    let rejectWrite: ((error: Error) => void) | undefined;
    const delayed = new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
    const journal = createDiagnosticJournal({ appendLine: () => delayed });
    const tracked = journal.record({ kind: "api-request", status: 204 });
    const timedOut = await journal.sealAndSynchronize(20);
    assert.equal(timedOut.writes.pending, 1);
    assert.equal(timedOut.writes.timedOut, 1);
    assert.equal(timedOut.complete, false);
    rejectWrite?.(syntheticFsError("ENOSPC", "late-write"));
    await tracked;
    const settled = await journal.synchronize(100);
    assert.equal(settled.writes.pending, 0);
    assert.equal(settled.writes.failed, 1);
    assert.equal(settled.writes.timedOut, 1, "le dépassement antérieur reste signalé après le rejet tardif");
  });

  await check("preuve obligatoire incomplète refusée explicitement", async () => {
    const journal = createDiagnosticJournal({
      appendLine: async () => { throw syntheticFsError("ENOSPC", "mandatory-proof"); },
    });
    await journal.record({ kind: "api-request", status: 204 });
    const snapshot = await journal.sealAndSynchronize(100);
    assert.throws(() => assertDiagnosticJournalComplete(snapshot), /DIAGNOSTICS INCOMPLETS/);
  });

  await check("serveur HTTP réel strict préserve réponses et erreur métier", async () => {
    const result = await runStrictHttpParent();
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.successStatus, 204);
    assert.equal(result.errorStatus, 500);
    assert.deepEqual(result.businessCalls, { success: 1, error: 1 });
    assert.deepEqual(result.responseEndCalls, { success: 1, error: 1 });
    assert.equal(result.primaryError, "injected-primary-handler-error");
    assert.equal(result.snapshot.writes.failed, 2);
    assert.equal(result.snapshot.writes.pending, 0);
    assert.equal(result.snapshot.complete, false);
  });

  if (failures.length > 0) {
    console.error(`Journalisation de diagnostic en échec : ${failures.length} cas.`);
    for (const failure of failures) console.error(`- ${failure.name}: ${failure.error}`);
    process.exitCode = 1;
    return;
  }
  console.log("Journalisation de diagnostic vérifiée : rejets contenus, état explicite et arrêt borné.");
}

type StrictHttpResult = {
  exitCode: number | null;
  stderr: string;
  successStatus: number;
  errorStatus: number;
  businessCalls: { success: number; error: number };
  responseEndCalls: { success: number; error: number };
  primaryError: string;
  snapshot: DiagnosticJournalSnapshot;
};

async function runStrictHttpParent(): Promise<StrictHttpResult> {
  const child = spawn(process.execPath, [
    "--unhandled-rejections=strict",
    "--import", "tsx",
    fileURLToPath(import.meta.url),
    "--strict-http-child",
  ], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const port = await waitForReadyPort(() => stdout, child);
  const successResponse = await fetch(`http://127.0.0.1:${port}/success`);
  const errorResponse = await fetch(`http://127.0.0.1:${port}/handler-error`);
  const exitCode = await waitForExit(child, 5_000);
  const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith("STRICT_HTTP_RESULT "));
  assert.ok(resultLine, `résultat enfant absent\nstdout=${stdout}\nstderr=${stderr}`);
  const parsed = JSON.parse(resultLine.slice("STRICT_HTTP_RESULT ".length)) as Omit<StrictHttpResult, "exitCode" | "stderr">;
  return {
    ...parsed,
    exitCode,
    stderr,
    successStatus: successResponse.status,
    errorStatus: errorResponse.status,
  };
}

async function runStrictHttpChild() {
  const businessCalls = { success: 0, error: 0 };
  const responseEndCalls = { success: 0, error: 0 };
  let primaryError = "";
  let completedResponses = 0;
  let finalizeScheduled = false;
  const journal = createDiagnosticJournal({
    appendLine: async () => {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
      throw syntheticFsError(completedResponses <= 1 ? "ENOSPC" : "EACCES", "sensitive=omitted");
    },
  });
  const server = createServer(createJournaledRequestListener({
    journal,
    resolveRoute: (request) => new URL(request.url || "/", "http://127.0.0.1").pathname,
    handle: async ({ response, route, setStatus }) => {
      if (route === "/success") {
        businessCalls.success += 1;
        setStatus(204);
        response.statusCode = 204;
        responseEndCalls.success += 1;
        response.end();
        return;
      }
      if (route === "/handler-error") {
        businessCalls.error += 1;
        throw new Error("injected-primary-handler-error");
      }
      setStatus(404);
      response.statusCode = 404;
      response.end();
    },
    handleError: ({ error, response, setStatus }) => {
      primaryError = error instanceof Error ? error.message : String(error);
      setStatus(500);
      response.statusCode = 500;
      responseEndCalls.error += 1;
      response.end("handler-failed");
    },
  }));

  server.on("request", (_request, response) => {
    response.once("finish", () => {
      completedResponses += 1;
      if (completedResponses !== 2 || finalizeScheduled) return;
      finalizeScheduled = true;
      setImmediate(() => {
        void journal.sealAndSynchronize(250).then((snapshot) => {
          console.log(`STRICT_HTTP_RESULT ${JSON.stringify({
            businessCalls,
            responseEndCalls,
            primaryError,
            snapshot,
          })}`);
          server.close(() => process.exit(0));
        });
      });
    });
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Adresse HTTP enfant indisponible.");
    console.log(`STRICT_HTTP_READY ${address.port}`);
  });
}

async function waitForReadyPort(readOutput: () => string, child: ReturnType<typeof spawn>) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const match = readOutput().match(/STRICT_HTTP_READY (\d+)/);
    if (match) return Number(match[1]);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Le serveur HTTP enfant s’est arrêté avant d’être prêt (code ${child.exitCode}).`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  child.kill();
  throw new Error("Le serveur HTTP enfant n’est pas devenu prêt dans le délai.");
}

async function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      new Promise<number | null>((resolvePromise, reject) => {
        child.once("exit", resolvePromise);
        child.once("error", reject);
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Arrêt du serveur HTTP enfant hors délai.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

function syntheticFsError(code: "ENOSPC" | "EACCES", message: string) {
  return Object.assign(new Error(message), { code });
}

function safeError(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
