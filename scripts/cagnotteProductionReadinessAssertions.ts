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

function executableLineIndex(source: string, expression: string) {
  const escaped = expression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.search(new RegExp(`^\\s*${escaped}\\s*$`, "m"));
}
