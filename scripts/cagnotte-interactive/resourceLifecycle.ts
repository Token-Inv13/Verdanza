export type ViewportResourceRole = "client" | "admin";

export type ViewportResources<Harness, Monitor, Page> = {
  harness: Harness;
  clientMonitor: Monitor;
  adminMonitor: Monitor;
  clientPage: Page;
  adminPage: Page;
};

export type PartialViewportResources<Harness, Monitor, Page> = Partial<
  ViewportResources<Harness, Monitor, Page>
>;

export type CleanupStepResult = {
  name: string;
  status: "completed" | "failed" | "skipped";
  durationMs: number;
  closedBy?: string;
  error?: string;
};

export type CleanupReport = {
  label: string;
  startedAt: string;
  completedAt: string;
  primaryError?: string;
  steps: CleanupStepResult[];
};

export type ResourceCancellationControl = {
  signal: AbortSignal;
  throwIfRequested: () => void;
  isCancellationError: (error: unknown) => boolean;
};

export type ViewportResourceDependencies<Harness, Monitor, Page> = {
  label: string;
  startHarness: () => Promise<Harness>;
  createMonitor: (role: ViewportResourceRole, harness: Harness) => Promise<Monitor>;
  createPage: (monitor: Monitor, role: ViewportResourceRole) => Promise<Page>;
  persistEvidence: (
    resources: PartialViewportResources<Harness, Monitor, Page>,
  ) => Promise<void>;
  closePage: (page: Page, role: ViewportResourceRole) => Promise<void>;
  closeMonitor: (monitor: Monitor, role: ViewportResourceRole) => Promise<void>;
  stopHarness: (harness: Harness) => Promise<void>;
  writeCleanupReport?: (
    report: CleanupReport,
    resources: PartialViewportResources<Harness, Monitor, Page>,
  ) => Promise<void>;
  cancellation?: ResourceCancellationControl;
  closeCancellationFallback?: (failure: {
    role: ViewportResourceRole;
    error: unknown;
  }) => Promise<void>;
  isCoordinatedCancellationInterruption?: (error: unknown) => boolean;
  onPrimaryError?: (error: unknown) => void;
  onCleanupIssue?: (step: CleanupStepResult) => void;
  cleanupTimeoutMs?: number;
};

export type SharedResourceClosure<Result = void> = {
  close: () => Promise<Result>;
  started: () => boolean;
};

export function createSharedResourceClosure<Result = void>(
  action: () => Promise<Result>,
): SharedResourceClosure<Result> {
  let closure: Promise<Result> | undefined;
  return {
    close: () => {
      if (!closure) closure = Promise.resolve().then(action);
      return closure;
    },
    started: () => closure !== undefined,
  };
}

