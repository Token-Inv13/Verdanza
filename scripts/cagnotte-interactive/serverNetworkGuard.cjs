"use strict";

const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const tls = require("node:tls");
const dns = require("node:dns");

if (process.env.VERDANZA_CAGNOTTE_INTERACTIVE !== "1") {
  throw new Error("ISOLATION: le garde réseau ne peut être chargé hors recette locale.");
}

const allowedPorts = new Set(
  String(process.env.VERDANZA_RECETTE_ALLOWED_PORTS || "")
    .split(",")
    .map(Number)
    .filter(Number.isSafeInteger),
);
const logPath = process.env.VERDANZA_RECETTE_NETWORK_LOG;

function record(kind, host, port) {
  if (!logPath) return;
  const entry = JSON.stringify({
    at: new Date().toISOString(),
    kind,
    host: String(host || ""),
    port: Number(port || 0),
    source: path.basename(process.argv[1] || process.title),
    blocked: true,
  });
  try { fs.appendFileSync(logPath, `${entry}\n`, "utf8"); } catch { /* reporting must not weaken the block */ }
}

function isAllowed(host, port) {
  return host === "127.0.0.1" && allowedPorts.has(Number(port));
}

function destination(args, defaultPort) {
  const first = args[0];
  if (typeof first === "string" && !/^\d+$/.test(first)) return { pipe: true };
  if (typeof first === "object" && first) {
    if (first.path && !first.port) return { pipe: true };
    return { host: first.host || first.hostname || "127.0.0.1", port: first.port || defaultPort };
  }
  return { host: typeof args[1] === "string" ? args[1] : "127.0.0.1", port: first || defaultPort };
}

function guardedConnect(original, kind, defaultPort) {
  return function (...args) {
    const target = destination(args, defaultPort);
    if (target.pipe) return original.apply(this, args);
    if (!isAllowed(target.host, target.port)) {
      record(kind, target.host, target.port);
      const error = new Error(`ISOLATION_NETWORK_BLOCKED ${target.host}:${target.port}`);
      error.code = "ISOLATION_NETWORK_BLOCKED";
      throw error;
    }
    return original.apply(this, args);
  };
}

net.connect = guardedConnect(net.connect, "net.connect", 0);
net.createConnection = guardedConnect(net.createConnection, "net.createConnection", 0);
tls.connect = guardedConnect(tls.connect, "tls.connect", 443);

const originalLookup = dns.lookup;
dns.lookup = function (hostname, ...args) {
  if (hostname !== "127.0.0.1") {
    record("dns.lookup", hostname, 0);
    const callback = args.find((value) => typeof value === "function");
    const error = Object.assign(new Error(`ISOLATION_DNS_BLOCKED ${hostname}`), { code: "ISOLATION_NETWORK_BLOCKED" });
    if (callback) return queueMicrotask(() => callback(error));
    throw error;
  }
  return originalLookup.call(this, hostname, ...args);
};

if (dns.promises?.lookup) {
  const originalPromiseLookup = dns.promises.lookup.bind(dns.promises);
  dns.promises.lookup = async function (hostname, ...args) {
    if (hostname !== "127.0.0.1") {
      record("dns.promises.lookup", hostname, 0);
      throw Object.assign(new Error(`ISOLATION_DNS_BLOCKED ${hostname}`), { code: "ISOLATION_NETWORK_BLOCKED" });
    }
    return originalPromiseLookup(hostname, ...args);
  };
}

if (typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = function (input, init) {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if (url.protocol !== "http:" || !isAllowed(url.hostname, port)) {
      record("fetch", url.hostname, port);
      return Promise.reject(Object.assign(new Error(`ISOLATION_FETCH_BLOCKED ${url.hostname}:${port}`), { code: "ISOLATION_NETWORK_BLOCKED" }));
    }
    return originalFetch(input, init);
  };
}
