import assert from "node:assert/strict";
import { createRequire } from "node:module";

delete (globalThis as { DOMMatrix?: unknown }).DOMMatrix;
delete (globalThis as { ImageData?: unknown }).ImageData;
delete (globalThis as { Path2D?: unknown }).Path2D;

const require = createRequire(import.meta.url);
const before = loadedPdfModules();
const invoicesModule = await import("../api/invoices");
assert.equal(typeof invoicesModule.default, "function");

const response = mockResponse();
await invoicesModule.default(
  {
    method: "GET",
    url: "/api/invoices?action=productCosts",
    headers: {},
  } as Parameters<typeof invoicesModule.default>[0],
  response as Parameters<typeof invoicesModule.default>[1],
);

assert.equal(response.statusCode, 401);
assert.deepEqual(response.payload, { error: "Token admin requis." });
assert.deepEqual(loadedPdfModules(), before);

console.log("Invoices API import test passed.");

function loadedPdfModules() {
  return Object.keys(require.cache)
    .filter((key) => key.includes("pdf-parse") || key.includes("pdfjs-dist"))
    .sort();
}

function mockResponse() {
  return {
    statusCode: 200,
    payload: undefined as unknown,
    headers: {} as Record<string, string>,
    status(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
    },
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    end(payload?: unknown) {
      this.payload = payload;
    },
  };
}
