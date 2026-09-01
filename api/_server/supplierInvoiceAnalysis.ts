import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import type { Firestore } from "firebase-admin/firestore";
import {
  parseSupplierInvoiceText,
} from "../../src/lib/supplierInvoiceParsers.js";
import type {
  Product,
  SupplierProductAlias,
} from "../../src/types/index.js";

export async function analyzeSupplierInvoicePdfBuffer(
  db: Firestore,
  buffer: Buffer,
) {
  validateSupplierInvoicePdfBuffer(buffer);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const text = await extractSupplierInvoicePdfText(buffer);
  if (!text.trim()) throw new Error("PDF sans texte exploitable. OCR non pris en charge.");

  const [productsSnapshot, aliasesSnapshot] = await Promise.all([
    db.collection("products").get(),
    db.collection("supplierProductAliases").get(),
  ]);
  const products = productsSnapshot.docs.map((entry) => ({
    id: entry.id,
    ...entry.data(),
  })) as Product[];
  const aliases = aliasesSnapshot.docs.map((entry) => ({
    id: entry.id,
    ...entry.data(),
  })) as SupplierProductAlias[];
  const result = parseSupplierInvoiceText(text, { products, aliases });
  const duplicate = await supplierPurchaseDuplicate(db, {
    sha256,
    supplierName: result.purchase.supplierName || "",
    invoiceNumber: result.purchase.invoiceNumber || "",
  });

  return {
    ...result,
    fileSha256: sha256,
    duplicate,
  };
}

export function validateSupplierInvoicePdfBuffer(buffer: Buffer) {
  if (buffer.length > 5 * 1024 * 1024) throw new Error("PDF trop volumineux (5 Mo max).");
  if (buffer.subarray(0, 4).toString("utf8") !== "%PDF") {
    throw new Error("Fichier PDF invalide.");
  }
}

export const SUPPLIER_INVOICE_PDF_OPTIONS = Object.freeze({
  disableWorker: true,
  useSystemFonts: true,
  isEvalSupported: false,
});

const SUPPLIER_PDF_DIAG_PREFIX = "[supplier-pdf-diag]";
const SUPPLIER_PDF_DIAG_STACK_LINES = 8;
const SUPPLIER_PDF_DIAG_CAUSE_DEPTH = 8;

type SupplierPdfJs = {
  version?: unknown;
  getDocument: (options: {
    data: Uint8Array;
    disableWorker: boolean;
    useSystemFonts: boolean;
    isEvalSupported: boolean;
  }) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getTextContent: () => Promise<{
          items: Array<{ str?: string }>;
        }>;
      }>;
    }>;
  };
};

function isSupplierPdfPreviewDiagnostic() {
  return process.env.VERCEL_ENV === "preview";
}

function serializeSupplierPdfDiagnosticCause(value: unknown, depth = 0): unknown {
  if (depth >= SUPPLIER_PDF_DIAG_CAUSE_DEPTH) return "[cause depth limit]";
  if (Array.isArray(value)) {
    return value
      .slice(0, SUPPLIER_PDF_DIAG_CAUSE_DEPTH)
      .map((entry) => serializeSupplierPdfDiagnosticCause(entry, depth + 1));
  }
  if (value instanceof Error) return serializeSupplierPdfDiagnosticError(value, depth + 1);
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  return Object.prototype.toString.call(value);
}

function serializeSupplierPdfDiagnosticError(error: unknown, depth = 0) {
  if (!(error instanceof Error)) {
    return {
      constructor: Object.prototype.toString.call(error),
      message: String(error),
    };
  }
  const extended = error as Error & { code?: unknown; cause?: unknown; errors?: unknown[] };
  const serialized: Record<string, unknown> = {
    constructor: error.constructor?.name || "Error",
    name: error.name,
    message: error.message,
    stack: error.stack?.split("\n").slice(0, SUPPLIER_PDF_DIAG_STACK_LINES),
  };
  if (extended.code !== undefined) serialized.code = String(extended.code);
  if (extended.cause !== undefined) {
    serialized.cause = serializeSupplierPdfDiagnosticCause(extended.cause, depth + 1);
  }
  if (extended.errors !== undefined) {
    serialized.errors = serializeSupplierPdfDiagnosticCause(extended.errors, depth + 1);
  }
  return serialized;
}

