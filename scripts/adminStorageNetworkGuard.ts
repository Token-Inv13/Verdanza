import http from "node:http";
import https from "node:https";
import net from "node:net";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

const ports = new Set([18087, 18088, 14417, 14517]);
let unexpected = 0;
function block(reason = "non-local request"): never {
  unexpected += 1;
  console.error(`STORAGE_TEST_NETWORK_BLOCKED ${reason}\n${new Error().stack?.split("\n").slice(2, 6).join("\n")}`);
  throw new Error("STORAGE_TEST_NETWORK_BLOCKED: only the dedicated numeric loopback ports are allowed.");
}
function local(value: unknown) {
  try {
    if (typeof value === "string" || value instanceof URL) {
      const url = new URL(value);
      return url.protocol === "http:" && url.hostname === "127.0.0.1" && ports.has(Number(url.port));
    }
    const options = value as { host?: string; hostname?: string; port?: unknown } | undefined;
    return (options?.hostname ?? options?.host) === "127.0.0.1" && ports.has(Number(options?.port));
  } catch { return false; }
}
net.Socket.prototype.connect = new Proxy(net.Socket.prototype.connect, {
  apply(target, receiver, args: unknown[]) {
    const normalized = Array.isArray(args[0]) ? args[0] : args;
    const first = normalized[0];
    const options = first && typeof first === "object" ? first : { port: first, host: normalized[1] };
    if (!local(options)) block("socket");
    return Reflect.apply(target, receiver, args);
  },
});
for (const api of [dns, dns.promises]) {
  for (const key of Object.keys(api).filter((name) => name === "lookup" || name.startsWith("resolve") || name === "reverse")) {
    const original = Reflect.get(api, key);
    if (typeof original !== "function") continue;
    Reflect.set(api, key, new Proxy(original, {
      apply(target, receiver, args) {
        if (key !== "lookup" || args[0] !== "127.0.0.1") block(`dns.${key}`);
        return Reflect.apply(target, receiver, args);
      },
    }));
  }
}
for (const api of [http, https]) for (const key of ["request", "get"] as const) {
  Reflect.set(api, key, new Proxy(api[key], {
    apply(target, receiver, args) {
      if (!local(args[0])) block(`http.${key}`);
      return Reflect.apply(target, receiver, args);
    },
  }));
}
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, receiver, args) {
    if (!local(args[0])) block("fetch");
    return Reflect.apply(target, receiver, args);
  },
});
syncBuiltinESMExports();
process.on("beforeExit", () => {
  if (unexpected) {
    console.error(`STORAGE_TEST_NETWORK_BLOCKED: ${unexpected} unexpected attempt(s).`);
    process.exitCode = 1;
  }
});
