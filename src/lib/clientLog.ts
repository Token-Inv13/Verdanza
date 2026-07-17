const RECOVERABLE_FIRESTORE_CODES = new Set([
  "cancelled",
  "deadline-exceeded",
  "unavailable",
]);

type ErrorLike = {
  code?: unknown;
  message?: unknown;
};

export function isRecoverableFirestoreConnectionError(error: unknown) {
  const errorLike = error as ErrorLike;
  const code = typeof errorLike?.code === "string" ? errorLike.code : "";
  const message = typeof errorLike?.message === "string" ? errorLike.message : "";

  return (
    RECOVERABLE_FIRESTORE_CODES.has(code) ||
    message.includes("Could not reach Cloud Firestore backend") ||
    message.includes("client will operate in offline mode")
  );
}

export function logFirestoreFallback(message: string, error: unknown) {
  if (import.meta.env.DEV) {
    console.warn(message, error);
    return;
  }

  if (!isRecoverableFirestoreConnectionError(error)) {
    console.error(message, error);
  }
}
