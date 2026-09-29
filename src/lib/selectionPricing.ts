import type { Product } from "../types/index.js";
import type { EconomicFormat, PricingPolicy } from "../types/selectionPipeline.js";
import { resolveFixedPriceOptions } from "./fixedPriceOptions.js";

export const costSourceLabels = { verified_offer: "Offre fournisseur vérifiée", recent_purchase: "Dernier achat fournisseur connu", weighted_cost: "Coût fournisseur pondéré", manual: "Coût manuel", web_unqualified: "Prix web non qualifié" };
export type PriceAdvice = { recommended: number | null; economicCost: number | null; grossMargin: number | null; contribution: number | null; markRate: number | null; marginRate: number | null; explanation: string; confidence: "qualified" | "limited" | "unavailable" };
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export function validatePricingPolicy(raw: unknown): PricingPolicy {
  if (!raw || typeof raw !== "object") throw new Error("Politique de prix absente.");
  const p = raw as PricingPolicy;
  if (p.schemaVersion !== 1 || !["flowers", "resins"].includes(p.category) || !["standard", "premium"].includes(p.positioning)
    || ![p.targetContributionRate, p.variableRate, p.packagingCost, p.lossRate, p.taxRate, p.roundingIncrement].every(finite)
    || p.targetContributionRate < 0 || p.variableRate < 0 || p.targetContributionRate + p.variableRate >= 1
    || p.packagingCost < 0 || p.lossRate < 0 || p.lossRate >= 1 || p.taxRate < 0 || p.taxRate > 1
    || p.roundingIncrement < 0.01 || p.roundingIncrement > 100 || Math.abs(p.roundingIncrement * 100 - Math.round(p.roundingIncrement * 100)) > 1e-8 || !["up", "nearest"].includes(p.roundingMode)
    || !["HT", "TTC"].includes(p.costBasis) || !["HT", "TTC"].includes(p.sellingBasis)
    || (p.costBasis === "TTC" && p.sellingBasis === "HT")) throw new Error("Politique de prix invalide ou bases fiscales incompatibles.");
  return { schemaVersion: 1, category: p.category, positioning: p.positioning, targetContributionRate: p.targetContributionRate, variableRate: p.variableRate, packagingCost: p.packagingCost, lossRate: p.lossRate, costBasis: p.costBasis, sellingBasis: p.sellingBasis, taxRate: p.taxRate, roundingIncrement: p.roundingIncrement, roundingMode: p.roundingMode };
}
export function recommendPrice(row: EconomicFormat, policy: PricingPolicy | null): PriceAdvice {
  const absent = (explanation: string): PriceAdvice => ({ recommended: null, economicCost: null, grossMargin: null, contribution: null, markRate: null, marginRate: null, explanation: `Prix conseillé indisponible : ${explanation}`, confidence: "unavailable" });
  if (!finite(row.quantity) || row.quantity <= 0 || row.unit !== "g") return absent("quantité ou unité à confirmer.");
  if (!finite(row.cost) || row.cost <= 0) return absent("coût manquant.");
  if (row.costSource === "web_unqualified") return absent("prix web non qualifié ; confirmez une source de coût.");
  if (!row.evidence || !row.capturedAt) return absent("source et date du coût à confirmer.");
  if (!policy) return absent("politique de prix à configurer.");
  try { validatePricingPolicy(policy); } catch { return absent("politique ou dénominateur invalide."); }
  if (!row.costBasis || row.costBasis !== policy.costBasis) return absent("base HT/TTC du coût incompatible ou non confirmée.");
  const economicCost = row.cost / (1 - policy.lossRate) + policy.packagingCost;
  const theoretical = economicCost / (1 - policy.variableRate - policy.targetContributionRate);
  const factor = policy.costBasis === "HT" && policy.sellingBasis === "TTC" ? 1 + policy.taxRate : 1;
  const steps = theoretical * factor / policy.roundingIncrement;
  const recommended = Math.round((policy.roundingMode === "up" ? Math.ceil(steps - 1e-9) : Math.round(steps)) * policy.roundingIncrement * 100) / 100;
  if (!finite(recommended) || recommended <= 0) return absent("résultat économique invalide.");
  const final = finite(row.finalPrice) && row.finalPrice > 0 ? row.finalPrice : recommended;
  const net = final / factor;
  const grossMargin = net - economicCost;
  const contribution = net * (1 - policy.variableRate) - economicCost;
  return { recommended, economicCost, grossMargin, contribution, markRate: grossMargin / net, marginRate: grossMargin / economicCost,
    confidence: row.costSource === "manual" ? "limited" : "qualified",
    explanation: `Basé sur ${costSourceLabels[row.costSource].toLowerCase()} (${row.cost.toFixed(2)} € ${row.costBasis}), le conditionnement, les pertes et les frais configurés. Contribution cible après frais variables ${(policy.targetContributionRate * 100).toFixed(1)} % du prix en base économique. Indicateurs sur ${row.finalPrice ? "le prix final admin" : "le prix conseillé"}, après coût économique. Contribution avant charges fixes, distincte du bénéfice net.` };
}
export function compareCatalogue(row: EconomicFormat, category: string, positioning: "standard" | "premium", catalogue: { available: boolean; products: Product[]; complete?: boolean }) {
  if (!catalogue.available || !row.quantity || row.unit !== "g") return { available: false, pricesPerGram: [] as number[], explanation: "Comparaison catalogue indisponible" };
  const pricesPerGram = catalogue.products.filter((p) => p.isActive && p.category === category && (p.pricingPositioning || (p.productTier ? "premium" : "standard")) === positioning).flatMap((p) => {
    if (p.fixedPriceMode && p.fixedPriceMode !== "disabled") return resolveFixedPriceOptions(p).filter((o) => o.quantityGrams === row.quantity && Number.isFinite(o.totalPrice) && o.totalPrice > 0).map((o) => o.totalPrice / o.quantityGrams);
    return finite(p.price) && p.price > 0 ? [p.price] : [];
  });
  return { available: true, pricesPerGram, explanation: pricesPerGram.length ? `${pricesPerGram.length} format(s) comparable(s) du catalogue Firestore${catalogue.complete === false ? " (échantillon borné)" : ""}.` : "Aucun format comparable dans le catalogue consulté." };
}
