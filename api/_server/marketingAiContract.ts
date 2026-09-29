import type { MarketingAiBrief, MarketingAiContext, MarketingAiProposal } from "../../src/types/marketingAi.js";
import type { MarketingKind, MarketingParameters } from "../../src/types/marketing.js";
import { marketingUtcDate } from "../../src/lib/adminMarketingDates.js";
import { marketingParameterProductIds } from "../../src/lib/marketingAiReferences.js";
import { validateMarketingParameters } from "./marketingAdmin.js";
import { MarketingAiError, marketingAiLimits } from "./marketingAiProvider.js";
import { validateAiSchema } from "./marketingAiSchema.js";

function invalid(message: string, code = "ai_invalid_proposal"): never { throw new MarketingAiError(message, code); }
export function validateMarketingAiBrief(raw: unknown): MarketingAiBrief {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid("Brief invalide.", "invalid_brief");
  const b = raw as MarketingAiBrief;
  if (Object.keys(b).some((key) => !["objective", "kind", "scope", "category", "productIds", "tone", "count", "period"].includes(key))
    || typeof b.objective !== "string" || !b.objective.trim() || b.objective.length > marketingAiLimits.maxBrief
    || !["free", "promotion", "banner", "contest", "campaign"].includes(b.kind)
    || !["all", "category", "products"].includes(b.scope)
    || !["discovery", "new", "loyalty", "clearance", "event", "other"].includes(b.tone)
    || !Number.isInteger(b.count) || b.count < 1 || b.count > marketingAiLimits.maxProposals)
    return invalid("Objectif, type, périmètre ou nombre de propositions invalide.", "invalid_brief");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(b.objective)
    || /(?:\+33|0)[1-9](?:[ .-]?\d{2}){4}\b/.test(b.objective))
    return invalid("Retirez les coordonnées personnelles du brief.", "brief_personal_data");
  if (b.category !== undefined && !["flowers", "resins", "oils", "packs"].includes(b.category))
    return invalid("Catégorie inconnue.", "invalid_brief");
  if (b.scope === "category" && !b.category) return invalid("Choisissez une catégorie.", "invalid_brief");
  const ids = b.productIds || [];
  if (!Array.isArray(ids) || ids.length > marketingAiLimits.maxSelectedProducts || new Set(ids).size !== ids.length
    || ids.some((id) => typeof id !== "string" || !id || id.length > 120 || id.includes("/") || [...id].some((c) => c.charCodeAt(0) < 32))
    || (b.scope === "products" && !ids.length)) return invalid("Sélection de produits invalide.", "invalid_brief");
  let period: MarketingAiBrief["period"];
  if (b.period) {
    if (typeof b.period !== "object" || Object.keys(b.period).some((key) => !["startsAt", "endsAt"].includes(key)))
      return invalid("Période invalide.", "invalid_dates");
    try {
      const startsAt = marketingUtcDate(b.period.startsAt), endsAt = marketingUtcDate(b.period.endsAt, "end");
      if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error();
      period = { startsAt, endsAt };
    } catch { return invalid("Période invalide ou fuseau ambigu.", "invalid_dates"); }
  }
  return { objective: b.objective.trim(), kind: b.kind, scope: b.scope, tone: b.tone, count: b.count,
    ...(b.scope === "category" ? { category: b.category } : {}), ...(b.scope === "products" ? { productIds: ids } : {}),
    ...(period ? { period } : {}) };
}
const cleanNulls = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));
export function validateMarketingAiProposals(raw: unknown, context: MarketingAiContext, brief: MarketingAiBrief): MarketingAiProposal[] {
  if (Buffer.byteLength(JSON.stringify(raw) || "") > marketingAiLimits.maxOutputBytes || !validateAiSchema(raw))
    return invalid("La sortie IA ne respecte pas le contrat strict. Aucune proposition retenue.");
  const rows = (raw as { proposals: Array<Record<string, unknown>> }).proposals;
  if (!rows.length || rows.length > brief.count) return invalid("Nombre de propositions IA invalide.");
  const allowed = new Set(context.products.map((p) => p.id));
  const titles = new Set<string>(), concepts = new Set<string>();
  return rows.map((row, index) => {
    const kind = row.kind as MarketingKind;
    if (brief.kind !== "free" && brief.kind !== kind) return invalid("L'IA n'a pas respecté le type demandé.");
    const expected = kind === "campaign" ? ["promotion", "banner"] : [kind];
    if (["promotion", "banner", "contest"].some((key) => Boolean(row[key]) !== expected.includes(key)))
      return invalid("Composition de proposition incohérente.");
    const title = String(row.title).trim(), concept = String(row.concept).trim(), rationale = String(row.rationale).trim();
    if (!title || !concept || !rationale || titles.has(title.toLocaleLowerCase("fr")) || concepts.has(concept.toLocaleLowerCase("fr"))) return invalid("Propositions vides ou non distinctes.");
    titles.add(title.toLocaleLowerCase("fr")); concepts.add(concept.toLocaleLowerCase("fr"));
    const refs = row.referencedProductIds as string[];
    if (new Set(refs).size !== refs.length || refs.some((id) => !allowed.has(id))) return invalid("L'IA a inventé un produit.", "ai_unknown_product");
    let parameters: MarketingParameters;
    const proposed = Object.fromEntries(expected.map((key) => [key, cleanNulls(row[key] as Record<string, unknown>)])) as MarketingParameters;
    if (marketingParameterProductIds(proposed).some((id) => !allowed.has(id) || !refs.includes(id)))
      return invalid("Produit proposé hors du contexte déclaré.", "ai_unknown_product");
    try { parameters = validateMarketingParameters(proposed, kind); }
    catch { return invalid("Configuration métier proposée invalide."); }
    if (marketingParameterProductIds(parameters).some((id) => !allowed.has(id) || !refs.includes(id)))
      return invalid("Produit ciblé hors du contexte déclaré.", "ai_unknown_product");
    if (parameters.promotion) {
      const p = parameters.promotion;
      const selected = context.products.filter((product) => refs.includes(product.id));
      const targets = p.productIds || [], categories = p.categories?.length ? p.categories : p.eligibleCategory ? [p.eligibleCategory] : [];
      if (brief.scope !== "all" && !["free_shipping", "tiered_product_gift"].includes(p.promotionType || "")
        && (brief.scope === "products" ? !targets.length || targets.some((id) => !brief.productIds?.includes(id))
          : !(categories.length && categories.every((category) => category === brief.category))
            && !(targets.length && targets.every((id) => context.products.some((product) => product.id === id && product.category === brief.category)))))
        return invalid("La promotion dépasse le périmètre demandé.");
      if (p.promotionType !== "tiered_product_gift" && categories.length && selected.some((product) => !categories.includes(product.category as "flowers" | "resins")))
        return invalid("Produits et catégories proposés sont incohérents.");
    }
    for (const config of [parameters.promotion, parameters.banner]) {
      if (!config) continue;
      if (!config.startsAt || !config.endsAt || Date.parse(config.endsAt) <= Date.parse(context.now))
        return invalid("Période proposée absente ou expirée.", "invalid_dates");
      if (brief.period && (config.startsAt !== brief.period.startsAt || config.endsAt !== brief.period.endsAt))
        return invalid("La période imposée n'a pas été respectée.", "invalid_dates");
    }
    const c = parameters.contest;
    if (c && (Date.parse(c.endAt) <= Date.parse(context.now)
      || (brief.period && (c.startAt !== brief.period.startsAt || c.endAt !== brief.period.endsAt))))
      return invalid("Période concours invalide.", "invalid_dates");
    if (kind === "campaign" && (parameters.promotion!.startsAt !== parameters.banner!.startsAt
      || parameters.promotion!.endsAt !== parameters.banner!.endsAt)) return invalid("Périodes de campagne incohérentes.", "invalid_dates");
    const publicCopy = [title, concept, rationale, parameters.promotion?.label, parameters.banner?.title, parameters.banner?.message,
      parameters.banner?.buttonLabel, c?.title, c?.description, c?.rulesText, c?.eligibilityConditions].filter(Boolean).join(" ");
    if (/\b(gu[ée]ri[rt]|soigne|th[ée]rapeutique|anti[- ]inflammatoire|traitement|garanti[^.]{0,30}conforme)\b/i.test(publicCopy))
      return invalid("La proposition contient une allégation interdite.", "ai_policy");
    return { id: "proposal-" + (index + 1), kind, title, concept, rationale, referencedProductIds: refs, parameters };
  });
}
