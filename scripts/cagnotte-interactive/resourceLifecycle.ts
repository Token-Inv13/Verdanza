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
  onPrimaryError?: (error: unknown) => void;
  onCleanupIssue?: (step: CleanupStepResult) => void;
  cleanupTimeoutMs?: number;
};

export async function runWithViewportResources<Harness, Monitor, Page, Result>(
  dependencies: ViewportResourceDependencies<Harness, Monitor, Page>,
  operation: (resources: ViewportResources<Harness, Monitor, Page>) => Promise<Result>,
): Promise<Result> {
  const resources: PartialViewportResources<Harness, Monitor, Page> = {};
  let result: Result | undefined;
  let primaryError: unknown;
  let primaryErrorPrecededCancellation = false;
  try {
    dependencies.cancellation?.throwIfRequested();
    resources.harness = await dependencies.startHarness();
    dependencies.cancellation?.throwIfRequested();
    resources.clientMonitor = await dependencies.createMonitor("client", resources.harness);
    dependencies.cancellation?.throwIfRequested();
    resources.adminMonitor = await dependencies.createMonitor("admin", resources.harness);
    dependencies.cancellation?.throwIfRequested();
    resources.clientPage = await dependencies.createPage(resources.clientMonitor, "client");
    dependencies.cancellation?.throwIfRequested();
    resources.adminPage = await dependencies.createPage(resources.adminMonitor, "admin");
    dependencies.cancellation?.throwIfRequested();
    result = await operation(resources as ViewportResources<Harness, Monitor, Page>);
    dependencies.cancellation?.throwIfRequested();
  } catch (error) {
    primaryError = error;
    primaryErrorPrecededCancellation = !dependencies.cancellation?.signal.aborted;
    if (primaryErrorPrecededCancellation) {
      try {
        dependencies.onPrimaryError?.(error);
      } catch {
        // L'erreur initiale reste prioritaire face au suivi du runner.
      }
    }
  }

  const timeoutMs = dependencies.cleanupTimeoutMs ?? 10_000;
  const startedAt = new Date().toISOString();
  const steps: CleanupStepResult[] = [];
  await cleanupStep(steps, "persist-evidence", true, timeoutMs, () => dependencies.persistEvidence(resources));
  await cleanupStep(steps, "close-admin-page", Boolean(resources.adminPage), timeoutMs, () => (
    dependencies.closePage(resources.adminPage as Page, "admin")
  ));
  await cleanupStep(steps, "close-client-page", Boolean(resources.clientPage), timeoutMs, () => (
    dependencies.closePage(resources.clientPage as Page, "client")
  ));
  await cleanupStep(steps, "close-admin-context", Boolean(resources.adminMonitor), timeoutMs, () => (
    dependencies.closeMonitor(resources.adminMonitor as Monitor, "admin")
  ));
  await cleanupStep(steps, "close-client-context", Boolean(resources.clientMonitor), timeoutMs, () => (
    dependencies.closeMonitor(resources.clientMonitor as Monitor, "client")
  ));
  await cleanupStep(steps, "stop-harness", Boolean(resources.harness), timeoutMs, () => (
    dependencies.stopHarness(resources.harness as Harness)
  ));

  if (dependencies.cancellation?.signal.aborted && !primaryErrorPrecededCancellation) {
    try {
      dependencies.cancellation.throwIfRequested();
    } catch (cancellationError) {
      attachCancellationContext(cancellationError, primaryError);
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
  action: () => Promise<void>,
) {
  const started = Date.now();
  if (!applicable) {
    results.push({ name, status: "skipped", durationMs: 0 });
    return;
  }
  try {
    await bounded(action, timeoutMs, name);
    results.push({ name, status: "completed", durationMs: Date.now() - started });
  } catch (error) {
    results.push({
      name,
      status: "failed",
      durationMs: Date.now() - started,
      error: safeError(error),
    });
  }
}

async function bounded(action: () => Promise<void>, timeoutMs: number, name: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
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

function safeError(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
