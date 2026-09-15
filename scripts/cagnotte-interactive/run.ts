import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  installRecipeTerminalOutputProtection,
  isRecipeStartupCancelled,
  printRecipeAccess,
  startRecipeHarness,
  type RecipeHarness,
  writeRecipeStdoutLine,
} from "./harness.js";

export type RecipeSignal = "SIGINT" | "SIGTERM";

export type RecipeSignalSource = {
  on: (signal: RecipeSignal, listener: () => void) => unknown;
  off: (signal: RecipeSignal, listener: () => void) => unknown;
};

export class RecipeSignalCancellationError extends Error {
  readonly code = "RECIPE_SIGNAL_CANCELLED";

  constructor(readonly signal: RecipeSignal) {
    super(`Exécution de la recette interrompue par ${signal}.`);
    this.name = "RecipeSignalCancellationError";
  }
}

export function isRecipeSignalCancellation(error: unknown): error is RecipeSignalCancellationError {
  return error instanceof RecipeSignalCancellationError || (
    Boolean(error) && typeof error === "object" &&
    (error as { code?: unknown }).code === "RECIPE_SIGNAL_CANCELLED"
  );
}

export type RecipeSignalCancellation = {
  signal: AbortSignal;
  requestedSignal: () => RecipeSignal | undefined;
  exitCode: () => 130 | 143 | undefined;
  waitForRequest: () => Promise<void>;
  throwIfRequested: () => void;
  dispose: () => void;
};

export function installRecipeSignalCancellation(
  signalSource: RecipeSignalSource,
): RecipeSignalCancellation {
  const controller = new AbortController();
  let requestedSignal: RecipeSignal | undefined;
  let disposed = false;
  let resolveShutdown: (() => void) | undefined;
  const shutdownRequested = new Promise<void>((resolvePromise) => {
    resolveShutdown = resolvePromise;
  });
  const requestShutdown = (signal: RecipeSignal) => () => {
    if (controller.signal.aborted) return;
    requestedSignal = signal;
    controller.abort();
    resolveShutdown?.();
  };
  const signalHandlers = new Map<RecipeSignal, () => void>([
    ["SIGINT", requestShutdown("SIGINT")],
    ["SIGTERM", requestShutdown("SIGTERM")],
  ]);
  for (const [signal, listener] of signalHandlers) signalSource.on(signal, listener);

  return {
    signal: controller.signal,
    requestedSignal: () => requestedSignal,
    exitCode: () => requestedSignal === "SIGINT" ? 130 : requestedSignal === "SIGTERM" ? 143 : undefined,
    waitForRequest: () => shutdownRequested,
    throwIfRequested: () => {
      if (requestedSignal) throw new RecipeSignalCancellationError(requestedSignal);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const [signal, listener] of signalHandlers) signalSource.off(signal, listener);
    },
  };
}

export type RecipeCommandDependencies<Harness extends { stop: () => Promise<void> }> = {
  signalSource: RecipeSignalSource;
  startHarness: (signal: AbortSignal) => Promise<Harness>;
  printAccess: (harness: Harness) => void;
  writeLine: (message: string) => void;
};

export async function runRecipeCommand<Harness extends { stop: () => Promise<void> }>(
  dependencies: RecipeCommandDependencies<Harness>,
): Promise<"STOPPED" | "STARTUP_CANCELLED"> {
  const cancellation = installRecipeSignalCancellation(dependencies.signalSource);
  try {
    let harness: Harness;
    try {
      harness = await dependencies.startHarness(cancellation.signal);
    } catch (error) {
      if (cancellation.signal.aborted && isRecipeStartupCancelled(error)) {
        dependencies.writeLine(
          `Recette locale ANNULÉE pendant le démarrage (${cancellation.requestedSignal() ?? "arrêt demandé"}) ; ` +
          "les ressources acquises ont été nettoyées.",
        );
        return "STARTUP_CANCELLED";
      }
      throw error;
    }

    if (cancellation.signal.aborted) {
      await harness.stop();
      dependencies.writeLine(
        `Recette locale ANNULÉE avant disponibilité (${cancellation.requestedSignal() ?? "arrêt demandé"}) ; ` +
        "les ressources acquises ont été nettoyées.",
      );
      return "STARTUP_CANCELLED";
    }

    dependencies.printAccess(harness);
    await cancellation.waitForRequest();
    await harness.stop();
    dependencies.writeLine("Recette locale arrêtée : tous les ports dédiés sont libérés.");
    return "STOPPED";
  } finally {
    cancellation.dispose();
  }
}

async function runManualRecipe() {
  await runRecipeCommand<RecipeHarness>({
    signalSource: process,
    startHarness: (signal) => startRecipeHarness("manual", { signal }),
    printAccess: printRecipeAccess,
    writeLine: writeRecipeStdoutLine,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installRecipeTerminalOutputProtection();
  await runManualRecipe();
}
