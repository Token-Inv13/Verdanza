import type { Product, SupplierPurchase } from "../types/index.js";
import { emptyCommercial, normalizeCommercial, type EconomicFormat, type SelectionWorkflow } from "../types/selectionPipeline.js";
import { gramsInSelectionFormat, selectionPublicName, type ProductSelection } from "../types/selection.js";
import { buildCatalogProduct } from "./selectionCatalog.js";
import { validateManualFixedPriceOptions } from "./fixedPriceOptions.js";

export function validatePipelineProductFormats(product: Product) {
  const errors = validateManualFixedPriceOptions(product).filter((issue) => issue.severity === "error");
  if (errors.length) throw new Error(`Formats fixes : ${errors.map((issue) => issue.message).join(" ")}`);
}

export function prepareImportedSelection(item: ProductSelection): ProductSelection {
  const name = selectionPublicName(item);
  const economics: EconomicFormat[] = item.prices.map((row, index) => ({ id: `supplier-${index}`, label: row.format, quantity: gramsInSelectionFormat(row.format), unit: gramsInSelectionFormat(row.format) ? "g" : "", cost: Number(row.price) > 0 ? Number(row.price) : null, costSource: "web_unqualified", costBasis: "", evidence: item.url, capturedAt: item.extraction?.capturedAt || "", finalPrice: null }));
  const extraction = item.extraction ? { ...item.extraction, fields: { ...item.extraction.fields, publicName: { value: name, source: item.url, method: "inferred" as const, confidence: "limited" as const }, seoTitle: { value: `${name} | Verdanza`, source: item.url, method: "inferred" as const, confidence: "limited" as const } } } : undefined;
  return { ...item, ...(extraction ? { extraction } : {}), publicName: name, economics, commercial: { ...emptyCommercial(), description: item.description.slice(0, 1000), seoTitle: name ? `${name} | Verdanza` : "", seoDescription: item.description.slice(0, 220) } };
}
export function selectionValidationMissing(item: ProductSelection) {
  const missing = [];
  if (!selectionPublicName(item)) missing.push("nom public");
  if (!["Fleur", "Résine"].includes(item.category)) missing.push("catégorie Fleur ou Résine");
  for (const [key, label] of [["intensity", "intensité"], ["aromas", "arômes"], ["aromaFamily", "famille aromatique"], ["appearance", "aspect"], ["taste", "goût"], ["origin", "provenance"]] as const) if (!item[key]) missing.push(label);
  return missing;
}
export function preparePipelineProduct(item: ProductSelection): Product {
  const missing = selectionValidationMissing(item);
  if (missing.length) throw new Error(`Complétez la sélection : ${missing.join(", ")}.`);
  const c = normalizeCommercial(item.commercial);
  if (c.pricePerGram === null || c.pricePerGram <= 0 || c.pricePerGram > 1000 || Math.abs(c.pricePerGram * 100 - Math.round(c.pricePerGram * 100)) > 1e-8) throw new Error("Prix de vente par gramme positif à deux décimales requis.");
  if (c.initialStock === null || !Number.isSafeInteger(c.initialStock) || c.initialStock < 0 || c.initialStock > 100000) throw new Error("Stock initial proposé entier requis.");
  if (c.description.length < 30 || c.description.length > 1000) throw new Error("Description client de 30 à 1 000 caractères requise.");
  if (!item.imagePath) throw new Error("Image Verdanza enregistrée requise.");
  if (!c.seoTitle || !c.seoDescription) throw new Error("Titre et description SEO requis.");
  let options = c.fixedPriceOptions;
  const economics = item.economics || [];
  if (economics.length) {
    if (economics.some((r) => !r.quantity || r.unit !== "g" || !r.finalPrice || r.finalPrice <= 0)) throw new Error("Chaque format retenu doit avoir une quantité explicite en g et un prix final.");
    if (economics.some((r) => r.quantity === 1 && r.finalPrice !== c.pricePerGram)) throw new Error("Le prix final du format 1 g doit correspondre au prix par gramme.");
    options = economics.filter((r) => r.quantity !== 1).map((r, index) => ({ id: r.id, label: r.label, quantityGrams: r.quantity!, totalPrice: r.finalPrice!, isActive: true, sortOrder: index, source: "manual" as const }));
  }
  if (options.some((o) => !o.id || !Number.isSafeInteger(o.quantityGrams) || o.quantityGrams <= 0 || !Number.isFinite(o.totalPrice) || o.totalPrice <= 0 || Math.abs(o.totalPrice * 100 - Math.round(o.totalPrice * 100)) > 1e-8)) throw new Error("Formats fixes invalides.");
  if (new Set(options.map((o) => o.id)).size !== options.length || new Set(options.map((o) => o.quantityGrams)).size !== options.length) throw new Error("Formats fixes dupliqués.");
  const product = buildCatalogProduct({ ...item, status: "En boutique" }, { price: c.pricePerGram, stock: c.initialStock, description: c.description });
  if (!economics.length && c.fixedPriceMode === "manual" && !options.some((o) => o.isActive)) throw new Error("Le mode formats fixes manuel nécessite au moins un format actif.");
  const draft: Product = { ...product, isActive: false, selectionImagePath: item.imagePath, pricingPositioning: c.positioning, fixedPriceMode: economics.length ? options.length ? "manual" : "disabled" : c.fixedPriceMode,
    fixedPriceOptions: options, seoTitle: c.seoTitle, seoDescription: c.seoDescription,
    ...(c.positioning === "premium" ? { productTier: "Premium" as const } : {}) };
  validatePipelineProductFormats(draft);
  return draft;
}
export function invalidateWorkflow(previous: SelectionWorkflow, revision: number): SelectionWorkflow {
  return { ...previous, revision, selectionValidatedRevision: null, productPreparedRevision: null, catalogReadyRevision: null, publishReadyRevision: null, publishedRevision: null, draft: null, productFingerprint: "", stale: previous.selectionValidatedRevision !== null || previous.stale };
}
export function supplierCostCandidates(purchases: SupplierPurchase[], productId: string, formats: EconomicFormat[]): EconomicFormat[] {
  if (!productId) return [];
  const rows = purchases.filter((p) => p.status === "validated" && /^\d{4}-\d{2}-\d{2}$/.test(p.invoiceDate) && ["HT", "TTC"].includes(p.costBase)).flatMap((p) => p.lines.filter((l) => l.productId === productId && l.matchConfidence === "confirmed" && l.quantityGrams > 0 && Number.isFinite(l.netCostAmount) && l.netCostAmount! > 0).map((l) => ({ base: p.costBase, cost: l.netCostAmount!, quantity: l.quantityGrams, date: p.invoiceDate, id: p.id })));
  const result: EconomicFormat[] = [];
  for (const basis of ["HT", "TTC"] as const) {
    const same = rows.filter((r) => r.base === basis);
    if (!same.length) continue;
    const latest = same.reduce((a, b) => a.date > b.date ? a : b);
    const weighted = same.reduce((sum, r) => sum + r.cost, 0) / same.reduce((sum, r) => sum + r.quantity, 0);
    for (const format of formats.filter((r) => r.unit === "g" && r.quantity && r.quantity > 0)) {
      result.push({ ...format, id: `${format.id}-weighted-${basis}`, cost: weighted * format.quantity!, costBasis: basis, costSource: "weighted_cost", evidence: `Achats validés ${same.map((r) => r.id).join(", ")}`, capturedAt: latest.date });
      result.push({ ...format, id: `${format.id}-purchase-${basis}`, cost: latest.cost / latest.quantity * format.quantity!, costBasis: basis, costSource: "recent_purchase", evidence: `Dernier achat connu ${latest.id} du ${latest.date} (vérifier sa pertinence)`, capturedAt: latest.date });
    }
  }
  return result;
}
