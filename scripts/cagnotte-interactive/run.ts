import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isRecipeStartupCancelled,
  printRecipeAccess,
  startRecipeHarness,
  type RecipeHarness,
} from "./harness.js";

type RecipeSignal = "SIGINT" | "SIGTERM";

export type RecipeSignalSource = {
  on: (signal: RecipeSignal, listener: () => void) => unknown;
  off: (signal: RecipeSignal, listener: () => void) => unknown;
};

export type RecipeCommandDependencies<Harness extends { stop: () => Promise<void> }> = {
  signalSource: RecipeSignalSource;
  startHarness: (signal: AbortSignal) => Promise<Harness>;
  printAccess: (harness: Harness) => void;
  writeLine: (message: string) => void;
};

export async function runRecipeCommand<Harness extends { stop: () => Promise<void> }>(
  dependencies: RecipeCommandDependencies<Harness>,
): Promise<"STOPPED" | "STARTUP_CANCELLED"> {
  const controller = new AbortController();
  let requestedSignal: RecipeSignal | undefined;
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

  for (const [signal, listener] of signalHandlers) dependencies.signalSource.on(signal, listener);
  try {
    let harness: Harness;
    try {
      harness = await dependencies.startHarness(controller.signal);
    } catch (error) {
      if (controller.signal.aborted && isRecipeStartupCancelled(error)) {
        dependencies.writeLine(
          `Recette locale ANNULÉE pendant le démarrage (${requestedSignal ?? "arrêt demandé"}) ; ` +
          "les ressources acquises ont été nettoyées.",
        );
        return "STARTUP_CANCELLED";
      }
      throw error;
    }

    if (controller.signal.aborted) {
      await harness.stop();
      dependencies.writeLine(
        `Recette locale ANNULÉE avant disponibilité (${requestedSignal ?? "arrêt demandé"}) ; ` +
        "les ressources acquises ont été nettoyées.",
      );
      return "STARTUP_CANCELLED";
    }

    dependencies.printAccess(harness);
    await shutdownRequested;
    await harness.stop();
    dependencies.writeLine("Recette locale arrêtée : tous les ports dédiés sont libérés.");
    return "STOPPED";
  } finally {
    for (const [signal, listener] of signalHandlers) dependencies.signalSource.off(signal, listener);
  }
}

async function runManualRecipe() {
  await runRecipeCommand<RecipeHarness>({
    signalSource: process,
    startHarness: (signal) => startRecipeHarness("manual", { signal }),
    printAccess: printRecipeAccess,
    writeLine: (message) => console.log(message),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runManualRecipe();
}
