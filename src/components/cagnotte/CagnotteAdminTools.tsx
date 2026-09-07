import React, { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  CagnotteAdminRequestError,
  inspectCagnotteOrder,
  previewOrderRefund,
  previewRefundCorrection,
  recordOrderRefund,
  recordRefundCorrection,
  recordUnpaidReview,
} from "../../services/cagnotteAdminService";
import type { CagnotteAdminInspection, CorrectionPreview, RefundPreview } from "../../types/cagnotteAdmin";
import { updateOrderAdminFields } from "../../services/ordersService";
import { createCagnotteAdminRefreshChannel, createCagnotteAdminResponseIdentity, eurosInputToCents, refreshCagnotteAdminAfterWrite, runCagnotteAdminLocked } from "../../lib/cagnotteAdminController";
import { cagnotteRefundDateTimeLocalToIso, cagnotteRefundDateTimeLocalValue } from "../../lib/cagnotteAdminDate";
import { paymentStatusLabel } from "../../utils/orderStatus";

type Mode = "refund" | "correction" | "unpaid";
export type CagnotteAdminViewModel = {
  phase: "loading" | "ready" | "error";
  inspection: CagnotteAdminInspection | null;
  mode: Mode;
  refundPreview: RefundPreview | null;
  correctionPreview: CorrectionPreview | null;
  notice: string;
  uncertain: boolean;
};

type Form = {
  lines: Record<string, string>;
  delivery: string;
  source: "admin" | "provider_reference";
  reference: string;
  confirmedAt: string;
  reason: "product_return" | "order_cancellation" | "delivery_refund";
  declaredFinancial: string;
  correctionReason: string;
  correctionReference: string;
  reviewOutcome: "unpaid_confirmed" | "payment_uncertain";
  reviewSource: string;
  reviewReason: string;
  externalVerificationConfirmed: boolean;
};

const adminRefreshChannel = createCagnotteAdminRefreshChannel();

