import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  analyzeSupplierInvoicePdfBuffer,
  extractSupplierInvoicePdfText,
  SUPPLIER_INVOICE_PDF_OPTIONS,
  validateSupplierInvoicePdfBuffer,
} from "../api/_server/supplierInvoiceAnalysis";
import { parseSupplierInvoiceText } from "../src/lib/supplierInvoiceParsers";
import type { Product } from "../src/types";

assert.deepEqual(SUPPLIER_INVOICE_PDF_OPTIONS, {
  disableWorker: true,
  useSystemFonts: true,
  isEvalSupported: false,
});

const simplePdf = await pdfBuffer([
  "Le Grossiste CBD\nFacture GRO99999\n25/07/2026\nAmnesia CBD 10 g 20,00\nEchantillon OFFERT 5 g 0,00\nTotal HT 20,00",
]);

validateSupplierInvoicePdfBuffer(simplePdf);
await assert.rejects(
  async () => validateSupplierInvoicePdfBuffer(Buffer.from("not a pdf")),
  /Fichier PDF invalide/,
);
const oversizedPdf = Buffer.alloc(5 * 1024 * 1024 + 1);
oversizedPdf.write("%PDF");
assert.throws(
  () => validateSupplierInvoicePdfBuffer(oversizedPdf),
  /PDF trop volumineux/,
);

const text = await extractSupplierInvoicePdfText(simplePdf);
assert.match(text, /GRO99999/);

const parsed = parseSupplierInvoiceText(text, {
  products: [product("flower-amnesia-cbd-hydroponique", "VDZ-000001", "Amnesia")],
  aliases: [],
});
assert.equal(parsed.purchase.invoiceNumber, "GRO99999");
assert.equal(parsed.purchase.lines?.length, 1);
assert.equal(parsed.ignoredFreeLineLabels.length, 1);

const multipagePdf = await pdfBuffer([
  "Le Grossiste CBD\nFacture GRO99999\n25/07/2026\nAmnesia CBD 10 g 20,00",
  "PAGE DEUX\nTotal HT 20,00",
]);
assert.equal(
  await extractSupplierInvoicePdfText(multipagePdf),
  "Le Grossiste CBD\nFacture GRO99999\n25/07/2026\nAmnesia CBD 10 g 20,00\nPAGE DEUX\nTotal HT 20,00",
);

const blankPdf = await pdfBuffer([""]);
assert.equal((await extractSupplierInvoicePdfText(blankPdf)).trim(), "");
await assert.rejects(
  () => analyzeSupplierInvoicePdfBuffer({} as never, blankPdf),
  /PDF sans texte exploitable/,
);

await assert.rejects(
  () => extractSupplierInvoicePdfText(Buffer.from("%PDF-1.7\ninvalid structure\n%%EOF")),
  /PDF illisible ou endommagé/,
);

console.log("Supplier invoice PDF extraction tests passed.");

async function pdfBuffer(pageTexts: string[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const pageText of pageTexts) {
    const page = pdf.addPage([595, 842]);
    if (pageText) page.drawText(pageText, { x: 50, y: 760, size: 12, font });
  }
  return Buffer.from(await pdf.save());
}

function product(id: string, internalReference: string, name: string): Product {
  return {
    id,
    internalReference,
    slug: id,
    name,
    category: "flowers",
    price: 10,
    shortDescription: "",
    longDescription: "",
    image: "",
    cbdRate: "",
    cbgRate: "",
    thcRate: "",
    origin: "",
    cultureType: "A renseigner",
    aromas: [],
    tags: [],
    stock: 1,
    lowStockThreshold: 1,
    isActive: true,
    isFeatured: false,
    seoTitle: "",
    seoDescription: "",
  };
}
