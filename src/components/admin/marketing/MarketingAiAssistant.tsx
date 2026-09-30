import { useCallback, useEffect, useRef, useState } from "react";
import { AdminDialog } from "../AdminDialog";
import { MarketingPreview } from "./MarketingPreview";
import { formatMarketingDate, marketingLocalToIso } from "../../../lib/adminMarketingDates";
import type { MarketingContext } from "../../../types/marketing";
import type { MarketingAiBrief, MarketingAiGeneration, MarketingAiProposal, MarketingAiRequest } from "../../../types/marketingAi";
import { forgetMarketingAi, generateMarketingAi, getMarketingAiGeneration, getMarketingAiStatus, marketingAiHistory,
  MarketingAiApiError, pendingMarketingAi, rememberMarketingAi, rememberMarketingAiHistory } from "../../../services/marketingAiService";

const kinds = { free: "Proposition libre", promotion: "Promotion", banner: "Bannière", contest: "Concours", campaign: "Campagne promotion + bannière" };
const categories = { flowers: "Fleurs", resins: "Résines", oils: "Huiles", packs: "Packs" };
const tones = { discovery: "Découverte", new: "Nouveauté", loyalty: "Fidélisation", clearance: "Déstockage", event: "Événement", other: "Autre brief libre" };
const mechanics = { fixed_cart_discount: "Montant fixe panier", fixed_category_discount: "Montant fixe catégorie", threshold_extra_discount: "Offert après seuil", percentage_cart_discount: "Pourcentage panier", percentage_category_discount: "Pourcentage catégorie", free_shipping: "Livraison offerte", tiered_product_gift: "Cadeau produit par paliers" };
const initialBrief: MarketingAiBrief = { objective: "", kind: "free", scope: "all", count: 3, tone: "discovery" };
export function MarketingAiAssistant({ uid, context, blocked, onPrepare }: {
  uid: string; context: MarketingContext; blocked: boolean;
  onPrepare: (generation: MarketingAiGeneration, proposal: MarketingAiProposal) => void;
}) {
  const [brief, setBrief] = useState<MarketingAiBrief>(initialBrief);
  const [fixedPeriod, setFixedPeriod] = useState(false); const [start, setStart] = useState(""); const [end, setEnd] = useState("");
  const [ready, setReady] = useState(false); const [loading, setLoading] = useState(true); const [pending, setPending] = useState(false);
  const [aiState, setAiState] = useState<"loading" | "disabled" | "missing_configuration" | "ready" | "error">("loading");
  const [recovery, setRecovery] = useState<MarketingAiRequest | null>(null);
  const [error, setError] = useState(""); const [journalError, setJournalError] = useState("");
  const [generations, setGenerations] = useState<MarketingAiGeneration[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]); const [preview, setPreview] = useState<MarketingAiProposal | null>(null);
  const version = useRef(0), busy = useRef(false);
  const invalidate = useCallback(() => { version.current++; }, []);
  useEffect(() => {
    const current = ++version.current; busy.current = false;
    setGenerations([]); setIgnored([]); setPreview(null); setReady(false); setAiState("loading"); setLoading(true); setPending(false);
    setRecovery(null); setError(""); setJournalError(""); setBrief(initialBrief);
    let ids: string[] = [];
    try { setRecovery(pendingMarketingAi(uid)); ids = marketingAiHistory(uid); }
    catch (cause) { setJournalError(cause instanceof Error ? cause.message : "Journal IA indisponible."); }
    void (async () => {
      const [status, ...history] = await Promise.allSettled([getMarketingAiStatus(), ...ids.map(getMarketingAiGeneration)]);
      if (current !== version.current) return;
      if (status.status === "fulfilled") { setReady(status.value.configured); setAiState(status.value.state); }
      else { setAiState("error"); setError(status.reason instanceof Error ? status.reason.message : "Assistant IA indisponible."); }
      setGenerations(history.flatMap((item) => item.status === "fulfilled" ? [item.value as MarketingAiGeneration] : []));
      if (history.some((item) => item.status === "rejected")) setError("Une génération conservée ne peut pas être relue pour le moment. Réessayez en rechargeant.");
      setLoading(false);
    })();
    return invalidate;
  }, [uid, invalidate]);
  const disabled = blocked || pending || loading || Boolean(journalError);
  async function perform(request: MarketingAiRequest) {
    if (busy.current || blocked || journalError) return;
    busy.current = true; const current = version.current; setPending(true); setError("");
    try {
      rememberMarketingAi(uid, request);
      const result = await generateMarketingAi(request);
      rememberMarketingAiHistory(uid, result.id); forgetMarketingAi(uid, result.id);
      if (current !== version.current) return;
      setRecovery(null); setGenerations((old) => [...old.filter((g) => g.id !== result.id), result]);
    } catch (cause) {
      try { if (cause instanceof MarketingAiApiError && !cause.uncertain) forgetMarketingAi(uid, request.generationId); }
      catch (journalCause) { if (current === version.current) setJournalError(journalCause instanceof Error ? journalCause.message : "Journal IA indisponible."); }
      if (current !== version.current) return;
      try { setRecovery(pendingMarketingAi(uid)); }
      catch (journalCause) { setJournalError(journalCause instanceof Error ? journalCause.message : "Journal IA indisponible."); }
      setError(cause instanceof Error ? cause.message : "Génération impossible.");
    } finally { if (current === version.current) { busy.current = false; setPending(false); } }
  }
  function generate() {
    if (disabled || recovery || !ready) return;
    const data: MarketingAiBrief = { ...brief, ...(fixedPeriod ? { period: { startsAt: marketingLocalToIso(start), endsAt: marketingLocalToIso(end) } } : {}) };
    void perform({ generationId: crypto.randomUUID(), brief: data });
  }
  return <section id="marketing-ai-assistant" aria-label="Assistant IA" className="admin-card grid min-w-0 grid-cols-1 gap-4">
    <div><h2 className="font-display text-3xl text-forest">Assistant IA</h2><p className="mt-1 text-sm text-ink/60">Des propositions privées à revoir avant toute activation.</p></div>
    {loading ? <p role="status">Vérification de l’Assistant IA…</p> : !ready && <p role="status" className="rounded-xl bg-cream p-3 text-sm">{aiState === "disabled" ? "Assistant IA désactivé. L’intégration est prête mais n’est pas encore activée sur le serveur." : aiState === "missing_configuration" ? "Assistant IA désactivé. La configuration du serveur est incomplète." : "Assistant IA indisponible. Les outils Marketing manuels restent disponibles."}</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {journalError && <p role="alert" className="text-sm text-red-800">{journalError}</p>}
    {recovery && <aside className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p>Génération à vérifier : la demande est conservée. La reprise retrouve le même résultat sans nouvel appel automatique.</p><button type="button" className="btn-secondary mt-2" disabled={disabled} onClick={() => void perform(recovery)}>Reprendre la génération conservée</button></aside>}
    {ready && <form onSubmit={(e) => { e.preventDefault(); generate(); }}>
      <fieldset disabled={disabled || Boolean(recovery) || !ready} className="grid min-w-0 gap-4 md:grid-cols-2">
        <label className="text-sm font-semibold md:col-span-2">Objectif<textarea aria-label="Objectif" required maxLength={2000} className="input-field mt-1 min-h-24" placeholder="Mettre en avant les résines cette semaine" value={brief.objective} onChange={(e) => setBrief({ ...brief, objective: e.target.value })} /><span className="text-xs font-normal text-ink/60">Décrivez l’idée sans coordonnées ni informations client.</span></label>
        <label className="text-sm font-semibold">Type de proposition<select aria-label="Type de proposition" className="input-field mt-1" value={brief.kind} onChange={(e) => setBrief({ ...brief, kind: e.target.value as MarketingAiBrief["kind"] })}>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <details className="md:col-span-2 rounded-xl border border-forest/15 p-3"><summary className="cursor-pointer font-semibold text-forest">Options avancées</summary><div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
        <label className="text-sm font-semibold">Ton / objectif<select aria-label="Ton / objectif" className="input-field mt-1" value={brief.tone} onChange={(e) => setBrief({ ...brief, tone: e.target.value as MarketingAiBrief["tone"] })}>{Object.entries(tones).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-sm font-semibold">Périmètre produits<select aria-label="Périmètre produits" className="input-field mt-1" value={brief.scope} onChange={(e) => setBrief({ ...brief, scope: e.target.value as MarketingAiBrief["scope"], category: "resins", productIds: [] })}><option value="all">Toute la sélection disponible</option><option value="category">Catégorie</option><option value="products">Produits choisis</option></select></label>
        {brief.scope === "category" && <label className="text-sm font-semibold">Catégorie<select aria-label="Catégorie" className="input-field mt-1" value={brief.category || "resins"} onChange={(e) => setBrief({ ...brief, category: e.target.value as MarketingAiBrief["category"] })}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
        {brief.scope === "products" && <label className="text-sm font-semibold">Produits choisis (30 maximum)<select aria-label="Produits choisis (30 maximum)" multiple required className="input-field mt-1 min-h-28" value={brief.productIds || []} onChange={(e) => setBrief({ ...brief, productIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}>{context.products.filter((p) => p.isActive && p.stock > 0).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <label className="text-sm font-semibold">Période<select aria-label="Période" className="input-field mt-1" value={fixedPeriod ? "fixed" : "suggested"} onChange={(e) => setFixedPeriod(e.target.value === "fixed")}><option value="suggested">Dates proposées par l’IA</option><option value="fixed">Période imposée</option></select></label>
        {fixedPeriod && <><label className="text-sm font-semibold">Début imposé (Europe/Paris)<input required type="datetime-local" className="input-field mt-1" value={start} onChange={(e) => setStart(e.target.value)} /></label><label className="text-sm font-semibold">Fin imposée (Europe/Paris)<input required type="datetime-local" className="input-field mt-1" value={end} onChange={(e) => setEnd(e.target.value)} /></label></>}
        <label className="text-sm font-semibold">Nombre de propositions<select aria-label="Nombre de propositions" className="input-field mt-1" value={brief.count} onChange={(e) => setBrief({ ...brief, count: Number(e.target.value) })}>{[1, 2, 3].map((n) => <option key={n}>{n}</option>)}</select></label>
        </div></details>
        <div className="md:col-span-2"><button type="submit" className="btn-primary">{pending ? "Génération en cours…" : generations.length ? "Générer de nouvelles propositions" : "Générer des propositions"}</button><p className="mt-2 text-xs text-ink/60">Jusqu’à 3 propositions par demande, 6 générations par heure. Les propositions précédentes restent conservées.</p></div>
      </fieldset>
    </form>}
    {generations.map((generation) => <div key={generation.id} className="grid gap-3"><p className="text-xs text-ink/60">Génération du {formatMarketingDate(generation.createdAt)} · {generation.proposals.length} proposition(s)</p><div className="grid gap-3 lg:grid-cols-3">{generation.proposals.map((proposal) => {
      const id = generation.id + ":" + proposal.id;
      const draft = context.drafts.find((d) => d.ai?.generationId === generation.id && d.ai.proposalId === proposal.id);
      return <article key={id} aria-label={proposal.title} className="grid content-start gap-3 rounded-xl border border-forest/15 p-4 text-sm">
        <h3 className="font-semibold text-forest">{proposal.title}</h3><p>{proposal.concept}</p>
        {ignored.includes(id) ? <><p>Proposition ignorée, conservée dans l’historique.</p><button type="button" className="btn-secondary" onClick={() => setIgnored((old) => old.filter((key) => key !== id))}>Restaurer la proposition</button></> : <>
          <ProposalSummary proposal={proposal} context={context} /><p className="text-ink/60">Pourquoi : {proposal.rationale}</p>
          {draft && <p role="status">Brouillon créé : {draft.title}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary min-h-9 px-3 py-1" onClick={() => setIgnored((old) => [...old, id])}>Ignorer</button>
            <button type="button" className="btn-secondary min-h-9 px-3 py-1" disabled={disabled || Boolean(draft)} onClick={() => onPrepare(generation, proposal)}>Modifier</button>
            <button type="button" className="btn-secondary min-h-9 px-3 py-1" disabled={blocked} onClick={() => setPreview(proposal)}>Prévisualiser</button>
            <button type="button" className="btn-primary min-h-9 px-3 py-1" disabled={disabled || Boolean(draft)} onClick={() => onPrepare(generation, proposal)}>Créer le brouillon</button>
          </div>
        </>}
      </article>;
    })}</div></div>)}
    <AdminDialog open={Boolean(preview)} title="Proposition IA — aperçu privé" size="xl" onClose={() => setPreview(null)}>{preview && <MarketingPreview kind={preview.kind} parameters={preview.parameters} context={context} />}</AdminDialog>
  </section>;
}
function ProposalSummary({ proposal, context }: { proposal: MarketingAiProposal; context: MarketingContext }) {
  const { promotion: p, banner: b, contest: c } = proposal.parameters;
  return <div className="grid gap-2">
    <p>{kinds[proposal.kind]}</p><p>{b?.message || c?.description || p?.label}</p>
    <p>Produits : {proposal.referencedProductIds.map((id) => context.products.find((product) => product.id === id)?.name || id).join(", ") || "Aucun produit ciblé"}</p>
    {p && <p>Mécanique : {p.promotionType ? mechanics[p.promotionType] : "Promotion"} · {p.promotionType === "tiered_product_gift" ? p.giftTiers?.map((tier) => `${tier.minimumSubtotal} € → ${tier.quantityGrams} g`).join(" ; ") : p.discountType === "free_shipping" ? "port offert" : `${p.discountValue}${p.discountType === "percent" ? " %" : " €"}`} · minimum {p.minimumOrder} € · {p.autoApply ? "automatique" : `code ${p.code}`}</p>}
    {b?.buttonLabel && <p>CTA : {b.buttonLabel} → {b.buttonUrl}</p>}
    <p>{formatMarketingDate(p?.startsAt || b?.startsAt || c?.startAt)} → {formatMarketingDate(p?.endsAt || b?.endsAt || c?.endAt, "end")}</p>
  </div>;
}
