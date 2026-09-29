import type { FixedPriceMode, FixedPriceOption, Product } from "./index.js";

export const costSources = ["verified_offer", "recent_purchase", "weighted_cost", "manual", "web_unqualified"] as const;
export type CostSource = typeof costSources[number];
export type EconomicFormat = {
  id: string; label: string; quantity: number | null; unit: "g" | "";
  cost: number | null; costBasis: "HT" | "TTC" | ""; costSource: CostSource;
  evidence: string; capturedAt: string; finalPrice: number | null;
};
export type SupplierCapture = {
  sourceUrl: string; capturedAt: string; adapter: string;
  fields: Record<string, { value: string; source: string; method: "declared" | "inferred"; confidence: "high" | "limited" }>;
};
export type CommercialPreparation = {
  description: string; pricePerGram: number | null; initialStock: number | null;
  seoTitle: string; seoDescription: string; positioning: "standard" | "premium";
  fixedPriceMode: FixedPriceMode; fixedPriceOptions: FixedPriceOption[];
};
export type PricingPolicy = {
  schemaVersion: 1; category: "flowers" | "resins"; positioning: "standard" | "premium";
  targetContributionRate: number; variableRate: number; packagingCost: number; lossRate: number;
  costBasis: "HT" | "TTC"; sellingBasis: "HT" | "TTC"; taxRate: number;
  roundingIncrement: number; roundingMode: "up" | "nearest";
};
export type PipelineStage = "draft" | "selection_validated" | "product_prepared" | "catalog_ready" | "publish_ready" | "published";
export type SelectionWorkflow = {
  schemaVersion: 1; revision: number;
  selectionValidatedRevision: number | null; productPreparedRevision: number | null;
  catalogReadyRevision: number | null; publishReadyRevision: number | null; publishedRevision: number | null;
  draft: Product | null; productId: string; productFingerprint: string; stale: boolean;
  legacyProductSnapshot?: Record<string, unknown>;
};
export type PipelineContext = {
  workflow: SelectionWorkflow;
  product: Product | null;
  policy: PricingPolicy | null;
  catalogue: { available: boolean; products: Product[]; complete: boolean };
  costs: EconomicFormat[];
};
export type PipelineAction = "save" | "validateSelection" | "prepareProduct" | "createCatalog" | "validatePublication" | "activate" | "publishSheet" | "unpublishSheet";
export type PipelineOperation = {
  action: PipelineAction; operationId: string; id: string; expectedRevision: number;
  selection?: unknown; imageBase64?: string;
};

export function emptyCommercial(): CommercialPreparation {
  return { description: "", pricePerGram: null, initialStock: null, seoTitle: "", seoDescription: "", positioning: "standard", fixedPriceMode: "disabled", fixedPriceOptions: [] };
}
export function emptyWorkflow(revision = 0, productId = ""): SelectionWorkflow {
  return { schemaVersion: 1, revision, selectionValidatedRevision: null, productPreparedRevision: null, catalogReadyRevision: null, publishReadyRevision: null, publishedRevision: null, draft: null, productId, productFingerprint: "", stale: false };
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const amount = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
export function normalizeCommercial(raw: unknown): CommercialPreparation {
  const v = object(raw);
  return {
    description: text(v.description, 1000), pricePerGram: amount(v.pricePerGram), initialStock: amount(v.initialStock),
    seoTitle: text(v.seoTitle, 120), seoDescription: text(v.seoDescription, 320),
    positioning: v.positioning === "premium" ? "premium" : "standard",
    fixedPriceMode: v.fixedPriceMode === "manual" || v.fixedPriceMode === "automatic" ? v.fixedPriceMode : "disabled",
    fixedPriceOptions: (Array.isArray(v.fixedPriceOptions) ? v.fixedPriceOptions : []).slice(0, 40).map((row) => {
      const r = object(row);
      return { id: text(r.id, 80), ...(r.label ? { label: text(r.label, 120) } : {}), quantityGrams: amount(r.quantityGrams) ?? 0, totalPrice: amount(r.totalPrice) ?? 0, isActive: r.isActive !== false,
        ...(amount(r.sortOrder) !== null ? { sortOrder: amount(r.sortOrder)! } : {}),
        ...(r.source === "automatic" || r.source === "manual" ? { source: r.source } : {}),
        ...(amount(r.policyVersion) !== null ? { policyVersion: amount(r.policyVersion)! } : {}) };
    }),
  };
}
export function normalizeEconomics(raw: unknown): EconomicFormat[] {
  return (Array.isArray(raw) ? raw : []).slice(0, 40).map((entry, index) => {
    const r = object(entry);
    return { id: text(r.id, 80) || `format-${index}`, label: text(r.label, 120), quantity: amount(r.quantity), unit: r.unit === "g" ? "g" : "",
      cost: amount(r.cost), costBasis: r.costBasis === "HT" || r.costBasis === "TTC" ? r.costBasis : "", costSource: costSources.includes(r.costSource as CostSource) ? r.costSource as CostSource : "web_unqualified",
      evidence: text(r.evidence, 500), capturedAt: text(r.capturedAt, 40), finalPrice: amount(r.finalPrice) };
  });
}
export function normalizeCapture(raw: unknown): SupplierCapture | undefined {
  const r = object(raw);
  if (!r.sourceUrl) return undefined;
  const fields: SupplierCapture["fields"] = {};
  for (const [key, value] of Object.entries(object(r.fields)).slice(0, 50)) {
    const f = object(value);
    fields[text(key, 80)] = { value: text(f.value, 2000), source: text(f.source, 1000), method: f.method === "declared" ? "declared" : "inferred", confidence: f.confidence === "high" ? "high" : "limited" };
  }
  return { sourceUrl: text(r.sourceUrl, 1000), capturedAt: text(r.capturedAt, 40), adapter: text(r.adapter, 80), fields };
}
export function pipelineStage(w: SelectionWorkflow): PipelineStage {
  if (w.publishedRevision === w.revision) return "published";
  if (w.publishReadyRevision === w.revision) return "publish_ready";
  if (w.catalogReadyRevision === w.revision) return "catalog_ready";
  if (w.productPreparedRevision === w.revision) return "product_prepared";
  if (w.selectionValidatedRevision === w.revision) return "selection_validated";
  return "draft";
}