export async function runWithViewportResources<Harness, Monitor, Page, Result>(
  dependencies: ViewportResourceDependencies<Harness, Monitor, Page>,
  operation: (resources: ViewportResources<Harness, Monitor, Page>) => Promise<Result>,
): Promise<Result> {
  const resources: PartialViewportResources<Harness, Monitor, Page> = {};
  const timeoutMs = dependencies.cleanupTimeoutMs ?? 10_000;
  const pageClosures: Partial<Record<ViewportResourceRole, SharedResourceClosure<{ closedBy?: string } | void>>> = {};
  const monitorClosures: Partial<Record<ViewportResourceRole, SharedResourceClosure>> = {};
  let harnessClosure: SharedResourceClosure | undefined;
  let fallbackClosure: SharedResourceClosure | undefined;
  let cancellationRequested = dependencies.cancellation?.signal.aborted ?? false;
  const cancellationClosuresStarted = new Set<ViewportResourceRole>();

  const startCancellationFallback = (role: ViewportResourceRole, error: unknown) => {
    if (!dependencies.closeCancellationFallback) return;
    if (!fallbackClosure) {
      fallbackClosure = createSharedResourceClosure(() => (
        dependencies.closeCancellationFallback!({ role, error })
      ));
    }
    const fallback = fallbackClosure.close();
    // Le rejet reste porté par la promesse partagée et sera relu par l'étape de nettoyage.
    void fallback.then(undefined, () => undefined);
  };

  const createMonitorClosure = (monitor: Monitor, role: ViewportResourceRole) => (
    createSharedResourceClosure(async () => {
      let timeoutError: Error | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (cancellationRequested && dependencies.closeCancellationFallback) {
        timer = setTimeout(() => {
          timeoutError = new Error(`close-${role}-context a dépassé ${timeoutMs} ms.`);
          startCancellationFallback(role, timeoutError);
        }, timeoutMs);
      }
      try {
        await dependencies.closeMonitor(monitor, role);
      } catch (error) {
        if (cancellationRequested) startCancellationFallback(role, error);
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (timeoutError) throw timeoutError;
    })
  );

  const startMonitorClosure = (role: ViewportResourceRole, requestedByCancellation = false) => {
    const closure = monitorClosures[role];
    if (!closure) return Promise.resolve();
    if (requestedByCancellation) cancellationClosuresStarted.add(role);
    const closing = closure.close();
    // Une fermeture lancée par le signal sera rejointe et vérifiée par le nettoyage normal.
    void closing.then(undefined, () => undefined);
    return closing;
  };

  const registerHarness = (harness: Harness) => {
    resources.harness = harness;
    harnessClosure = createSharedResourceClosure(() => dependencies.stopHarness(harness));
  };
  const registerMonitor = (monitor: Monitor, role: ViewportResourceRole) => {
    if (role === "client") resources.clientMonitor = monitor;
    else resources.adminMonitor = monitor;
    monitorClosures[role] = createMonitorClosure(monitor, role);
    if (cancellationRequested) void startMonitorClosure(role, true);
  };
  const registerPage = (page: Page, role: ViewportResourceRole) => {
    if (role === "client") resources.clientPage = page;
    else resources.adminPage = page;
    pageClosures[role] = createSharedResourceClosure(async () => {
      if (cancellationRequested && monitorClosures[role]) {
        await startMonitorClosure(role, true);
        return { closedBy: `close-${role}-context` };
      }
      await dependencies.closePage(page, role);
    });
  };
  const requestCancellationClosure = () => {
    cancellationRequested = true;
    void startMonitorClosure("admin", true);
    void startMonitorClosure("client", true);
  };

  dependencies.cancellation?.signal.addEventListener("abort", requestCancellationClosure);
  if (dependencies.cancellation?.signal.aborted) requestCancellationClosure();

  try {
    let result: Result | undefined;
    let primaryError: unknown;
    try {
      dependencies.cancellation?.throwIfRequested();
      registerHarness(await dependencies.startHarness());
      dependencies.cancellation?.throwIfRequested();
      registerMonitor(await dependencies.createMonitor("client", resources.harness as Harness), "client");
      dependencies.cancellation?.throwIfRequested();
      registerMonitor(await dependencies.createMonitor("admin", resources.harness as Harness), "admin");
      dependencies.cancellation?.throwIfRequested();
      registerPage(await dependencies.createPage(resources.clientMonitor as Monitor, "client"), "client");
      dependencies.cancellation?.throwIfRequested();
      registerPage(await dependencies.createPage(resources.adminMonitor as Monitor, "admin"), "admin");
      dependencies.cancellation?.throwIfRequested();
      result = await operation(resources as ViewportResources<Harness, Monitor, Page>);
      dependencies.cancellation?.throwIfRequested();
    } catch (error) {
      const cancellation = dependencies.cancellation;
      const identifiedCancellation = Boolean(
        cancellation?.signal.aborted && cancellation.isCancellationError(error),
      );
      const coordinatedClosureInterruption = Boolean(
        cancellation?.signal.aborted &&
        cancellationClosuresStarted.size > 0 &&
        dependencies.isCoordinatedCancellationInterruption?.(error),
      );
      primaryError = identifiedCancellation || coordinatedClosureInterruption
        ? cancellationError(cancellation!, error)
        : error;
      if (!identifiedCancellation && !coordinatedClosureInterruption) {
        try {
          dependencies.onPrimaryError?.(error);
        } catch {
          // L'erreur initiale reste prioritaire face au suivi du runner.
        }
      }
    }

    const startedAt = new Date().toISOString();
    const steps: CleanupStepResult[] = [];
    await cleanupStep(steps, "persist-evidence", true, timeoutMs, () => dependencies.persistEvidence(resources));
    await cleanupStep(steps, "close-admin-page", Boolean(resources.adminPage), timeoutMs, () => (
      pageClosures.admin!.close()
    ));
    await cleanupStep(steps, "close-client-page", Boolean(resources.clientPage), timeoutMs, () => (
      pageClosures.client!.close()
    ));
    await cleanupStep(steps, "close-admin-context", Boolean(resources.adminMonitor), timeoutMs, () => (
      startMonitorClosure("admin")
    ));
    await cleanupStep(steps, "close-client-context", Boolean(resources.clientMonitor), timeoutMs, () => (
      startMonitorClosure("client")
    ));
    if (fallbackClosure?.started()) {
      await cleanupStep(steps, "close-cancellation-fallback", true, timeoutMs, () => fallbackClosure!.close());
    }
    await cleanupStep(steps, "stop-harness", Boolean(resources.harness), timeoutMs, () => (
      harnessClosure!.close()
    ));

    if (primaryError === undefined && dependencies.cancellation?.signal.aborted) {
      try {
        dependencies.cancellation.throwIfRequested();
      } catch (cancellationError) {
        primaryError = cancellationError;
      }
    }

    const report: CleanupReport = {
      label: dependencies.label,
      startedAt,
      completedAt: new Date().toISOString(),
      ...(primaryError === undefined ? {} : { primaryError: safeError(primaryError) }),
      steps,
    };
    if (dependencies.writeCleanupReport) {
      await cleanupStep(steps, "write-cleanup-report", true, timeoutMs, () => (
        dependencies.writeCleanupReport!(report, resources)
      ));
      report.completedAt = new Date().toISOString();
    }

    const cleanupFailures = steps.filter((step) => step.status === "failed");
    for (const failure of cleanupFailures) {
      try {
        dependencies.onCleanupIssue?.(failure);
      } catch {
        // Le rapport de nettoyage doit rester secondaire face à l'erreur initiale.
      }
    }
    if (primaryError !== undefined) {
      attachCleanupFailures(primaryError, cleanupFailures);
      throw primaryError;
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        cleanupFailures.map((failure) => new Error(`${failure.name}: ${failure.error}`)),
        `Nettoyage incomplet pour ${dependencies.label}.`,
      );
    }
    return result as Result;
  } finally {
    dependencies.cancellation?.signal.removeEventListener("abort", requestCancellationClosure);
  }
}

