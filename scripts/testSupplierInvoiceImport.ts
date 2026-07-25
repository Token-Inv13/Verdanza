import assert from "node:assert/strict";
import { parseSupplierInvoiceText } from "../src/lib/supplierInvoiceParsers";
import type { Product, SupplierProductAlias } from "../src/types";

const products = [
  product("flower-amnesia", "VDZ-000001", "Amnesia"),
  product("flower-blue-dream", "VDZ-000002", "Blue Dream"),
  product("resin-creamy-piatella", "VDZ-000003", "Creamy Piatella"),
  product("resin-creamy-piatella-alt", "VDZ-000004", "Creamy Piatella"),
] satisfies Product[];

const aliases = [
  {
    id: "alias-amnesia",
    supplierName: "Le Grossiste CBD",
    normalizedSupplierName: "le grossiste cbd",
    originalLabel: "AMI HYDRO CBD",
    normalizedOriginalLabel: "ami hydro",
    productId: "flower-amnesia",
    productInternalReference: "VDZ-000001",
  },
] satisfies SupplierProductAlias[];

const text = `
Le Grossiste CBD
Facture GRO17000
25/07/2026
AMI HYDRO CBD 50 g 50,00
Blue Dream CBD 25 g 30,00
Echantillon OFFERT 10 g 0,00
Frais de port 5,00
Total HT 85,00
`;

const result = parseSupplierInvoiceText(text, { products, aliases });
assert.equal(result.parserName, "LeGrossisteCbdInvoiceParser");
assert.equal(result.purchase.invoiceNumber, "GRO17000");
assert.equal(result.purchase.invoiceDate, "2026-07-25");
assert.equal(result.ignoredFreeLineLabels.length, 1);
assert.equal(result.purchase.lines?.length, 2);
assert.equal(result.purchase.lines?.[0].productId, "flower-amnesia");
assert.equal(result.purchase.lines?.[0].matchSource, "alias");
assert.equal(result.purchase.lines?.[1].productId, "flower-blue-dream");
assert.equal(result.purchase.status, "draft");

const ambiguous = parseSupplierInvoiceText(
  "Le Grossiste CBD\nFacture GRO17001\n25/07/2026\nCreamy Piatella 20 g 80,00\n",
  { products, aliases: [] },
);
assert.equal(ambiguous.purchase.lines?.[0].matchConfidence, "ambiguous");

const noText = parseSupplierInvoiceText("", { products, aliases });
assert.equal(noText.isBlocked, true);

console.log("Supplier invoice import tests passed.");

function product(id: string, internalReference: string, name: string): Product {
  return {
    id,
    internalReference,
    slug: id,
    name,
    category: id.startsWith("resin") ? "resins" : "flowers",
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
