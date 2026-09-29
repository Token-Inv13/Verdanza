import { useCallback, useEffect, useRef, useState } from "react";
import { AdminConfirmDialog } from "../AdminConfirmDialog";
import { compareCatalogue, costSourceLabels, recommendPrice } from "../../../lib/selectionPricing";
import { costSources, emptyCommercial, type EconomicFormat, type PipelineContext, type PricingPolicy } from "../../../types/selectionPipeline";
import type { ProductSelection } from "../../../types/selection";
import { getSelectionPipeline, saveSelectionPricingPolicy } from "../../../services/selectionService";

const number = (v: string) => v.trim() && Number.isFinite(Number(v.replace(",", "."))) ? Number(v.replace(",", ".")) : null;
const euro = (v: number | null) => v === null ? "Indisponible" : `${v.toFixed(2)} €`;
const rate = (v: number | null) => v === null ? "Indisponible" : `${(v * 100).toFixed(1)} %`;
export function SelectionPricing({ item, onChange }: { item: ProductSelection; onChange: (item: ProductSelection) => void }) {
  const [context, setContext] = useState<PipelineContext | null>(null);
  const [policyFields, setPolicyFields] = useState<Record<string, string>>({});
  const [contextState, setContextState] = useState<"loading" | "ready" | "error">("loading");
  const [policyConfirm, setPolicyConfirm] = useState<{ policy: PricingPolicy; operationId: string } | null>(null);
  const [policyError, setPolicyError] = useState("");
  const contextVersion = useRef(0);
  const invalidateContext = useCallback(() => { contextVersion.current++; }, []);
  const category = item.category === "Fleur" ? "flowers" : item.category === "Résine" ? "resins" : null;
  const positioning = item.commercial?.positioning || "standard";
  const loadContext = useCallback(async () => {
    const version = ++contextVersion.current;
    setContext(null); setPolicyFields({}); setContextState("loading");
    if (!item.id || !category) { setContextState("ready"); return; }
    try {
      const value = await getSelectionPipeline(item.id, { category, positioning });
      if (version !== contextVersion.current) return;
      setContext(value);
      setPolicyFields(value.policy ? Object.fromEntries(Object.entries(value.policy).map(([key, value]) => [key, String(value)])) : {});
      setContextState("ready");
    } catch {
      if (version === contextVersion.current) setContextState("error");
    }
  }, [item.id, category, positioning]);
  useEffect(() => { void loadContext(); return invalidateContext; }, [loadContext, item.revision, invalidateContext]);
  const c = item.commercial || emptyCommercial();
  const policy = item.category !== "Autre" && context?.policy?.category === category && context.policy.positioning === c.positioning ? context.policy : null;
  const rows = item.economics || [];
  const change = (index: number, patch: Partial<EconomicFormat>) => onChange({ ...item, economics: rows.map((r, i) => i === index ? { ...r, ...patch } : r) });
  const commercial = (patch: Partial<typeof c>) => onChange({ ...item, commercial: { ...c, ...patch } });
  return <section className="space-y-4 rounded-xl border border-forest/15 bg-cream p-4 sm:col-span-2" aria-label="Prix conseillé Verdanza">
    <h3 className="font-display text-2xl">Prix conseillé Verdanza</h3>
    {contextState === "error" && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Contexte de prix indisponible. Les coûts et la politique enregistrés ne peuvent pas être vérifiés. <button type="button" className="font-semibold underline" onClick={() => void loadContext()}>Recharger le contexte de prix</button></div>}
    <p className="text-xs leading-5">Coûts et recommandations privés. Le prix final reste votre décision. Aucune valeur fiscale ou marge cible n’est ajoutée automatiquement.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold">Positionnement<select className="input-field mt-1 w-full" value={c.positioning} onChange={(e) => commercial({ positioning: e.target.value as typeof c.positioning })}><option value="standard">Standard</option><option value="premium">Premium</option></select></label>
      <label className="text-xs font-semibold">Prix final par gramme (€)<input className="input-field mt-1 w-full" inputMode="decimal" value={c.pricePerGram ?? ""} onChange={(e) => commercial({ pricePerGram: number(e.target.value) })} /></label>
      <label className="text-xs font-semibold">Stock initial proposé (g)<input className="input-field mt-1 w-full" type="number" min="0" step="1" disabled={Boolean(item.catalogProductId)} value={c.initialStock ?? ""} onChange={(e) => commercial({ initialStock: number(e.target.value) })} />{item.catalogProductId && <span className="mt-1 block font-normal">Produit existant : corrections dans <a className="underline" href="/admin/stocks">Stock</a>.</span>}</label>
    </div>
    {rows.map((row, index) => {
      const advice = recommendPrice(row, policy);
      const comparison = compareCatalogue(row, category || "unknown", c.positioning, context?.catalogue || { available: false, products: [] });
      return <fieldset key={row.id} className="space-y-3 rounded-lg border border-forest/10 bg-ivory p-3">
        <legend className="px-1 text-sm font-semibold">{row.label || `Format ${index + 1}`}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs">Format<input className="input-field mt-1 w-full" value={row.label} onChange={(e) => change(index, { label: e.target.value })} /></label>
          <label className="text-xs">Quantité explicitement confirmée (g)<input className="input-field mt-1 w-full" inputMode="decimal" value={row.quantity ?? ""} onChange={(e) => change(index, { quantity: number(e.target.value), unit: e.target.value ? "g" : "" })} /></label>
          <label className="text-xs">Coût du format (€)<input className="input-field mt-1 w-full" inputMode="decimal" value={row.cost ?? ""} onChange={(e) => change(index, { cost: number(e.target.value) })} /></label>
          <label className="text-xs">Source du coût<select className="input-field mt-1 w-full" value={row.costSource} onChange={(e) => change(index, { costSource: e.target.value as EconomicFormat["costSource"] })}>{costSources.map((s) => <option key={s} value={s}>{costSourceLabels[s]}</option>)}</select></label>
          <label className="text-xs">Base du coût<select className="input-field mt-1 w-full" value={row.costBasis} onChange={(e) => change(index, { costBasis: e.target.value as EconomicFormat["costBasis"] })}><option value="">À confirmer</option><option>HT</option><option>TTC</option></select></label>
          <label className="text-xs">Date de la source<input className="input-field mt-1 w-full" type="date" value={row.capturedAt.slice(0, 10)} onChange={(e) => change(index, { capturedAt: e.target.value })} /></label>
          <label className="text-xs sm:col-span-3">Preuve / référence du coût<input className="input-field mt-1 w-full" value={row.evidence} onChange={(e) => change(index, { evidence: e.target.value })} /></label>
        </div>
        <p className="text-xs">Prix conseillé : <strong>{euro(advice.recommended)}</strong> · Confiance : {advice.confidence === "qualified" ? "source qualifiée" : advice.confidence === "limited" ? "limitée, coût manuel" : "indisponible"}</p>
        <p className="text-xs">Marge brute : {euro(advice.grossMargin)} · Contribution estimée : {euro(advice.contribution)} · Taux de marque : {rate(advice.markRate)} · Taux de marge : {rate(advice.marginRate)}</p>
        <p className="text-xs text-ink/65">{advice.explanation}</p>
        <p className="text-xs">{comparison.explanation}{comparison.pricesPerGram.length > 0 && ` ${Math.min(...comparison.pricesPerGram).toFixed(2)}–${Math.max(...comparison.pricesPerGram).toFixed(2)} €/g.`}</p>
        <label className="block text-xs font-semibold">Prix final admin du format (€)<input className="input-field ml-2 w-28" inputMode="decimal" value={row.finalPrice ?? ""} onChange={(e) => change(index, { finalPrice: number(e.target.value) })} /></label>
        <div className="flex flex-wrap gap-3 text-xs"><button type="button" className="underline" disabled={advice.recommended === null} onClick={() => change(index, { finalPrice: advice.recommended })}>Retenir le prix conseillé</button><button type="button" className="underline" onClick={() => onChange({ ...item, economics: rows.filter((_, i) => i !== index) })}>Retirer ce format</button></div>
        {context?.costs.filter((r) => r.quantity === row.quantity).map((candidate) => <button key={candidate.id} type="button" className="mr-3 text-xs underline" onClick={() => change(index, { ...candidate, id: row.id, finalPrice: row.finalPrice })}>Utiliser {costSourceLabels[candidate.costSource].toLowerCase()} : {euro(candidate.cost)} {candidate.costBasis} ({candidate.capturedAt})</button>)}
      </fieldset>;
    })}
    <button type="button" className="text-xs underline" onClick={() => onChange({ ...item, economics: [...rows, { id: crypto.randomUUID(), label: "", quantity: null, unit: "", cost: null, costBasis: "", costSource: "manual", evidence: "", capturedAt: "", finalPrice: null }] })}>Ajouter un format économique</button>
    <details className="border-t border-forest/10 pt-3"><summary className="cursor-pointer text-sm font-semibold">Politique de prix privée : {policy ? "configurée" : "à configurer"}</summary>
      <p className="my-3 text-xs">Taux décimaux : 0,40 = 40 %. La cible porte sur la contribution après frais variables et avant charges fixes, rapportée au prix dans la base économique. Le taux de marque brut est affiché séparément. Conditionnement par format, dans la même base que le coût. Une base TTC ne devient pas HT automatiquement.</p>
      <div className="grid gap-3 sm:grid-cols-2">{[["targetContributionRate", "Taux de contribution cible"], ["variableRate", "Taux de coûts variables"], ["packagingCost", "Conditionnement (€ / format)"], ["lossRate", "Taux de pertes"], ["taxRate", "Taux fiscal applicable"], ["roundingIncrement", "Pas d’arrondi (€)"]].map(([key, label]) => <label key={key} className="text-xs">{label}<input className="input-field mt-1 w-full" value={policyFields[key] || ""} onChange={(e) => setPolicyFields({ ...policyFields, [key]: e.target.value })} /></label>)}
        {[["costBasis", "Base économique", ["HT", "TTC"]], ["sellingBasis", "Base de vente", ["HT", "TTC"]], ["roundingMode", "Arrondi", ["up", "nearest"]]].map(([key, label, values]) => <label key={String(key)} className="text-xs">{label}<select className="input-field mt-1 w-full" value={policyFields[String(key)] || ""} onChange={(e) => setPolicyFields({ ...policyFields, [String(key)]: e.target.value })}><option value="">À définir</option>{(values as string[]).map((v) => <option key={v} value={v}>{v === "up" ? "Supérieur" : v === "nearest" ? "Plus proche" : v}</option>)}</select></label>)}
      </div>
      <button type="button" className="btn-secondary mt-3" disabled={item.category === "Autre" || (Boolean(item.id) && contextState !== "ready")} onClick={() => { const p = { ...policyFields, schemaVersion: 1, category, positioning: c.positioning, ...Object.fromEntries(["targetContributionRate", "variableRate", "packagingCost", "lossRate", "taxRate", "roundingIncrement"].map((k) => [k, number(policyFields[k] || "")])) }; setPolicyError(""); setPolicyConfirm({ policy: p as unknown as PricingPolicy, operationId: crypto.randomUUID() }); }}>Vérifier la politique</button>
    </details>
    <AdminConfirmDialog open={Boolean(policyConfirm)} title="Confirmer la politique de prix privée" summary={policyConfirm && <div className="space-y-2"><p>{policyConfirm.policy.category === "flowers" ? "Fleurs" : "Résines"} · {policyConfirm.policy.positioning === "premium" ? "Premium" : "Standard"}</p><p>Contribution cible après frais variables : {rate(policyConfirm.policy.targetContributionRate)} · Frais variables : {rate(policyConfirm.policy.variableRate)}</p><p>Conditionnement : {euro(policyConfirm.policy.packagingCost)} / format · Pertes : {rate(policyConfirm.policy.lossRate)}</p><p>Coût : {policyConfirm.policy.costBasis || "à définir"} · Vente : {policyConfirm.policy.sellingBasis || "à définir"} · Fiscalité configurée : {rate(policyConfirm.policy.taxRate)}</p><p>Arrondi : {euro(policyConfirm.policy.roundingIncrement)}, {policyConfirm.policy.roundingMode === "up" ? "supérieur" : policyConfirm.policy.roundingMode === "nearest" ? "au plus proche" : "à définir"}</p></div>} warning="Cette politique s’applique à la catégorie et au positionnement indiqués. Elle ne change aucun prix final ni aucun produit public." error={policyError} onCancel={() => setPolicyConfirm(null)} onConfirm={async () => {
      if (!policyConfirm) return;
      if (item.id && contextState !== "ready") { setPolicyError("Contexte de prix indisponible. Rechargez-le avant d'enregistrer la politique."); return; }
      try { const result = await saveSelectionPricingPolicy(policyConfirm.policy, policy, policyConfirm.operationId); setContext((v) => ({ ...(v || { workflow: {} as PipelineContext["workflow"], product: null, costs: [], catalogue: { available: false, products: [], complete: false } }), policy: result.policy })); setPolicyConfirm(null); } catch (error) { setPolicyError(error instanceof Error ? error.message : "Politique indisponible."); throw error; }
    }} />
  </section>;
}