function logSupplierPdfDiagnostic(event: string, details: Record<string, unknown>) {
  console.info(`${SUPPLIER_PDF_DIAG_PREFIX} ${JSON.stringify({ event, ...details })}`);
}

function logSupplierPdfDiagnosticError(
  event: string,
  error: unknown,
  details: Record<string, unknown> = {},
) {
  console.error(
    `${SUPPLIER_PDF_DIAG_PREFIX} ${JSON.stringify({
      event,
      ...details,
      error: serializeSupplierPdfDiagnosticError(error),
    })}`,
  );
}

function probeSupplierPdfConstructor(name: string, value: unknown) {
  try {
    if (typeof value !== "function") throw new TypeError(`${name} export is not a constructor`);
    Reflect.construct(value, []);
    logSupplierPdfDiagnostic("canvas-constructor", { name, status: "PASS" });
  } catch (error) {
    logSupplierPdfDiagnosticError("canvas-constructor", error, { name, status: "FAIL" });
  }
}

function runSupplierPdfPreviewDiagnostics() {
  try {
    let glibcVersionRuntime: unknown = null;
    let glibcVersionCompiler: unknown = null;
    let reportError: unknown = null;
    try {
      const report = process.report?.getReport() as
        | { header?: Record<string, unknown> }
        | undefined;
      const header = report?.header;
      glibcVersionRuntime = header?.glibcVersionRuntime ?? null;
      glibcVersionCompiler = header?.glibcVersionCompiler ?? null;
    } catch (error) {
      reportError = serializeSupplierPdfDiagnosticError(error);
    }
    logSupplierPdfDiagnostic("runtime", {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      modulesAbi: process.versions.modules ?? null,
      napi: process.versions.napi ?? null,
      execPath: process.execPath,
      glibcVersionRuntime,
      glibcVersionCompiler,
      reportError,
    });

    const runtimeRequire = createRequire(import.meta.url);
    const canvasModuleName = ["@napi-rs", "canvas"].join("/");
    const nativeModuleName = ["@napi-rs", "canvas-linux-x64-gnu"].join("/");

    for (const moduleName of [canvasModuleName, nativeModuleName]) {
      try {
        const resolvedPath = runtimeRequire.resolve(moduleName);
        const isNativeBinary = resolvedPath.endsWith(".node");
        const exists = existsSync(resolvedPath);
        const size = exists && isNativeBinary ? statSync(resolvedPath).size : null;
        logSupplierPdfDiagnostic("module-resolve", {
          module: moduleName,
          status: "RESOLVED",
          path: resolvedPath,
          isNativeBinary,
          exists,
          size,
        });
      } catch (error) {
        logSupplierPdfDiagnosticError("module-resolve", error, {
          module: moduleName,
          status: "FAILED",
        });
      }
    }

    try {
      const canvas = runtimeRequire(canvasModuleName) as Record<string, unknown>;
      const exports = {
        DOMMatrix: typeof canvas.DOMMatrix === "function",
        ImageData: typeof canvas.ImageData === "function",
        Path2D: typeof canvas.Path2D === "function",
        createCanvas: typeof canvas.createCanvas === "function",
      };
      logSupplierPdfDiagnostic("canvas-load", {
        module: canvasModuleName,
        status: "PASS",
        exports,
      });
      probeSupplierPdfConstructor("DOMMatrix", canvas.DOMMatrix);
      probeSupplierPdfConstructor("Path2D", canvas.Path2D);
      try {
        if (typeof canvas.createCanvas !== "function") {
          throw new TypeError("createCanvas export is not a function");
        }
        canvas.createCanvas(1, 1);
        logSupplierPdfDiagnostic("canvas-create", { operation: "createCanvas(1,1)", status: "PASS" });
      } catch (error) {
        logSupplierPdfDiagnosticError("canvas-create", error, {
          operation: "createCanvas(1,1)",
          status: "FAIL",
        });
      }
    } catch (error) {
      logSupplierPdfDiagnosticError("canvas-load", error, {
        module: canvasModuleName,
        status: "FAIL",
      });
      try {
        runtimeRequire(nativeModuleName);
        logSupplierPdfDiagnostic("native-load", { module: nativeModuleName, status: "PASS" });
      } catch (nativeError) {
        logSupplierPdfDiagnosticError("native-load", nativeError, {
          module: nativeModuleName,
          status: "FAIL",
        });
      }
    }
  } catch (error) {
    logSupplierPdfDiagnosticError("diagnostic-probe", error, { status: "FAIL" });
  }
}