export function CagnotteAdminTools({ orderId, enabled, onOrderReload }: {
  orderId: string;
  enabled: boolean;
  onOrderReload?: () => Promise<void> | void;
}) {
  const [model, setModel] = useState<CagnotteAdminViewModel>({ phase: "loading", inspection: null, mode: "refund", refundPreview: null, correctionPreview: null, notice: "", uncertain: false });
  const [form, setForm] = useState<Form>(() => emptyForm());
  const identity = useRef(createCagnotteAdminResponseIdentity()).current;
  const submitting = useRef(false);
  const pendingRefund = useRef<Parameters<typeof recordOrderRefund>[0] | null>(null);
  const pendingCorrection = useRef<Parameters<typeof recordRefundCorrection>[0] | null>(null);
  const peerRefresh = useRef<(() => void) | null>(null);

  const reload = async (successNotice = "") => {
    const current = identity.next();
    setModel((value) => ({ ...value, phase: "loading", refundPreview: null, correctionPreview: null, notice: "", uncertain: false }));
    const controller = new AbortController();
    try {
      const inspection = await inspectCagnotteOrder(orderId, controller.signal);
      if (!identity.isCurrent(current)) return;
      setModel((value) => ({ ...value, phase: "ready", inspection, refundPreview: null, correctionPreview: null, notice: successNotice, uncertain: false }));
      setForm(emptyForm(inspection));
      pendingRefund.current = null;
      pendingCorrection.current = null;
    } catch (error) {
      if (!identity.isCurrent(current)) return;
      setModel((value) => ({ ...value, phase: "error", notice: message(error), uncertain: false }));
    }
  };
  useEffect(() => {
    if (!enabled) return;
    const listener = () => { void reload(); };
    peerRefresh.current = listener;
    const unsubscribe = adminRefreshChannel.subscribe(orderId, listener);
    void reload();
    return () => {
      unsubscribe();
      if (peerRefresh.current === listener) peerRefresh.current = null;
      identity.invalidate();
    };
  // The order identity is the security boundary for stale responses.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, orderId]);

  const update = (patch: Partial<Form>) => {
    pendingRefund.current = null;
    pendingCorrection.current = null;
    setForm((value) => ({ ...value, ...patch }));
    setModel((value) => ({ ...value, refundPreview: null, correctionPreview: null, notice: "", uncertain: false }));
  };
  const returns = useMemo(() => formReturns(form.lines), [form.lines]);

  const previewRefund = () => runCagnotteAdminLocked(submitting, async () => {
    const result = await previewOrderRefund({ orderId, additionalReturns: returns, deliveryRefundCents: eurosInputToCents(form.delivery) });
    setModel((value) => ({ ...value, refundPreview: result, correctionPreview: null, notice: "Prévisualisation serveur prête.", uncertain: false }));
  }, setFailure(setModel));
  const confirmRefund = () => runCagnotteAdminLocked(submitting, async () => {
    if (!model.refundPreview) throw new Error("Une prévisualisation serveur est requise.");
    pendingRefund.current ??= {
      orderId, additionalReturns: returns, deliveryRefundCents: eurosInputToCents(form.delivery), source: form.source,
      reference: form.reference.trim(), declaredFinancialCents: eurosInputToCents(form.declaredFinancial), reason: form.reason,
      confirmedAt: cagnotteRefundDateTimeLocalToIso(form.confirmedAt), expectedPreviewVersion: model.refundPreview.previewVersion,
    };
    const result = await recordOrderRefund(pendingRefund.current);
    const notice = result.alreadyRecorded ? "Déclaration retrouvée, sans double écriture." : "Déclaration enregistrée. Aucun remboursement bancaire n’a été exécuté.";
    adminRefreshChannel.publish(orderId, peerRefresh.current ?? undefined);
    await refreshCagnotteAdminAfterWrite(() => reload(notice), onOrderReload);
  }, setFailure(setModel));
  const previewCorrection = () => runCagnotteAdminLocked(submitting, async () => {
    if (!model.inspection?.correctionTarget) throw new Error("Aucune déclaration corrigeable.");
    if (!form.externalVerificationConfirmed) throw new Error("Confirmez d’abord la vérification externe de la correction.");
    const result = await previewRefundCorrection({ orderId, targetEventId: model.inspection.correctionTarget.eventId,
      expectedRevision: model.inspection.correctionTarget.revision, replacementReturns: returns,
      deliveryRefundCents: eurosInputToCents(form.delivery), declaredFinancialCents: eurosInputToCents(form.declaredFinancial),
      correctionReason: form.correctionReason.trim() });
    setModel((value) => ({ ...value, correctionPreview: result, refundPreview: null,
      notice: result.kind === "correction_requires_review" ? result.reviewReason || "Correction à vérifier." : "Correction prévisualisée par le serveur.",
      uncertain: false }));
  }, setFailure(setModel));
  const confirmCorrection = () => runCagnotteAdminLocked(submitting, async () => {
    if (!model.inspection?.correctionTarget || !model.correctionPreview || model.correctionPreview.kind === "correction_requires_review") {
      throw new Error("Une correction sûre prévisualisée est requise.");
    }
    pendingCorrection.current ??= { orderId, targetEventId: model.inspection.correctionTarget.eventId,
      expectedRevision: model.inspection.correctionTarget.revision, replacementReturns: returns,
      deliveryRefundCents: eurosInputToCents(form.delivery), declaredFinancialCents: eurosInputToCents(form.declaredFinancial),
      correctionReason: form.correctionReason.trim(), correctionReference: form.correctionReference.trim(),
      expectedPreviewVersion: model.correctionPreview.previewVersion };
    const result = await recordRefundCorrection(pendingCorrection.current);
    const notice = result.alreadyRecorded ? "Correction retrouvée, sans double effet." : "Correction enregistrée. Aucun flux bancaire n’a été modifié.";
    adminRefreshChannel.publish(orderId, peerRefresh.current ?? undefined);
    await refreshCagnotteAdminAfterWrite(() => reload(notice), onOrderReload);
  }, setFailure(setModel));
  const submitReview = () => runCagnotteAdminLocked(submitting, async () => {
    if (!model.inspection) throw new Error("Inspection requise.");
    await recordUnpaidReview({ orderId, outcome: form.reviewOutcome, source: form.reviewSource.trim(), reason: form.reviewReason.trim(),
      expectedStateVersion: model.inspection.unpaid.stateVersion });
    setModel((value) => ({ ...value, notice: "Revue enregistrée. Le statut d’envoi ne constitue pas une preuve de paiement.", uncertain: false }));
    await reload();
    await onOrderReload?.();
  }, setFailure(setModel));
  const cancelUnpaid = () => runCagnotteAdminLocked(submitting, async () => {
    if (!model.inspection?.unpaid.review?.current || model.inspection.unpaid.review.outcome !== "unpaid_confirmed") {
      throw new Error("Une revue actuelle confirmant l’impayé est requise.");
    }
    await updateOrderAdminFields(orderId, { orderStatus: "cancelled", historyNote: "Annulation après revue administrative de l’impayé" });
    setModel((value) => ({ ...value, notice: "Commande annulée dans la transaction commune ; réservation libérée selon les contrôles serveur.", uncertain: false }));
    await onOrderReload?.();
  }, setFailure(setModel));

  if (!enabled) return null;
  return <CagnotteAdminToolsView model={model} form={form} onForm={update} onMode={(mode) => setModel((value) => ({ ...value, mode }))}
    onPreviewRefund={previewRefund} onConfirmRefund={confirmRefund} onPreviewCorrection={previewCorrection}
    onConfirmCorrection={confirmCorrection} onReview={submitReview} onCancelUnpaid={cancelUnpaid} />;
}

export function CagnotteAdminToolsView({ model, form = emptyForm(model.inspection ?? undefined), onForm = () => undefined,
  onMode = () => undefined, onPreviewRefund = () => undefined, onConfirmRefund = () => undefined,
  onPreviewCorrection = () => undefined, onConfirmCorrection = () => undefined, onReview = () => undefined,
  onCancelUnpaid = () => undefined,
}: {
  model: CagnotteAdminViewModel;
  form?: Form;
  onForm?: (patch: Partial<Form>) => void;
  onMode?: (mode: Mode) => void;
  onPreviewRefund?: () => void;
  onConfirmRefund?: () => void;
  onPreviewCorrection?: () => void;
  onConfirmCorrection?: () => void;
  onReview?: () => void;
  onCancelUnpaid?: () => void;
}) {
  const inspection = model.inspection;
  if (model.phase === "loading") return <section className="cagnotte-admin" aria-busy="true">Chargement des données administratives…</section>;
  if (!inspection) return <section className="cagnotte-admin"><strong>Outils cagnotte indisponibles</strong><p>{model.notice}</p></section>;
  return <section className="cagnotte-admin" aria-label="Outils administratifs de cagnotte">
    <h3>Administration de la cagnotte</h3>
    <p><strong>{inspection.order.id}</strong> · {inspection.order.customer.name} · {inspection.order.customer.email}</p>
    <p className="cagnotte-admin__warning"><strong>Cette action enregistre votre déclaration.</strong><br />Elle n’effectue aucun remboursement bancaire.</p>
    <div className="cagnotte-admin__actions" aria-label="Opérations quotidiennes">
      <span className="cagnotte-admin__tag">1. Consulter</span><span className="cagnotte-admin__tag">2. Confirmer paiement / livraison</span>
      <button className="secondary" type="button" onClick={() => onMode("unpaid")}>3. Revoir / annuler un impayé</button>
      <button className="secondary" type="button" onClick={() => onMode("refund")}>4. Enregistrer un retour</button>
      <button className="secondary" type="button" onClick={() => onMode("correction")}>5. Corriger une déclaration</button>
    </div>
    <div className="cagnotte-admin__grid">
      <article className="cagnotte-admin__box"><h4>Financement initial</h4><MoneyRows rows={[
        ["Produits nets", inspection.financing.productsNetCents], [cagnotteFinancingLabel(inspection.unpaid.reservationState), inspection.financing.cagnotteCents],
        ["Part externe produits", inspection.financing.externalProductsCents], ["Livraison", inspection.financing.deliveryCents],
        ["Paiement externe total", inspection.financing.externalTotalCents],
      ]} /></article>
      <article className="cagnotte-admin__box"><h4>État effectif</h4><MoneyRows rows={[
        ["Retours produits", inspection.effective.returnedProductNetCents], ["Financier déclaré", inspection.effective.totalFinancialCents],
        ["Cagnotte restituée", inspection.effective.cagnotteRestitutionCents], ["Disponible actuel", inspection.wallet?.availableCents ?? 0],
      ]} /></article>
    </div>
    <AdminRefundHistory inspection={inspection} />
    {model.mode === "refund" && <RefundForm inspection={inspection} form={form} preview={model.refundPreview} onForm={onForm} onPreview={onPreviewRefund} onConfirm={onConfirmRefund} />}
    {model.mode === "correction" && <CorrectionForm inspection={inspection} form={form} preview={model.correctionPreview} onForm={onForm} onPreview={onPreviewCorrection} onConfirm={onConfirmCorrection} />}
    {model.mode === "unpaid" && <UnpaidReview inspection={inspection} form={form} onForm={onForm} onReview={onReview} onCancel={onCancelUnpaid} />}
    {model.notice && <p className={`cagnotte-admin__status${model.uncertain || model.correctionPreview?.kind === "correction_requires_review" ? " review" : ""}`}>{model.notice}</p>}
  </section>;
}

function AdminRefundHistory({ inspection }: { inspection: CagnotteAdminInspection }) {
  return <article className="cagnotte-admin__box" style={{ marginTop: "1rem" }}>
    <h4>Historique administratif</h4>
    {!inspection.history.length && <p>Aucune déclaration enregistrée.</p>}
    <div className="cagnotte-admin__history">
      {inspection.history.map((entry) => <section key={entry.id} className="cagnotte-admin__history-entry">
        <div className="cagnotte-admin__actions">
          <strong>{entry.type === "initial_declaration" ? "Déclaration initiale" : isNeutralization(entry) ? "Correction · neutralisation" : "Correction · remplacement"}</strong>
          <span className="cagnotte-admin__tag">{entry.effective ? "Active / effective" : "Corrigée / inactive"}</span>
        </div>
        <p>Référence : {entry.reference} · {formatAdminDate(entry.recordedAt)}</p>
        {entry.targetReference && <p>Corrige la déclaration : {entry.targetReference}</p>}
        <MoneyRows rows={[
          ["Retour net", entry.returnedProductNetCents],
          ["Financier", entry.financialCents],
          ["Cagnotte restituée", entry.cagnotteRestitutionCents],
          ["Solde disponible résultant", entry.resultingAvailableCents],
        ]} />
        {entry.type === "correction" && <p>Aucun flux bancaire n’est modifié par cette correction administrative.</p>}
      </section>)}
    </div>
  </article>;
}

function RefundForm({ inspection, form, preview, onForm, onPreview, onConfirm }: { inspection: CagnotteAdminInspection; form: Form; preview: RefundPreview | null; onForm: (patch: Partial<Form>) => void; onPreview: () => void; onConfirm: () => void }) {
  return <div className="cagnotte-admin__box" style={{ marginTop: "1rem" }}><h4>Enregistrer un remboursement déjà confirmé</h4>
    <LineInputs inspection={inspection} form={form} onForm={onForm} />
    <div className="cagnotte-admin__grid"><Input label="Livraison remboursée (€)" value={form.delivery} onChange={(delivery) => onForm({ delivery })} />
      <Input label="Montant financier déclaré (€)" value={form.declaredFinancial} onChange={(declaredFinancial) => onForm({ declaredFinancial })} /></div>
    {isZeroInput(form.declaredFinancial) && <p className="cagnotte-admin__warning">Montant financier nul : confirmez qu’aucune part externe n’a été remboursée.</p>}
    <div className="cagnotte-admin__grid"><Input label="Référence métier" value={form.reference} onChange={(reference) => onForm({ reference })} />
      <Input label="Date de confirmation" value={form.confirmedAt} type="datetime-local" step={1} onChange={(confirmedAt) => onForm({ confirmedAt })} /></div>
    <div className="cagnotte-admin__grid"><label>Source<select value={form.source} onChange={(event) => onForm({ source: event.target.value as Form["source"] })}><option value="admin">Déclaration administrateur</option><option value="provider_reference">Référence prestataire vérifiée</option></select></label>
      <label>Motif<select value={form.reason} onChange={(event) => onForm({ reason: event.target.value as Form["reason"] })}><option value="product_return">Retour produit</option><option value="order_cancellation">Annulation de commande</option><option value="delivery_refund">Remboursement de livraison</option></select></label></div>
    {preview && <Consequences refund={preview} />}
    <div className="cagnotte-admin__actions"><button type="button" onClick={onPreview}>Prévisualiser sur le serveur</button>
      <button type="button" onClick={onConfirm} disabled={!preview || preview.kind === "administrative_refund_recorded"}>Confirmer l’enregistrement</button></div>
  </div>;
}

function CorrectionForm({ inspection, form, preview, onForm, onPreview, onConfirm }: { inspection: CagnotteAdminInspection; form: Form; preview: CorrectionPreview | null; onForm: (patch: Partial<Form>) => void; onPreview: () => void; onConfirm: () => void }) {
  return <div className="cagnotte-admin__box" style={{ marginTop: "1rem" }}><h4>Corriger une déclaration</h4>
    <p>Seule la dernière déclaration effective peut être neutralisée ou remplacée. L’original reste dans l’historique.</p>
    {!inspection.correctionTarget ? <p>Aucune déclaration corrigeable.</p> : <><LineInputs inspection={inspection} form={form} onForm={onForm} remainingMeansInitial />
      <div className="cagnotte-admin__grid"><Input label="Livraison corrigée (€)" value={form.delivery} onChange={(delivery) => onForm({ delivery })} />
        <Input label="Part financière corrigée (€)" value={form.declaredFinancial} onChange={(declaredFinancial) => onForm({ declaredFinancial })} />
        <Input label="Motif obligatoire" value={form.correctionReason} onChange={(correctionReason) => onForm({ correctionReason })} />
        <Input label="Référence de correction" value={form.correctionReference} onChange={(correctionReference) => onForm({ correctionReference })} /></div>
      <label style={{ marginTop: ".75rem", display: "flex", gridTemplateColumns: "auto 1fr", alignItems: "center" }}><input style={{ width: "auto" }} type="checkbox" checked={form.externalVerificationConfirmed} onChange={(event) => onForm({ externalVerificationConfirmed: event.target.checked })} />Je confirme avoir vérifié extérieurement la réalité financière et corriger uniquement la saisie administrative.</label>
      {preview && <CorrectionConsequences value={preview} />}
      <div className="cagnotte-admin__actions"><button type="button" onClick={onPreview}>Prévisualiser la correction</button>
        <button type="button" onClick={onConfirm} disabled={!preview || preview.kind === "correction_requires_review" || !form.externalVerificationConfirmed}>Confirmer après vérification externe</button></div></>}
  </div>;
}

function UnpaidReview({ inspection, form, onForm, onReview, onCancel }: { inspection: CagnotteAdminInspection; form: Form; onForm: (patch: Partial<Form>) => void; onReview: () => void; onCancel: () => void }) {
  const unpaid = inspection.unpaid;
  return <div className="cagnotte-admin__box" style={{ marginTop: "1rem" }}><h4>Revue d’un impayé</h4>
    {unpaid.reviewRequired && <span className="cagnotte-admin__tag">À revoir · plus de 72 heures</span>}
    <MoneyRows rows={[["Montant réservé", unpaid.reservedAmountCents]]} />
    <p><strong>Règlement de la commande :</strong> {paymentStatusLabel(unpaid.payment.status)}{unpaid.payment.uncertain ? " · à vérifier" : ""}</p>
    <p><strong>Transmission du lien :</strong> {deliveryStatusLabel(unpaid.linkTransmission.status)} / {transportStatusLabel(unpaid.linkTransmission.transportStatus)}{unpaid.linkTransmission.uncertain ? " · résultat d’envoi à vérifier" : ""}</p>
    <p className="cagnotte-admin__warning">Un résultat d’envoi à vérifier n’est ni une preuve de paiement ni une preuve d’impayé. Une annulation locale ne révoque pas le lien externe et ne retire pas un e-mail déjà transmis.</p>
    <p><strong>Conséquences de l’annulation :</strong> commande et paiement marqués annulés, stock et promotions restaurés selon leurs marqueurs, réservation libérée dans la transaction commune. Le lien externe reste utilisable tant que le prestataire ne l’a pas révoqué.</p>
    <div className="cagnotte-admin__grid"><label>Résultat de la revue<select value={form.reviewOutcome} onChange={(event) => onForm({ reviewOutcome: event.target.value as Form["reviewOutcome"] })}><option value="payment_uncertain">Paiement encore indéterminé</option><option value="unpaid_confirmed">Impayé confirmé après vérification</option></select></label>
      <Input label="Source d’observation" value={form.reviewSource} onChange={(reviewSource) => onForm({ reviewSource })} />
      <Input label="Motif" value={form.reviewReason} onChange={(reviewReason) => onForm({ reviewReason })} /></div>
    <div className="cagnotte-admin__actions"><button type="button" onClick={onReview} disabled={unpaid.linkTransmission.sendingActive}>Enregistrer la revue</button>
      <button type="button" onClick={onCancel} disabled={unpaid.linkTransmission.sendingActive || !unpaid.review?.current || unpaid.review.outcome !== "unpaid_confirmed"}>Annuler après revue de l’impayé</button></div>
    {unpaid.review && <p className="cagnotte-admin__status">Dernière revue : {reviewOutcomeLabel(unpaid.review.outcome)} · {formatAdminDate(unpaid.review.reviewedAt)}{unpaid.review.current ? "" : " · devenue ancienne"}</p>}
  </div>;
}

function LineInputs({ inspection, form, onForm, remainingMeansInitial = false }: { inspection: CagnotteAdminInspection; form: Form; onForm: (patch: Partial<Form>) => void; remainingMeansInitial?: boolean }) {
  return <div className="cagnotte-admin__grid">{inspection.lines.map((line) => <div className="cagnotte-admin__box" key={line.lineId}>
    <Input label={`${line.label} · ${formatCents(remainingMeansInitial ? line.initialNetCents : line.remainingNetCents)} admissibles`} value={form.lines[line.lineId] ?? ""}
      onChange={(value) => onForm({ lines: { ...form.lines, [line.lineId]: value } })} />
    <button className="secondary" type="button" onClick={() => onForm({ lines: { ...form.lines, [line.lineId]: centsToInput(remainingMeansInitial ? line.initialNetCents : line.remainingNetCents) } })}>Tout le montant restant</button>
  </div>)}</div>;
}

function Consequences({ refund }: { refund: RefundPreview }) { return <div className="cagnotte-admin__status"><strong>Conséquences calculées par le serveur</strong><MoneyRows rows={[
  ["Part financière déclarée", refund.totalFinancialCents], ["Cagnotte brute restituée", refund.restitution.grossCents],
  ["Correction du gain", refund.correction.appliedCents], ["Compensation", refund.restitution.compensationCents],
  ["Disponible estimé", refund.restitution.availableAfterCents],
]} /></div>; }
function CorrectionConsequences({ value }: { value: CorrectionPreview }) { return <div className={`cagnotte-admin__status${value.kind === "correction_requires_review" ? " review" : ""}`}><strong>{value.kind === "correction_requires_review" ? "CORRECTION_REQUIRES_REVIEW" : "Effet différentiel"}</strong>
  {value.reviewReason && <p>{value.reviewReason}</p>}<MoneyRows rows={[["Retour effectif", value.effective.returnedProductNetCents], ["Variation financière", value.differential.totalFinancialCents],
    ["Variation de restitution", value.differential.cagnotteRestitutionCents], ["Variation du gain", value.differential.loyaltyCents], ["Disponible après correction", value.walletAfter.availableCents]]} /></div>; }
function MoneyRows({ rows }: { rows: Array<[string, number]> }) { return <dl className="cagnotte-admin__amounts">{rows.map(([label, cents]) => <div key={label} style={{ display: "contents" }}><dt>{label}</dt><dd>{formatCents(cents)}</dd></div>)}</dl>; }
function Input({ label, value, onChange, type = "text", step }: { label: string; value: string; onChange: (value: string) => void; type?: string; step?: number }) { return <label>{label}<input type={type} value={value} step={step} onChange={(event) => onChange(event.target.value)} /></label>; }

function formReturns(lines: Record<string, string>) { return Object.entries(lines).map(([lineId, value]) => ({ lineId, additionalNetCents: eurosInputToCents(value) })).filter((line) => line.additionalNetCents > 0); }
function centsToInput(value: number) { return (value / 100).toFixed(2).replace(".", ","); }
function formatCents(value: number) { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value / 100); }
function cagnotteFinancingLabel(state: string | null) { return state === "reserved" ? "Cagnotte réservée" : state === "consumed" ? "Cagnotte consommée" : "Cagnotte mobilisée"; }
function deliveryStatusLabel(status: string) { return status === "sent" ? "Envoyé" : status === "failed" ? "Échec confirmé" : status === "sending" || status === "pending" ? "En cours" : status === "not_sent" || status === "not_requested" ? "Non envoyé" : "Résultat à vérifier"; }
function transportStatusLabel(status: string) { return status === "accepted" ? "Pris en charge" : status === "not_sent" ? "Non envoyé" : "Résultat à vérifier"; }
function reviewOutcomeLabel(outcome: "unpaid_confirmed" | "payment_uncertain") { return outcome === "unpaid_confirmed" ? "Impayé confirmé après vérification" : "Paiement encore indéterminé"; }
function formatAdminDate(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "Date indisponible" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(date); }
function emptyForm(inspection?: CagnotteAdminInspection | null): Form { return { lines: Object.fromEntries((inspection?.lines ?? []).map((line) => [line.lineId, ""])), delivery: "", source: "admin", reference: "", confirmedAt: cagnotteRefundDateTimeLocalValue(), reason: "product_return", declaredFinancial: "", correctionReason: "", correctionReference: "", reviewOutcome: "payment_uncertain", reviewSource: "", reviewReason: "", externalVerificationConfirmed: false }; }
function isNeutralization(entry: CagnotteAdminInspection["history"][number]) { return entry.type === "correction" && entry.returnedProductNetCents === 0 && entry.financialCents === 0 && entry.cagnotteRestitutionCents === 0; }
function isZeroInput(value: string) { try { return eurosInputToCents(value) === 0; } catch { return false; } }
function setFailure(setModel: Dispatch<SetStateAction<CagnotteAdminViewModel>>) { return (error: unknown) => setModel((value) => ({ ...value, notice: message(error), uncertain: error instanceof CagnotteAdminRequestError && error.uncertain })); }
function message(error: unknown) { return error instanceof Error ? error.message : "Opération impossible."; }
