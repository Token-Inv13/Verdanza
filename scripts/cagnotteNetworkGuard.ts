/** Test-process preload. Fail even when an SDK catches/suppresses an outbound attempt. */
import net from "node:net";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

let unexpected = 0;
let expected = false;
function block(): never {
  if (!expected) unexpected += 1;
  throw new Error("TEST_NETWORK_BLOCKED: only the dedicated numeric loopback endpoint is permitted.");
}
net.Socket.prototype.connect = new Proxy(net.Socket.prototype.connect, {
  apply(target, receiver, args: unknown[]) {
    const normalized = Array.isArray(args[0]) ? args[0] : args;
    const first = normalized[0];
    const options = first && typeof first === "object" ? first as { host?: string; port?: unknown } : { port: first, host: normalized[1] };
    if (options.host !== "127.0.0.1" || Number(options.port) !== 18085) block();
    return Reflect.apply(target, receiver, args);
  },
});
dns.lookup = new Proxy(dns.lookup, {
  apply(target, receiver, args) {
    if (args[0] !== "127.0.0.1") block();
    return Reflect.apply(target, receiver, args);
  },
});
dns.promises.lookup = new Proxy(dns.promises.lookup, {
  apply(target, receiver, args) {
    if (args[0] !== "127.0.0.1") block();
    return Reflect.apply(target, receiver, args);
  },
});
// c-ares DNS APIs can bypass Socket.connect; the numeric target needs none of them.
for (const api of [dns, dns.promises]) {
  for (const key of Object.keys(api).filter((name) => name.startsWith("resolve") || name === "reverse")) {
    const member = Reflect.get(api, key);
    if (typeof member === "function") Reflect.set(api, key, new Proxy(member, { apply() { return block(); } }));
  }
}
syncBuiltinESMExports();

export function expectBlockedNetwork(run: () => void) {
  expected = true;
  try { run(); } finally { expected = false; }
}

process.on("beforeExit", () => {
  if (unexpected) {
    console.error(`TEST_NETWORK_BLOCKED: ${unexpected} unexpected attempt(s); test process failed.`);
    process.exitCode = 1;
  }
});
