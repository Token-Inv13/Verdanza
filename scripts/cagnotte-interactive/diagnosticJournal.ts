import type { IncomingMessage, ServerResponse } from "node:http";

export const API_DIAGNOSTICS_PATH = "/__recette/diagnostics";

const MAX_FAILURE_SAMPLES = 8;
const DEFAULT_SYNC_TIMEOUT_MS = 2_000;

export type DiagnosticFailureSample = {
  sequence: number;
  kind: string;
  code: string;
  reason: "write_failed" | "write_after_seal" | "control_failure";
};

export type DiagnosticJournalSnapshot = {
  schemaVersion: 1;
  state: "COMPLETE" | "DIAGNOSTICS_INCOMPLETE";
  complete: boolean;
  sealed: boolean;
  writes: {
    attempted: number;
    succeeded: number;
    failed: number;
    pending: number;
    timedOut: number;
    afterSeal: number;
  };
  failureSamples: DiagnosticFailureSample[];
};

export type DiagnosticJournal = {
  record: (entry: Record<string, unknown>) => Promise<void>;
  snapshot: () => DiagnosticJournalSnapshot;
  synchronize: (timeoutMs?: number) => Promise<DiagnosticJournalSnapshot>;
  sealAndSynchronize: (timeoutMs?: number) => Promise<DiagnosticJournalSnapshot>;
};

type DiagnosticJournalOptions = {
  appendLine: (line: string) => Promise<void>;
  now?: () => Date;
  reportFailure?: (failure: DiagnosticFailureSample) => void;
};

export function createDiagnosticJournal(options: DiagnosticJournalOptions): DiagnosticJournal {
  const pending = new Map<number, Promise<void>>();
  const timedOutSequences = new Set<number>();
  const failureSamples: DiagnosticFailureSample[] = [];
  const now = options.now ?? (() => new Date());
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let afterSeal = 0;
  let sealed = false;

  const rememberFailure = (failure: DiagnosticFailureSample) => {
    if (failure.reason === "write_after_seal") afterSeal += 1;
    else failed += 1;
    if (failureSamples.length < MAX_FAILURE_SAMPLES) failureSamples.push(failure);
    if (options.reportFailure) {
      try {
        options.reportFailure(failure);
      } catch (reportError) {
        const reportCode = diagnosticErrorCode(reportError);
        console.error(`[diagnostic-journal] rapport local indisponible code=${reportCode}`);
      }
    }
  };

  const snapshot = (): DiagnosticJournalSnapshot => {
    const complete = failed === 0 && afterSeal === 0 && timedOutSequences.size === 0 && pending.size === 0;
    return {
      schemaVersion: 1,
      state: complete ? "COMPLETE" : "DIAGNOSTICS_INCOMPLETE",
      complete,
      sealed,
      writes: {
        attempted,
        succeeded,
        failed,
        pending: pending.size,
        timedOut: timedOutSequences.size,
        afterSeal,
      },
      failureSamples: failureSamples.map((failure) => ({ ...failure })),
    };
  };

  const record = (entry: Record<string, unknown>): Promise<void> => {
    const sequence = ++attempted;
    const kind = diagnosticKind(entry.kind);
    if (sealed) {
      rememberFailure({ sequence, kind, code: "JOURNAL_SEALED", reason: "write_after_seal" });
      return Promise.resolve();
    }

    const write = Promise.resolve().then(() => options.appendLine(
      `${JSON.stringify({ at: now().toISOString(), ...entry })}\n`,
    ));
    const tracked = write.then(
      () => { succeeded += 1; },
      (error) => {
        rememberFailure({
          sequence,
          kind,
          code: diagnosticErrorCode(error),
          reason: "write_failed",
        });
      },
    ).finally(() => {
      pending.delete(sequence);
    });
    pending.set(sequence, tracked);
    return tracked;
  };

  const synchronize = async (timeoutMs = DEFAULT_SYNC_TIMEOUT_MS): Promise<DiagnosticJournalSnapshot> => {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (pending.size > 0) {
      const current = [...pending.entries()];
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0 || !(await settlesWithin(current.map(([, promise]) => promise), remainingMs))) {
        for (const [sequence] of current) timedOutSequences.add(sequence);
        break;
      }
    }
    return snapshot();
  };

  return {
    record,
    snapshot,
    synchronize,
    sealAndSynchronize: async (timeoutMs) => {
      sealed = true;
      return synchronize(timeoutMs);
    },
  };
}

