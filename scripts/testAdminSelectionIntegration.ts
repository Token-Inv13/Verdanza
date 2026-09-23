import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { createSelectionPdf } from "../api/_server/selectionPdf";
import { handleSelection, parseSupplierHtml } from "../api/_server/selectionRoute";
import type { VercelRequestLike, VercelResponseLike } from "../api/_server/http";
import { publicSelectionEntry, publicSelectionView } from "../src/lib/selectionPublication";
import { buildCatalogProduct, catalogPublicationMissing, normalizeCatalogInput } from "../src/lib/selectionCatalog";
import { isProductOrderable } from "../src/lib/cartStock";
import { resolveProductPurchaseOptions } from "../src/lib/productPurchaseOptions";
import {
  costPerGram, emptySelection, normalizeSelection, publicationMissing,
} from "../src/types/selection";

const legacy = {
  id: "1372260d-7898-4177-8073-02e1be0c4e0b",
  name: "Fleur test", url: "https://originecbd.fr/produit/test", supplier: "originecbd.fr",
  category: "Fleur", molecule: "CBD", status: "Retenu", priority: "Haute",
  prices: [{ format: "1 gramme", price: "9.30" }, { format: "3 g (+ 1 g OFFERTS !)", price: "27.00" }],
  notes: "Coût privé : 27 €, ne pas publier", rating: 4, attributes: { "génétique": "Test Haze" },
};
const imported = normalizeSelection(legacy);
assert.equal(imported.name, legacy.name);
assert.equal(imported.notes, legacy.notes);
assert.equal(imported.attributes["génétique"], "Test Haze");
assert.equal(imported.prices.length, 2);
assert.equal(costPerGram(imported.prices[1]), 6.75);
assert.equal(costPerGram({ format: "3 g x 2", price: "20" }), null);
assert.ok(publicationMissing(imported).includes("étape En boutique"));

const ready = {
  ...emptySelection(), ...imported, id: legacy.id, publicName: "Fleur test Verdanza", status: "En boutique" as const,
  taste: "Fruité et doux", aromas: "Fruits, Agrumes", intensity: "moyenne" as const,
  aromaFamily: "fruite" as const, appearance: "Fleurs compactes", imagePath: `selection-images/${legacy.id}/12345678-1234-1234-1234-123456789012.jpg`,
};
assert.deepEqual(publicationMissing(ready), []);
const entry = publicSelectionEntry(ready, "fleur-test-verdanza", "selection-sheets/fleur-test-verdanza/12345678-1234-1234-1234-123456789012.pdf", "2026-09-23T00:00:00Z");
const view = publicSelectionView(entry);
assert.equal(view.selectionProfile.category, "flower");
assert.equal(view.pdfUrl.includes("kind=pdf"), true);
assert.equal("notes" in entry, false);
assert.equal("prices" in entry, false);
assert.equal("supplier" in view, false);
assert.equal("attributes" in entry, false);

const catalogInput = normalizeCatalogInput({ price: 9.99, stock: 25, description: "Une fleur aux notes fruitées et à l'intensité moyenne." });
const catalogProduct = buildCatalogProduct({ ...ready, origin: "France" }, catalogInput);
assert.deepEqual(catalogPublicationMissing({ ...ready, origin: "France" }), []);
assert.equal(catalogProduct.category, "flowers");
assert.equal(catalogProduct.price, 9.99);
assert.equal(catalogProduct.stock, 25);
assert.equal(catalogProduct.fixedPriceMode, "disabled");
assert.equal(catalogProduct.sourceSelectionId, ready.id);
assert.equal(isProductOrderable(catalogProduct), true);
assert.equal(resolveProductPurchaseOptions(catalogProduct)[0].totalPrice, 9.99);
assert.equal(JSON.stringify(catalogProduct).includes("Coût privé"), false);
assert.equal(JSON.stringify(catalogProduct).includes("27.00"), false);
assert.equal(JSON.stringify(catalogProduct).includes("originecbd.fr"), false);
assert.throws(() => normalizeCatalogInput({ price: 0, stock: 25, description: catalogInput.description }), /prix de vente/);
assert.throws(() => normalizeCatalogInput({ price: 9.99, stock: 0, description: catalogInput.description }), /stock/);
assert.ok(catalogPublicationMissing({ ...ready, origin: "France", status: "Retenu" }).includes("étape En boutique"));

const extracted = parseSupplierHtml(`
  <h1>Fleur exemple THC-X 30 %</h1>
  <table><tr><th>Provenance</th><td>Suisse</td></tr><tr><th>Arômes</th><td>Fruité</td></tr></table>
  <form data-product_variations="[{&quot;attributes&quot;:{&quot;attribute_pa_poids&quot;:&quot;3 g (+ 1 g offert)&quot;},&quot;display_price&quot;:31.9},{&quot;attributes&quot;:{&quot;attribute_pa_poids&quot;:&quot;5 g&quot;},&quot;display_price&quot;:45.5}]"></form>
`, new URL("https://legrossisteducbd.shop/fleur-exemple"));
assert.equal(extracted.category, "Fleur");
assert.equal(extracted.origin, "Suisse");
assert.deepEqual(extracted.prices, [
  { format: "3 g (+ 1 g offert)", price: "31.90" },
  { format: "5 g", price: "45.50" },
]);

async function anonymousStatus(method: string) {
  let status = 0;
  const response = {
    setHeader: () => undefined,
    status: (value: number) => { status = value; return response; },
    json: () => undefined,
  } as unknown as VercelResponseLike;
  await handleSelection({ method, url: "/api/selection", headers: {}, body: { action: "save", selection: ready } } as VercelRequestLike, response);
  return status;
}
assert.equal(await anonymousStatus("GET"), 401);
assert.equal(await anonymousStatus("POST"), 401);
assert.equal(await anonymousStatus("DELETE"), 405);

const image = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#7b9253" } }).jpeg().toBuffer();
const bytes = await createSelectionPdf(ready, image);
if (process.env.SELECTION_PDF_PREVIEW_PATH) await writeFile(process.env.SELECTION_PDF_PREVIEW_PATH, bytes);
const pdf = await PDFDocument.load(bytes);
assert.equal(pdf.getPageCount(), 2);
assert.match(pdf.getTitle() || "", /Fleur test Verdanza/);
assert.equal(pdf.getPage(0).getWidth() > 300, true);
await assert.rejects(createSelectionPdf({ ...ready, taste: "Un profil aromatique exceptionnel ".repeat(80) }, image), /Texte trop long pour le PDF/);
console.log("Admin selection integration: legacy import, privacy projection, price per gram and two-page PDF OK");
