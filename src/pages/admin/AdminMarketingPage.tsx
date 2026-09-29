import { MarketingOverview } from "../../components/admin/marketing/MarketingOverview";
import { MarketingAiAssistant } from "../../components/admin/marketing/MarketingAiAssistant";
import type { MarketingAiGeneration, MarketingAiProposal } from "../../types/marketingAi";
import { bannerState, promotionState } from "../../lib/marketingBusinessStatus";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { AdminDialog } from "../../components/admin/AdminDialog";
import { AdminConfirmDialog } from "../../components/admin/AdminConfirmDialog";
import { MarketingTabs } from "../../components/admin/marketing/MarketingTabs";
import { MarketingPreview } from "../../components/admin/marketing/MarketingPreview";
import { ContestEditor } from "../../components/admin/marketing/ContestEditor";
import { CouponForm, PromoBannerForm } from "./AdminPage";
import AdminContestsPage from "./AdminContestsPage";
import type { Coupon, PromoBanner } from "../../types";
import type { Contest } from "../../types/contests";
import type { MarketingAction, MarketingAudit, MarketingContext, MarketingDraft, MarketingKind, MarketingOperation, MarketingParameters, MarketingReferences } from "../../types/marketing";
import { promotionFields, bannerFields, contestFields } from "../../lib/marketingConfiguration";
import { formatMarketingDate } from "../../lib/adminMarketingDates";
import { executeMarketing, forgetMarketingOperation, getMarketingContext, getMarketingDraftDetail, MarketingApiError, pendingMarketingOperation, rememberMarketingOperation } from "../../services/marketingService";

type Editor = { id: string; kind: MarketingKind; title: string; parameters: MarketingParameters; references: MarketingReferences; baseFingerprints: MarketingDraft["baseFingerprints"]; draft?: MarketingDraft; aiSource?: MarketingOperation["aiSource"]; dirty: boolean; touched: boolean; editing: boolean };
const kinds: Record<MarketingKind, string> = { promotion: "Promotion", banner: "Bannière", contest: "Concours", campaign: "Campagne promotion + bannière" };
const states = { draft: "Brouillon", reviewed: "Revu", approved: "Approuvé", materialized: "Objets préparés", activated: "Activation confirmée", archived: "Archivé" };
const actionTitles: Record<MarketingAction, string> = { save: "Enregistrer le brouillon privé", review: "Confirmer la revue", approve: "Approuver cette révision", materialize: "Préparer les objets métier", activate: "Activer cette révision", deactivate: "Désactiver les objets liés", archive: "Archiver" };
function configuration<T>(object: object, fields: readonly string[]): T {
  return Object.fromEntries(fields.filter((key) => (object as Record<string, unknown>)[key] !== undefined).map((key) => [key, (object as Record<string, unknown>)[key]])) as T;
}
function initialParameters(kind: MarketingKind): MarketingParameters {
  const start = Date.now() + 3600000; const end = start + 7 * 86400000;
  return {
    ...(["promotion", "campaign"].includes(kind) ? { promotion: { code: "", label: "", discountType: "percent" as const, discountValue: 10, minimumOrder: 0, autoApply: false, promotionType: "percentage_cart_discount" as const, stackable: false, priority: 10, productIds: [], categories: [], isArchived: false, isTemplate: false } } : {}),
    ...(["banner", "campaign"].includes(kind) ? { banner: { title: "", message: "", type: "shop_card" as const, placement: "draft" as const, placements: ["draft" as const], priority: 10, variant: "default" as const, dismissible: false, isArchived: false, isTemplate: false } } : {}),
    ...(kind === "contest" ? { contest: { title: "Verdanza Weekly", slug: "verdanza-weekly", description: "Participez gratuitement au tirage au sort Verdanza Weekly.", prizeValue: 30, prizeType: "store_credit" as const, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), drawAt: new Date(end + 3600000).toISOString(), rulesUrl: "", rulesText: "Participation gratuite et sans obligation d'achat. Une participation par personne et par adresse e-mail. Le gagnant est tiré au sort après la clôture puis validé par Verdanza.", eligibilityConditions: "Être majeur, résider en France métropolitaine et disposer d'une adresse e-mail valide.", prizeExpirationDays: 30 } } : {}),
  };
}
function draftEditor(draft: MarketingDraft): Editor { return { id: draft.id, kind: draft.kind, title: draft.title, parameters: draft.parameters, references: draft.references, baseFingerprints: draft.baseFingerprints, draft, dirty: false, touched: false, editing: false }; }

