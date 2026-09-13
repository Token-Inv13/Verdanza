import { Buffer } from "node:buffer";

export const FIRESTORE_EMULATOR_OUTPUT_LIMIT_BYTES = 64 * 1024;

export class BoundedTextTail {
  readonly limitBytes: number;
  #buffer = Buffer.alloc(0);
  #truncated = false;

  constructor(limitBytes = FIRESTORE_EMULATOR_OUTPUT_LIMIT_BYTES) {
    if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) {
      throw new Error("La limite de capture émulateur doit être un entier positif.");
    }
    this.limitBytes = limitBytes;
  }

  append(chunk: string | Uint8Array) {
    const incoming = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    if (incoming.length >= this.limitBytes) {
      this.#buffer = Buffer.from(incoming.subarray(incoming.length - this.limitBytes));
      this.#truncated = true;
      return;
    }
    const combined = Buffer.concat([this.#buffer, incoming]);
    if (combined.length > this.limitBytes) {
      this.#buffer = Buffer.from(combined.subarray(combined.length - this.limitBytes));
      this.#truncated = true;
    } else {
      this.#buffer = combined;
    }
  }

  text() {
    return this.#buffer.toString("utf8");
  }

  get truncated() {
    return this.#truncated;
  }
}

export type FirestoreEmulatorFailureKind = "spawn" | "exit" | "timeout";

export type FirestoreEmulatorFailureContext = {
  exitCode: number | null;
  signal: string | null;
  javaCommand: string;
  javaRuntime: string;
  stdout: BoundedTextTail;
  stderr: BoundedTextTail;
  logPath: string;
  spawnError?: Error | null;
};

export function firestoreEmulatorStartupError(
  kind: FirestoreEmulatorFailureKind,
  context: FirestoreEmulatorFailureContext,
) {
  const headline = kind === "spawn"
    ? "Firestore emulator SPAWN ERROR."
    : kind === "exit"
      ? "Firestore emulator exited before readiness."
      : "Firestore emulator did not become ready before timeout.";
  const details = [
    headline,
    `exitCode=${context.exitCode ?? (kind === "timeout" ? "<running>" : "<not-started>")}`,
    `signal=${context.signal ?? "<none>"}`,
    `javaCommand=${context.javaCommand}`,
    "javaRuntime:",
    boundedText(context.javaRuntime, 8 * 1024),
  ];
  if (context.spawnError) {
    details.push(`spawnError=${context.spawnError.name}: ${context.spawnError.message}`);
  }
  details.push(
    renderTail("stdout", context.stdout),
    renderTail("stderr", context.stderr),
    `logPath=${context.logPath}`,
  );
  return new Error(details.join("\n"));
}

function renderTail(name: "stdout" | "stderr", tail: BoundedTextTail) {
  const marker = tail.truncated ? ` [last ${tail.limitBytes} bytes; truncated]` : "";
  return `${name}Tail${marker}:\n${tail.text() || "<empty>"}`;
}

function boundedText(value: string, limitBytes: number) {
  const tail = new BoundedTextTail(limitBytes);
  tail.append(value);
  return `${tail.truncated ? `[last ${limitBytes} bytes; truncated]\n` : ""}${tail.text() || "<unavailable>"}`;
}
