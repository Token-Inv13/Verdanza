import { createHash } from "node:crypto";
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

export async function extractSupplierInvoicePdfText(buffer: Buffer) {
  const pdfjsModuleName = "pdfjs-dist/legacy/build/pdf.mjs";
  const pdfjs = (await import(pdfjsModuleName)) as {
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
  try {
    const document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      ...SUPPLIER_INVOICE_PDF_OPTIONS,
    }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => item.str || "")
          .join("\n"),
      );
    }
    return pages.join("\n");
  } catch {
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