export default function AdminMarketingPage({ view = "overview" }: { view?: "overview" | "promotions" | "banners" | "contests" }) {
  const { user } = useAuth(); const uid = user?.uid || "";
  const [context, setContext] = useState<MarketingContext | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirm, setConfirm] = useState<{ operation: MarketingOperation; parameters: MarketingParameters; kind: MarketingKind } | null>(null);
  const [pending, setPending] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [recovery, setRecovery] = useState<MarketingOperation | null>(null); const [journalError, setJournalError] = useState("");
  const [audit, setAudit] = useState<{ id: string; rows: MarketingAudit[] } | null>(null);
  const generation = useRef(0);
  const invalidateRead = useCallback(() => { generation.current++; }, []);
  const refresh = useCallback(async () => {
    const version = ++generation.current; setLoading(true);
    try { const result = await getMarketingContext(); if (version === generation.current) { setContext(result); setError(""); return result; } }
    catch (cause) { if (version === generation.current) { setContext(null); setError(cause instanceof Error ? cause.message : "Marketing indisponible."); } }
    finally { if (version === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    setEditor(null); setConfirm(null); setContext(null); setJournalError("");
    try { setRecovery(pendingMarketingOperation(uid)); } catch (cause) { setJournalError(cause instanceof Error ? cause.message : "Journal indisponible."); }
    void refresh();
    return invalidateRead;
  }, [uid, refresh, invalidateRead]);

  const blocked = pending || Boolean(recovery) || Boolean(journalError) || !context;
  function create(kind: MarketingKind) {
    setEditor({ id: crypto.randomUUID(), kind, title: "", parameters: initialParameters(kind), references: {}, baseFingerprints: {}, dirty: true, touched: false, editing: true }); setShowCreate(false); setAudit(null); setError("");
  }
  function prepare(kind: "promotion" | "banner" | "contest", object: Coupon | PromoBanner | Contest) {
    if (!context || blocked) return;
    const key = kind === "promotion" ? "couponId" : kind === "banner" ? "bannerId" : "contestId";
    const parameters = kind === "promotion" ? { promotion: configuration<NonNullable<MarketingParameters["promotion"]>>(object, promotionFields) } : kind === "banner" ? { banner: configuration<NonNullable<MarketingParameters["banner"]>>(object, bannerFields) } : { contest: configuration<NonNullable<MarketingParameters["contest"]>>(object, contestFields) };
    const title = "label" in object ? object.label || object.code : object.title;
    setEditor({ id: crypto.randomUUID(), kind, title, parameters, references: { [key]: object.id }, baseFingerprints: { [key]: context.fingerprints[`${key}:${object.id}`] }, dirty: true, touched: false, editing: true }); setAudit(null); setError("");
  }
  function prepareAi(aiGeneration: MarketingAiGeneration, proposal: MarketingAiProposal) {
    if (blocked || editor) return;
    setEditor({ id: crypto.randomUUID(), kind: proposal.kind, title: proposal.title, parameters: structuredClone(proposal.parameters),
      aiSource: { generationId: aiGeneration.id, proposalId: proposal.id }, references: {}, baseFingerprints: {}, dirty: true, touched: false, editing: true });
    setAudit(null); setError("");
  }
  async function open(draft: MarketingDraft) {
    setEditor(draftEditor(draft)); setAudit(null);
    try { const detail = await getMarketingDraftDetail(draft.id); setAudit({ id: draft.id, rows: detail.audits }); setEditor((current) => current?.id === draft.id && !current.dirty ? draftEditor(detail.draft) : current); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Audit du brouillon indisponible."); }
  }
  function change(parameters: MarketingParameters) { setEditor((current) => current ? { ...current, parameters, dirty: true, touched: true } : null); }
  function request(action: MarketingAction) {
    if (!editor || blocked || (action !== "save" && (!editor.draft || editor.dirty))) return;
    const operation: MarketingOperation = { operationId: crypto.randomUUID(), draftId: editor.id, action, expectedRevision: editor.draft?.revision || 0,
      ...(action === "save" ? { kind: editor.kind, title: editor.title, parameters: editor.parameters, references: editor.references, baseFingerprints: editor.baseFingerprints, ...(editor.aiSource ? { aiSource: editor.aiSource } : {}) } : {}) };
    setConfirm({ operation: JSON.parse(JSON.stringify(operation)), parameters: JSON.parse(JSON.stringify(editor.parameters)), kind: editor.kind });
  }
  async function perform(operation: MarketingOperation) {
    setPending(true); setError("");
    try {
      rememberMarketingOperation(uid, operation);
      const result = await executeMarketing(operation);
      forgetMarketingOperation(uid, operation.operationId); setRecovery(null);
      setEditor(draftEditor(result.draft)); setConfirm(null); setAudit(null);
      setMessage(`${actionTitles[operation.action]} : ${result.replayed ? "résultat déjà appliqué retrouvé" : "confirmation enregistrée"}. Révision ${result.draft.revision}.`);
      const current = await refresh();
      const fresh = current?.drafts.find((draft) => draft.id === result.draft.id);
      if (fresh) setEditor(draftEditor(fresh));
    } catch (cause) {
      if (cause instanceof MarketingApiError && !cause.uncertain) { forgetMarketingOperation(uid, operation.operationId); setRecovery(null); }
      else { try { setRecovery(pendingMarketingOperation(uid)); } catch (journalCause) { setJournalError(journalCause instanceof Error ? journalCause.message : "Journal indisponible."); } }
      throw cause;
    } finally { setPending(false); }
  }
  function closeEditor() {
    if (pending) return;
    if (editor?.touched) { setDiscard(true); return; }
    setEditor(null); setConfirm(null);
  }
  function copyTemplate(kind: "promotion" | "banner", object: Coupon | PromoBanner) {
    const parameters = kind === "promotion" ? { promotion: { ...configuration<NonNullable<MarketingParameters["promotion"]>>(object, promotionFields), code: "", isTemplate: false, isArchived: false } } : { banner: { ...configuration<NonNullable<MarketingParameters["banner"]>>(object, bannerFields), isTemplate: false, isArchived: false } };
    setEditor({ id: crypto.randomUUID(), kind, title: "label" in object ? `${object.label} — copie` : `${object.title} — copie`, parameters, references: {}, baseFingerprints: {}, dirty: true, touched: false, editing: true }); setAudit(null);
  }
  const visibleDrafts = context?.drafts.filter((draft) => view === "overview" || draft.kind === "campaign" || draft.kind === (view === "promotions" ? "promotion" : view === "banners" ? "banner" : "contest")).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) || [];
  return <section className="grid min-w-0 grid-cols-1 gap-5">
    <header className="admin-card flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-widest text-champagne">Admin V3</p><h1 className="font-display text-4xl text-forest">Marketing</h1></div><button type="button" className="btn-secondary" disabled={pending || loading} onClick={() => void refresh()}>Rafraîchir</button></header>
    <MarketingTabs />
    {message && <p role="status" className="rounded-xl bg-cream p-3 text-sm text-forest">{message}</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {journalError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{journalError}</p>}
    {recovery && <aside className="grid gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm"><strong>Opération à vérifier : {actionTitles[recovery.action]}</strong><p>Résultat incertain. L'identifiant et les paramètres sont conservés pour retrouver le même résultat, y compris après rechargement.</p><code className="break-all">{recovery.operationId}</code><button className="btn-secondary w-fit" disabled={pending || Boolean(journalError)} onClick={() => void perform(recovery).catch((cause) => setError(cause instanceof Error ? cause.message : "Reprise impossible."))}>Rejouer l'opération conservée</button></aside>}
    {loading && <p role="status">Chargement du Marketing…</p>}
    {context && <>
      {view === "overview" && <MarketingOverview context={context} />}
      <div className="admin-card flex flex-wrap items-center gap-4"><button type="button" className="btn-primary" aria-expanded={showCreate} aria-controls="marketing-create-options" disabled={blocked} onClick={() => setShowCreate((value) => !value)}>Créer</button><a className="text-sm font-semibold text-forest underline decoration-champagne underline-offset-4" href="#marketing-ai-assistant">Assistant IA ↓</a>
        {showCreate && <div id="marketing-create-options" className="flex w-full flex-wrap gap-2 border-t border-forest/10 pt-3">{(["promotion", "banner", "contest", "campaign"] as MarketingKind[]).filter((kind) => view === "overview" || kind === "campaign" || (view === "promotions" && kind === "promotion") || (view === "banners" && kind === "banner") || (view === "contests" && kind === "contest")).map((kind) => <button key={kind} type="button" className="btn-secondary min-h-10 px-4 py-2" disabled={blocked} onClick={() => create(kind)}>Préparer {kinds[kind].toLowerCase()}</button>)}</div>}
      </div>
      {view === "promotions" && <BusinessList title="Promotions" items={context.coupons.filter((coupon) => coupon.source !== "contest")} render={(coupon) => <><strong>{coupon.label || coupon.code}</strong><p className="text-xs">{coupon.code} · {promotionState(coupon)} · utilisations {coupon.usedCount || 0}/{coupon.maxUses || "∞"}</p><p className="text-xs">{formatMarketingDate(coupon.startsAt)} → {formatMarketingDate(coupon.endsAt, "end")}</p><div className="mt-2 flex gap-2"><button className="btn-secondary min-h-9 px-3 py-1" disabled={blocked} onClick={() => prepare("promotion", coupon)}>Préparer une modification</button>{(coupon.isTemplate || coupon.isArchived) && <button className="btn-secondary min-h-9 px-3 py-1" disabled={blocked} onClick={() => copyTemplate("promotion", coupon)}>Copier en brouillon</button>}</div></>} />}
      {view === "banners" && <BusinessList title="Bannières" items={context.banners} render={(banner) => <><strong>{banner.title}</strong><p className="text-xs">{bannerState(banner, context.coupons)} · {(banner.placements || [banner.placement]).join(", ")}</p><p className="text-xs">{formatMarketingDate(banner.startsAt)} → {formatMarketingDate(banner.endsAt, "end")}</p><div className="mt-2 flex gap-2"><button className="btn-secondary min-h-9 px-3 py-1" disabled={blocked} onClick={() => prepare("banner", banner)}>Préparer une modification</button>{(banner.isTemplate || banner.isArchived) && <button className="btn-secondary min-h-9 px-3 py-1" disabled={blocked} onClick={() => copyTemplate("banner", banner)}>Copier en brouillon</button>}</div></>} />}
      {view === "contests" && <AdminContestsPage onPrepare={(contest) => contest ? prepare("contest", contest) : create("contest")} />}
      <section className="admin-card"><h2 className="font-display text-3xl text-forest">Brouillons</h2><div className="mt-4 grid gap-3">{visibleDrafts.map((draft) => <article key={draft.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-forest/10 p-3"><div><strong>{draft.title}</strong><p className="text-xs">{kinds[draft.kind]} · {states[draft.state]} · {formatMarketingDate(draft.updatedAt)}</p></div><button className="btn-secondary min-h-9 px-3 py-1" disabled={pending} onClick={() => void open(draft)}>Ouvrir le brouillon</button></article>)}{!visibleDrafts.length && <p className="text-sm text-ink/60">Aucun brouillon dans cette vue.</p>}</div></section>
      <MarketingAiAssistant uid={uid} context={context} blocked={blocked || Boolean(editor)} onPrepare={prepareAi} />
    </>}
    <AdminDialog open={Boolean(editor)} title={editor ? `${kinds[editor.kind]} — ${editor.draft ? `révision ${editor.draft.revision}` : "nouveau brouillon"}` : "Marketing"} size="xl" pending={pending} onClose={closeEditor} description="La sauvegarde reste privée. L'activation exige une validation et une confirmation séparées.">
      {!context && error && <div className="grid gap-3"><p role="alert" className="text-sm text-red-800">{error}</p><button className="btn-secondary" disabled={loading || pending} onClick={() => void refresh()}>Réessayer la lecture</button></div>}
      {editor && context && <div className="grid gap-5">
        {recovery && <aside role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p>Résultat incertain : cette opération doit être retrouvée avant de modifier le brouillon.</p><button className="btn-secondary mt-2" disabled={pending || Boolean(journalError)} onClick={() => void perform(recovery).catch((cause) => setError(cause instanceof Error ? cause.message : "Reprise impossible."))}>Rejouer l'opération conservée</button></aside>}
        {!!Object.values(editor.references).filter(Boolean).length && <p className="break-words text-xs text-ink/60">Objets liés : {Object.values(editor.references).filter(Boolean).join(" · ")}</p>}
        {editor.aiSource && <p className="text-sm text-ink/60">Proposition IA à revoir. Enregistrez-la pour créer son brouillon privé.</p>}
        {editor.draft && <div className="flex flex-wrap items-center gap-3"><strong>{states[editor.draft.state]}</strong><span className="text-sm">Origine : {editor.draft.origin} · {editor.draft.authorId}</span><button className="btn-secondary min-h-9 px-3 py-1" disabled={blocked || editor.draft.state === "archived"} onClick={() => setEditor({ ...editor, editing: true })}>Modifier le brouillon</button></div>}
        {editor.draft?.ai && <details className="text-xs text-ink/60"><summary>Provenance IA</summary><p>{editor.draft.ai.provider} · {editor.draft.ai.model} · {editor.draft.ai.promptVersion} · {formatMarketingDate(editor.draft.ai.generatedAt)}</p><p className="break-words">Génération : {editor.draft.ai.generationId} · {editor.draft.ai.proposalId}</p></details>}
        {editor.editing && <fieldset disabled={blocked} className="grid min-w-0 gap-4">
          <label className="text-sm font-semibold">Nom du brouillon<input className="input-field mt-1" value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value, dirty: true, touched: true })} /></label>
          {editor.parameters.promotion && !editor.references.couponId && <label className="text-sm">Identifiant Firestore optionnel<input className="input-field mt-1" value={editor.parameters.couponDocumentId || ""} onChange={(e) => change({ ...editor.parameters, couponDocumentId: e.target.value || undefined })} /></label>}
          {editor.kind === "campaign" && !editor.draft && !editor.aiSource && <label className="text-sm">Promotion de campagne<select className="input-field mt-1" value={editor.references.couponId || ""} onChange={(e) => { const coupon = context.coupons.find((item) => item.id === e.target.value); setEditor({ ...editor, parameters: { ...editor.parameters, promotion: coupon ? configuration(coupon, promotionFields) : initialParameters("promotion").promotion, couponDocumentId: undefined }, references: { ...editor.references, couponId: coupon?.id }, baseFingerprints: { ...editor.baseFingerprints, couponId: coupon ? context.fingerprints[`couponId:${coupon.id}`] : undefined }, dirty: true, touched: true }); }}><option value="">Créer une nouvelle promotion inactive</option>{context.coupons.filter((coupon) => coupon.source !== "contest").map((coupon) => <option key={coupon.id} value={coupon.id}>{coupon.label || coupon.code} ({coupon.id})</option>)}</select></label>}
          {editor.kind === "campaign" && !editor.draft && !editor.aiSource && <label className="text-sm">Bannière de campagne<select className="input-field mt-1" value={editor.references.bannerId || ""} onChange={(e) => { const banner = context.banners.find((item) => item.id === e.target.value); setEditor({ ...editor, parameters: { ...editor.parameters, banner: banner ? configuration(banner, bannerFields) : initialParameters("banner").banner }, references: { ...editor.references, bannerId: banner?.id }, baseFingerprints: { ...editor.baseFingerprints, bannerId: banner ? context.fingerprints[`bannerId:${banner.id}`] : undefined }, dirty: true, touched: true }); }}><option value="">Créer une nouvelle bannière inactive</option>{context.banners.map((banner) => <option key={banner.id} value={banner.id}>{banner.title} ({banner.id})</option>)}</select></label>}
          {editor.parameters.promotion && <CouponForm privateMode coupon={{ ...editor.parameters.promotion, id: editor.references.couponId, isActive: false, usedCount: context.coupons.find((coupon) => coupon.id === editor.references.couponId)?.usedCount || 0 }} products={context.products} banners={context.banners} bannerAction="none" bannerTargetId="" onBannerActionChange={() => {}} onBannerTargetIdChange={() => {}} onChange={(value) => change({ ...editor.parameters, promotion: configuration(value, promotionFields) })} onSubmit={(e) => { e.preventDefault(); request("save"); }} />}
          {editor.parameters.banner && <PromoBannerForm privateMode campaignMode={editor.kind === "campaign"} banner={{ ...editor.parameters.banner, id: editor.references.bannerId, isActive: false }} coupons={context.coupons.filter((coupon) => coupon.source !== "contest")} onChange={(value) => change({ ...editor.parameters, banner: configuration(value, bannerFields) })} onSubmit={(e) => { e.preventDefault(); request("save"); }} />}
          {editor.parameters.contest && <ContestEditor value={editor.parameters.contest} onChange={(contest) => change({ ...editor.parameters, contest })} onSubmit={(e) => { e.preventDefault(); request("save"); }} />}
          {(["promotion", "banner"] as const).filter((key) => editor.parameters[key]).map((key) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(editor.parameters[key]?.isTemplate)} onChange={(e) => change({ ...editor.parameters, [key]: { ...editor.parameters[key], isTemplate: e.target.checked } })} />Conserver {key === "promotion" ? "la promotion" : "la bannière"} comme modèle inactif</label>)}
          {(["promotion", "banner"] as const).filter((key) => editor.parameters[key]?.isArchived).map((key) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(editor.parameters[key]?.isArchived)} onChange={(e) => change({ ...editor.parameters, [key]: { ...editor.parameters[key], isArchived: e.target.checked } })} />{key === "promotion" ? "Promotion" : "Bannière"} archivée (décocher pour préparer une restauration)</label>)}
        </fieldset>}
        <MarketingPreview kind={editor.kind} parameters={editor.parameters} context={context} />
        {editor.dirty && <p className="text-sm text-amber-900">Modifications non enregistrées. La validation précédente ne permet aucune activation de cette version.</p>}
        {editor.draft && !editor.dirty && editor.draft.state !== "archived" && <div className="flex flex-wrap gap-2">
          {editor.draft.state === "draft" && <button className="btn-primary" disabled={blocked} onClick={() => request("review")}>Marquer comme revu</button>}
          {editor.draft.state === "reviewed" && <button className="btn-primary" disabled={blocked} onClick={() => request("approve")}>Approuver cette révision</button>}
          {editor.draft.state === "approved" && <button className="btn-primary" disabled={blocked} onClick={() => request("materialize")}>Préparer les objets métier</button>}
          {editor.draft.state === "materialized" && <button className="btn-primary" disabled={blocked} onClick={() => request("activate")}>Activer cette révision</button>}
          {editor.kind !== "contest" && (context.coupons.some((item) => item.id === editor.references.couponId && item.isActive) || context.banners.some((item) => item.id === editor.references.bannerId && item.isActive)) && <button className="btn-secondary" disabled={blocked} onClick={() => request("deactivate")}>Désactiver les objets liés</button>}
          <button className="btn-secondary" disabled={blocked} onClick={() => request("archive")}>Archiver</button>
          {editor.references.contestId && <Link className="btn-secondary" to="/admin/concours">Participants, tirage et gains</Link>}
        </div>}
        {editor.draft && <section className="text-sm"><h3 className="font-semibold">Audit Marketing</h3>{audit?.id === editor.id ? <ul className="mt-2 grid gap-1">{audit.rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((row) => <li key={row.id}>{row.action} · révision {row.revision} · {row.actorId} · {formatMarketingDate(row.createdAt)}{row.contestAuditCollection && " · détails métier dans l'audit concours"}</li>)}</ul> : <button className="btn-secondary mt-2 min-h-9 px-3 py-1" disabled={pending} onClick={() => void open(editor.draft!)}>Recharger le brouillon et l'audit</button>}</section>}
      </div>}
    </AdminDialog>
    <AdminConfirmDialog open={discard} title="Abandonner les modifications privées ?" description="La saisie locale n'a pas été enregistrée. Les brouillons déjà sauvegardés et les opérations à vérifier restent conservés." confirmLabel="Abandonner la saisie" onCancel={() => setDiscard(false)} onConfirm={() => { setEditor(null); setConfirm(null); setDiscard(false); }} />
    <AdminConfirmDialog open={Boolean(confirm)} title={confirm ? actionTitles[confirm.operation.action] : "Confirmer"} pending={pending} onCancel={() => setConfirm(null)} onConfirm={() => confirm ? perform(confirm.operation) : undefined} confirmLabel={confirm?.operation.action === "activate" ? "Confirmer et activer" : "Confirmer cette étape"}
      description={confirm ? `Brouillon ${confirm.operation.draftId} · révision ${confirm.operation.expectedRevision}${confirm.operation.action === "save" ? " → nouvelle révision" : ""}` : ""}
      warning={confirm?.operation.action === "activate" ? "Cette confirmation modifie les objets utilisés par la boutique. Une campagne active ses deux objets dans une transaction commune ; une période future reste programmée." : confirm?.operation.action === "materialize" ? "Les nouveaux objets seront inactifs. Les objets existants garderont leur configuration jusqu'à la confirmation d'activation." : confirm?.operation.action === "save" ? "Enregistrement privé uniquement ; aucune publication, aucun tirage, aucune récompense, aucun email." : undefined}
      summary={confirm && context ? <MarketingPreview kind={confirm.kind} parameters={confirm.parameters} context={context} /> : undefined} />
  </section>;
}

function BusinessList<T extends { id: string }>({ title, items, render }: { title: string; items: T[]; render: (item: T) => React.ReactNode }) {
  return <section className="admin-card"><h2 className="font-display text-3xl text-forest">{title}</h2><div className="mt-4 grid gap-3 lg:grid-cols-2">{items.map((item) => <article key={item.id} className="rounded-xl border border-forest/10 p-3 text-sm">{render(item)}</article>)}{!items.length && <p className="text-sm text-ink/60">Aucun objet métier.</p>}</div></section>;
}
