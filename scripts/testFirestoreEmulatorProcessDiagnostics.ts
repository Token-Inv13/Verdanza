import { equal, match, ok } from "node:assert/strict";
import {
  BoundedTextTail,
  FIRESTORE_EMULATOR_OUTPUT_LIMIT_BYTES,
  firestoreEmulatorStartupError,
} from "./firestoreEmulatorProcessDiagnostics.js";

const exitedStdout = new BoundedTextTail();
const exitedStderr = new BoundedTextTail();
exitedStdout.append("synthetic java stdout\n");
exitedStderr.append("synthetic java stderr\n");
const exited = firestoreEmulatorStartupError("exit", {
  exitCode: 7,
  signal: null,
  javaCommand: "java",
  javaRuntime: "synthetic Java 17",
  stdout: exitedStdout,
  stderr: exitedStderr,
  logPath: "/tmp/firestore.log",
});
match(exited.message, /Firestore emulator exited before readiness\./);
match(exited.message, /exitCode=7/);
match(exited.message, /signal=<none>/);
match(exited.message, /synthetic java stdout/);
match(exited.message, /synthetic java stderr/);
console.log("OK [Emulator diagnostics] sortie Java non nulle expose exitCode, signal et tails");

const spawn = firestoreEmulatorStartupError("spawn", {
  exitCode: null,
  signal: null,
  javaCommand: "java",
  javaRuntime: "java -version unavailable",
  stdout: new BoundedTextTail(),
  stderr: new BoundedTextTail(),
  logPath: "/tmp/firestore.log",
  spawnError: Object.assign(new Error("spawn java ENOENT"), { name: "SpawnError" }),
});
match(spawn.message, /SPAWN ERROR/);
match(spawn.message, /SpawnError: spawn java ENOENT/);
match(spawn.message, /exitCode=<not-started>/);
console.log("OK [Emulator diagnostics] erreur spawn distincte et lisible");

const timeoutStdout = new BoundedTextTail();
timeoutStdout.append("server still starting\n");
const timeout = firestoreEmulatorStartupError("timeout", {
  exitCode: null,
  signal: null,
  javaCommand: "java",
  javaRuntime: "synthetic Java 21",
  stdout: timeoutStdout,
  stderr: new BoundedTextTail(),
  logPath: "/tmp/firestore.log",
});
match(timeout.message, /did not become ready before timeout/);
match(timeout.message, /exitCode=<running>/);
match(timeout.message, /server still starting/);
console.log("OK [Emulator diagnostics] timeout conserve le tail et reste fail closed");

const bounded = new BoundedTextTail(128);
bounded.append(`discarded-marker-${"x".repeat(FIRESTORE_EMULATOR_OUTPUT_LIMIT_BYTES)}-kept-marker`);
ok(Buffer.byteLength(bounded.text()) <= 128);
equal(bounded.truncated, true);
equal(bounded.text().includes("discarded-marker"), false);
equal(bounded.text().endsWith("-kept-marker"), true);
console.log("OK [Emulator diagnostics] capture volumineuse bornee et tronquee par la tete");

const nominal = new BoundedTextTail();
nominal.append("Dev App Server is now running.\n");
equal(nominal.text(), "Dev App Server is now running.\n");
equal(nominal.truncated, false);
console.log("OK [Emulator diagnostics] petite sortie nominale conservee sans alteration");

console.log("HOTFIX 4F2-H14 : 5 contrôles de diagnostic émulateur réussis.");
