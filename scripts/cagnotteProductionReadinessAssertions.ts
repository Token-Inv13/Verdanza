const durableSendSignature = "export async function sendCagnotteAdminOperationWithDurableRecovery";
const nextControllerExport = "export async function retryCagnotteAdminFrozenOperationDurably";
const claimExpression = "await store.claimBeforeSend(operation);";
const persistedCallbackExpression = "onPersisted(operation);";
const sendExpression = "const result = await send(operation);";

export function assertCagnotteAdminDurableSendOrdering(source: string) {
  const functionIndex = source.indexOf(durableSendSignature);
  if (functionIndex === -1) throw new Error("Fonction d’envoi durable admin introuvable.");
  const nextExportIndex = source.indexOf(nextControllerExport, functionIndex + durableSendSignature.length);
  if (nextExportIndex === -1) throw new Error("Limite de la fonction d’envoi durable admin introuvable.");

  const functionSource = source.slice(functionIndex, nextExportIndex);
  const claimIndex = executableLineIndex(functionSource, claimExpression);
  const persistedCallbackIndex = executableLineIndex(functionSource, persistedCallbackExpression);
  const sendIndex = executableLineIndex(functionSource, sendExpression);

  if (claimIndex === -1) throw new Error("claimBeforeSend actif introuvable dans la fonction d’envoi durable admin.");
  if (persistedCallbackIndex === -1) throw new Error("onPersisted actif introuvable dans la fonction d’envoi durable admin.");
  if (sendIndex === -1) throw new Error("send actif introuvable dans la fonction d’envoi durable admin.");
  if (claimIndex >= persistedCallbackIndex) throw new Error("claimBeforeSend doit précéder onPersisted dans la fonction d’envoi durable admin.");
  if (persistedCallbackIndex >= sendIndex) throw new Error("onPersisted doit précéder send dans la fonction d’envoi durable admin.");

  return { claimIndex, persistedCallbackIndex, sendIndex };
}

export function assertGitHubWorkflowUsesFullHistoryCheckout(source: string, workflowName: string) {
  const checkoutMatches = [...source.matchAll(/^( *)- name: Checkout\s*$/gm)];
  if (checkoutMatches.length !== 1) throw new Error(`${workflowName}: un unique bloc Checkout est requis.`);
  const checkoutMatch = checkoutMatches[0];
  const stepIndent = checkoutMatch[1].length;
  const blockStart = checkoutMatch.index ?? 0;
  const remaining = source.slice(blockStart).split(/\r?\n/);
  let blockEnd = remaining.length;
  for (let index = 1; index < remaining.length; index += 1) {
    if (new RegExp(`^ {${stepIndent}}- name:`).test(remaining[index])) {
      blockEnd = index;
      break;
    }
  }
  const checkoutBlock = remaining.slice(0, blockEnd).join("\n");
  const usesIndex = checkoutBlock.search(indentedLine(stepIndent + 2, "uses: actions/checkout@v7"));
  const withIndex = checkoutBlock.search(indentedLine(stepIndent + 2, "with:"));
  const credentialsIndex = checkoutBlock.search(indentedLine(stepIndent + 4, "persist-credentials: false"));
  const depthIndex = checkoutBlock.search(indentedLine(stepIndent + 4, "fetch-depth: 0"));

  if (usesIndex === -1) throw new Error(`${workflowName}: Checkout doit utiliser actions/checkout@v7.`);
  if (withIndex === -1) throw new Error(`${workflowName}: bloc with du Checkout introuvable.`);
  if (credentialsIndex === -1 || credentialsIndex < withIndex) {
    throw new Error(`${workflowName}: Checkout doit conserver persist-credentials: false.`);
  }
  if (depthIndex === -1 || depthIndex < withIndex) {
    throw new Error(`${workflowName}: Checkout doit conserver fetch-depth: 0.`);
  }
}

export function assertGitHubWorkflowPreparesCagnotteEmulator(
  source: string,
  workflowName: string,
  verifyStepName: "Verify" | "Verify full",
  verifyScript: "verify" | "verify:full",
) {
  const preparation = workflowStepBlock(source, "Prepare cagnotte Firestore emulator", workflowName);
  const verification = workflowStepBlock(source, verifyStepName, workflowName);
  if (preparation.start >= verification.start) {
    throw new Error(`${workflowName}: la préparation émulateur doit précéder ${verifyStepName}.`);
  }
  if (preparation.block.search(indentedLine(preparation.indent + 2, "run: npm run prepare:cagnotte-firestore-emulator")) === -1) {
    throw new Error(`${workflowName}: la préparation doit exécuter npm run prepare:cagnotte-firestore-emulator.`);
  }
  if (verification.block.search(indentedLine(verification.indent + 2, `run: npm run ${verifyScript}`)) === -1) {
    throw new Error(`${workflowName}: ${verifyStepName} doit exécuter npm run ${verifyScript}.`);
  }
}

function executableLineIndex(source: string, expression: string) {
  const escaped = expression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.search(new RegExp(`^\\s*${escaped}\\s*$`, "m"));
}

function indentedLine(indent: number, expression: string) {
  const escaped = expression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^ {${indent}}${escaped}\\s*$`, "m");
}

function workflowStepBlock(source: string, stepName: string, workflowName: string) {
  const escapedName = stepName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...source.matchAll(new RegExp(`^( *)- name: ${escapedName}\\s*$`, "gm"))];
  if (matches.length !== 1) throw new Error(`${workflowName}: une unique étape ${stepName} est requise.`);
  const match = matches[0];
  const indent = match[1].length;
  const start = match.index ?? 0;
  const remaining = source.slice(start).split(/\r?\n/);
  let end = remaining.length;
  for (let index = 1; index < remaining.length; index += 1) {
    if (new RegExp(`^ {${indent}}- name:`).test(remaining[index])) {
      end = index;
      break;
    }
  }
  return { start, indent, block: remaining.slice(0, end).join("\n") };
}
