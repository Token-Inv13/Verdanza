import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  extractSupplierInvoicePdfText,
  validateSupplierInvoicePdfBuffer,
} from "../api/_server/supplierInvoiceAnalysis";
import { parseSupplierInvoiceText } from "../src/lib/supplierInvoiceParsers";
import type { Product } from "../src/types";

delete (globalThis as { DOMMatrix?: unknown }).DOMMatrix;
delete (globalThis as { ImageData?: unknown }).ImageData;
delete (globalThis as { Path2D?: unknown }).Path2D;

const pdf = await PDFDocument.create();
const page = pdf.addPage([595, 842]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText(
  "Le Grossiste CBD\nFacture GRO99999\n25/07/2026\nAmnesia CBD 10 g 20,00\nEchantillon OFFERT 5 g 0,00\nTotal HT 20,00",
  { x: 50, y: 760, size: 12, font },
);
const buffer = Buffer.from(await pdf.save());

validateSupplierInvoicePdfBuffer(buffer);
await assert.rejects(
  async () => validateSupplierInvoicePdfBuffer(Buffer.from("not a pdf")),
  /Fichier PDF invalide/,
);

const text = await extractSupplierInvoicePdfText(buffer);
assert.match(text, /GRO99999/);

const parsed = parseSupplierInvoiceText(text, {
  products: [product("flower-amnesia-cbd-hydroponique", "VDZ-000001", "Amnesia")],
  aliases: [],
});
assert.equal(parsed.purchase.invoiceNumber, "GRO99999");
assert.equal(parsed.purchase.lines?.length, 1);
assert.equal(parsed.ignoredFreeLineLabels.length, 1);

console.log("Supplier invoice PDF extraction tests passed.");

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