export async function configureOwnedResource<Resource>(options: {
  label?: string;
  create: () => Promise<Resource>;
  configure: (resource: Resource) => Promise<void>;
  close: (resource: Resource) => Promise<void>;
  timeoutMs?: number;
  onCleanupIssue?: (step: CleanupStepResult) => void;
}): Promise<Resource> {
  const resource = await options.create();
  try {
    await options.configure(resource);
    return resource;
  } catch (primaryError) {
    const steps: CleanupStepResult[] = [];
    await cleanupStep(
      steps,
      `close-${options.label ?? "configured-resource"}`,
      true,
      options.timeoutMs ?? 10_000,
      () => options.close(resource),
    );
    const failures = steps.filter((step) => step.status === "failed");
    for (const failure of failures) {
      try {
        options.onCleanupIssue?.(failure);
      } catch {
        // Le signalement ne doit pas masquer l'échec de configuration.
      }
    }
    attachCleanupFailures(primaryError, failures);
    throw primaryError;
  }
}

async function cleanupStep(
  results: CleanupStepResult[],
  name: string,
  applicable: boolean,
  timeoutMs: number,
  action: () => Promise<{ closedBy?: string } | void>,
) {
  const started = Date.now();
  if (!applicable) {
    results.push({ name, status: "skipped", durationMs: 0 });
    return;
  }
  try {
    const completion = await bounded(action, timeoutMs, name);
    results.push({
      name,
      status: "completed",
      durationMs: Date.now() - started,
      ...(completion?.closedBy ? { closedBy: completion.closedBy } : {}),
    });
  } catch (error) {
    results.push({
      name,
      status: "failed",
      durationMs: Date.now() - started,
      error: safeError(error),
    });
  }
}

async function bounded<Result>(action: () => Promise<Result>, timeoutMs: number, name: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} a dépassé ${timeoutMs} ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function attachCleanupFailures(primaryError: unknown, failures: CleanupStepResult[]) {
  if (failures.length === 0 || !(primaryError instanceof Error)) return;
  try {
    Object.defineProperty(primaryError, "cleanupFailures", {
      configurable: true,
      enumerable: false,
      value: failures.map((failure) => ({ ...failure })),
    });
  } catch {
    // Certaines erreurs peuvent être non extensibles ; leur identité reste prioritaire.
  }
}

function attachCancellationContext(cancellationError: unknown, interruptedError: unknown) {
  if (!(cancellationError instanceof Error) || !interruptedError || typeof interruptedError !== "object") return;
  const runDirectory = (interruptedError as { runDirectory?: unknown }).runDirectory;
  if (typeof runDirectory !== "string") return;
  try {
    Object.defineProperty(cancellationError, "runDirectory", {
      configurable: true,
      enumerable: false,
      value: runDirectory,
    });
  } catch {
    // L'annulation reste exploitable même sans propriété de contexte supplémentaire.
  }
}

function cancellationError(
  cancellation: ResourceCancellationControl,
  interruptedError: unknown,
) {
  try {
    cancellation.throwIfRequested();
  } catch (error) {
    attachCancellationContext(error, interruptedError);
    return error;
  }
  return interruptedError;
}

function safeError(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