export async function extractSupplierInvoicePdfText(buffer: Buffer) {
  const pdfjsModuleName = "pdfjs-dist/legacy/build/pdf.mjs";
  const previewDiagnostic = isSupplierPdfPreviewDiagnostic();
  let stage = "runtime-probes";
  try {
    if (previewDiagnostic) runSupplierPdfPreviewDiagnostics();

    stage = "pdfjs-import";
    const pdfjs = (await import(pdfjsModuleName)) as SupplierPdfJs;
    if (previewDiagnostic) {
      logSupplierPdfDiagnostic("pdfjs-import", {
        status: "PASS",
        version: typeof pdfjs.version === "string" ? pdfjs.version : null,
        getDocument: typeof pdfjs.getDocument === "function",
      });
    }

    stage = "pdf-getDocument";
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      ...SUPPLIER_INVOICE_PDF_OPTIONS,
    });
    if (previewDiagnostic) logSupplierPdfDiagnostic("pdf-getDocument", { status: "PASS" });

    stage = "document-promise";
    const document = await loadingTask.promise;
    if (previewDiagnostic) {
      logSupplierPdfDiagnostic("document-promise", { status: "PASS", numPages: document.numPages });
    }

    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      stage = `getPage:${pageNumber}`;
      const page = await document.getPage(pageNumber);
      if (previewDiagnostic) {
        logSupplierPdfDiagnostic("getPage", { status: "PASS", pageNumber });
      }
      stage = `getTextContent:${pageNumber}`;
      const content = await page.getTextContent();
      if (previewDiagnostic) {
        logSupplierPdfDiagnostic("getTextContent", {
          status: "PASS",
          pageNumber,
          itemCount: content.items.length,
        });
      }
      pages.push(
        content.items
          .map((item) => item.str || "")
          .join("\n"),
      );
    }
    return pages.join("\n");
  } catch (error) {
    if (previewDiagnostic) {
      logSupplierPdfDiagnosticError("pdfjs-failure", error, { stage, status: "FAIL" });
    }
    throw new Error("PDF illisible ou endommagé.");
  }
}

async function supplierPurchaseDuplicate(
  db: Firestore,
  input: { sha256: string; supplierName: string; invoiceNumber: string },
) {
  const byHash = await db
    .collection("supplierPurchases")
    .where("sourceFileSha256", "==", input.sha256)
    .limit(1)
    .get();
  if (!byHash.empty) return { found: true, reason: "file_hash", purchaseId: byHash.docs[0].id };

  if (!input.supplierName || !input.invoiceNumber) return { found: false };
  const byInvoice = await db
    .collection("supplierPurchases")
    .where("invoiceNumber", "==", input.invoiceNumber)
    .limit(10)
    .get();
  const sameSupplier = byInvoice.docs.find(
    (entry) => String(entry.data().supplierName || "") === input.supplierName,
  );
  if (sameSupplier) {
    return { found: true, reason: "supplier_invoice_number", purchaseId: sameSupplier.id };
  }
  return { found: false };
}