type JournaledRequestContext = {
  request: IncomingMessage;
  response: ServerResponse;
  route: string;
  setStatus: (status: number) => void;
};

type JournaledRequestListenerOptions = {
  journal: DiagnosticJournal;
  resolveRoute: (request: IncomingMessage) => string;
  handle: (context: JournaledRequestContext) => Promise<void>;
  handleError: (context: JournaledRequestContext & { error: unknown }) => void;
  shouldRecord?: (route: string) => boolean;
  reportListenerFailure?: (failure: { code: string; phase: "listener" }) => void;
};

export function createJournaledRequestListener(options: JournaledRequestListenerOptions) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const startedAt = Date.now();
    let route = "/";
    let status = 500;
    const setStatus = (nextStatus: number) => { status = nextStatus; };
    const completion = (async () => {
      try {
        route = options.resolveRoute(request);
        await options.handle({ request, response, route, setStatus });
      } catch (error) {
        options.handleError({ request, response, route, setStatus, error });
      } finally {
        if (options.shouldRecord?.(route) !== false) {
          void options.journal.record({
            kind: "api-request",
            method: request.method || "",
            pathname: route,
            status,
            durationMs: Date.now() - startedAt,
          });
        }
      }
    })();

    void completion.catch((error) => {
      const failure = { code: diagnosticErrorCode(error), phase: "listener" as const };
      try {
        options.reportListenerFailure?.(failure);
      } catch (reportError) {
        console.error(
          `[diagnostic-listener] rapport local indisponible code=${diagnosticErrorCode(reportError)}`,
        );
      }
    });
  };
}

export function assertDiagnosticJournalComplete(snapshot: DiagnosticJournalSnapshot) {
  if (!snapshot.complete) {
    throw new Error(
      "DIAGNOSTICS INCOMPLETS: " +
      `${snapshot.writes.failed} écriture(s) en échec, ` +
      `${snapshot.writes.timedOut} hors délai, ` +
      `${snapshot.writes.afterSeal} après scellement et ` +
      `${snapshot.writes.pending} en attente.`,
    );
  }
}

export function incompleteDiagnosticJournalSnapshot(code: string): DiagnosticJournalSnapshot {
  return {
    schemaVersion: 1,
    state: "DIAGNOSTICS_INCOMPLETE",
    complete: false,
    sealed: false,
    writes: {
      attempted: 0,
      succeeded: 0,
      failed: 1,
      pending: 0,
      timedOut: 0,
      afterSeal: 0,
    },
    failureSamples: [{
      sequence: 0,
      kind: "api-diagnostics-control",
      code: code.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32) || "UNKNOWN",
      reason: "control_failure",
    }],
  };
}

export function isDiagnosticJournalSnapshot(value: unknown): value is DiagnosticJournalSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<DiagnosticJournalSnapshot>;
  const writes = candidate.writes as Partial<DiagnosticJournalSnapshot["writes"]> | undefined;
  return candidate.schemaVersion === 1 &&
    typeof candidate.complete === "boolean" &&
    (candidate.state === "COMPLETE" || candidate.state === "DIAGNOSTICS_INCOMPLETE") &&
    typeof candidate.sealed === "boolean" &&
    Boolean(writes) &&
    [writes?.attempted, writes?.succeeded, writes?.failed, writes?.pending, writes?.timedOut, writes?.afterSeal]
      .every((entry) => Number.isSafeInteger(entry) && Number(entry) >= 0) &&
    Array.isArray(candidate.failureSamples);
}

export function diagnosticErrorCode(error: unknown) {
  const value = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const normalized = value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
  return normalized || "UNKNOWN";
}

async function settlesWithin(promises: Promise<void>[], timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.all(promises).then(() => true),
      new Promise<false>((resolvePromise) => {
        timer = setTimeout(() => resolvePromise(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function diagnosticKind(value: unknown) {
  const normalized = String(value ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 48);
  return normalized || "unknown";
}
