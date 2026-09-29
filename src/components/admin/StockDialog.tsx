import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../../context/AuthContext";
import { AdminDialog } from "./AdminDialog";
import { AdminConfirmDialog } from "./AdminConfirmDialog";
import { AdminStockApiError, adjustAdminStock, forgetStockOperation, getAdminStockOperation, pendingStockOperations, readAdminStockDetail, rememberStockOperation } from "../../services/adminStockService";
import { stockReasons, type StockAdjustment, type StockDetail, type StockOperationResult, type StockSnapshot } from "../../types/adminStock";

export function AdminStocks({ children, onSnapshot }: {
  children: (open: (productId: string) => void) => ReactNode;
  onSnapshot: (snapshot: StockSnapshot) => void;
}) {
  const { user } = useAuth();
  const uid = user?.uid || "";
  const [selected, setSelected] = useState("");
  const [revision, setRevision] = useState(0);
  let pending: ReturnType<typeof pendingStockOperations> = [];
  let journalError = "";
  try { pending = pendingStockOperations(uid); }
  catch (error) { journalError = error instanceof Error ? error.message : "Journal stock indisponible."; }
  return <>
    {journalError && <p role="alert">{journalError}</p>}
    {pending.map((entry) => <div key={entry.operation.operationId} className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p>Une correction de {entry.productName} doit être vérifiée avant toute nouvelle opération.</p>
      <button className="btn-secondary mt-2" onClick={() => setSelected(entry.operation.productId)}>Vérifier l’opération</button>
    </div>)}
    {children(setSelected)}
    {selected && <StockDialog key={`${selected}-${uid}-${revision}`} productId={selected} uid={uid} onSnapshot={onSnapshot}
      onClose={() => { setSelected(""); setRevision((value) => value + 1); }} />}
  </>;
}

const integer = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;
const movementLabels: Record<string, string> = {
  admin_adjustment: "Ajustement admin", manual_add: "Ajout manuel", sale: "Vente", order_cancelled: "Annulation de commande",
  return: "Retour", loss: "Perte", correction: "Correction", restock: "Réapprovisionnement", promotion_gift: "Cadeau promotionnel",
};
const categoryLabels = { flowers: "Fleurs CBD", resins: "Résines CBD", oils: "Huiles CBD", packs: "Autres produits CBD" };

export function StockDialog({ productId, uid, onClose, onSnapshot }: {
  productId: string; uid: string; onClose: () => void; onSnapshot: (snapshot: StockSnapshot) => void;
}) {
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [target, setTarget] = useState("");
  const [threshold, setThreshold] = useState("");
  const [reason, setReason] = useState<StockAdjustment["reason"] | "">("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("Chargement des valeurs serveur…");
  const [frozen, setFrozen] = useState<StockAdjustment | null>(null);
  const [conflict, setConflict] = useState<StockSnapshot | null>(null);
  const [canReplay, setCanReplay] = useState(false);
  const [stale, setStale] = useState(true);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const journalBlocked = useRef(false);

  async function load(preserveDraft = false) {
    const data = await readAdminStockDetail(productId);
    if (!mounted.current) return;
    setDetail(data); setStale(false); onSnapshot(data.product);
    if (!preserveDraft) { setTarget(String(data.product.stock)); setThreshold(String(data.product.lowStockThreshold)); }
  }
  async function applied(result: StockOperationResult) {
    // The durable result proves execution, even when a later detail reload fails.
    setError("");
    if (detail && !result.replayed) {
      const product = { ...detail.product, stock: result.afterStock, lowStockThreshold: result.afterLowStockThreshold };
      setDetail({ ...detail, product }); onSnapshot(product);
      setTarget(String(product.stock)); setThreshold(String(product.lowStockThreshold));
    }
    try { forgetStockOperation(uid, result.operationId); }
    catch { journalBlocked.current = true; setError("Correction appliquée, mais le journal local n’a pas pu être effacé. Vérifiez à nouveau avant de continuer."); }
    setFrozen(null); setCanReplay(false); setConfirm(false); setConflict(null); setReason(""); setNote("");
    setMessage(`Correction appliquée : ${result.beforeStock} → ${result.afterStock} (${signed(result.delta)}).`);
    setStale(true);
    try { await load(); }
    catch { setError("Correction appliquée. Rechargez les valeurs serveur avant toute nouvelle correction."); }
  }
  async function verify(operation: StockAdjustment) {
    setMessage("Vérification de l’opération…"); setCanReplay(false);
    try {
      const status = await getAdminStockOperation(operation.operationId);
      if (!mounted.current) return;
      if (status.status === "applied") {
        if (status.result.productId !== operation.productId || status.result.adminUid !== uid) throw new AdminStockApiError("Résultat de vérification incompatible.", "response_lost", true);
        await applied(status.result);
      }
      else { setMessage("Aucun résultat enregistré pour le moment. Reprenez la même opération pour obtenir un résultat certain."); setCanReplay(true); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Vérification indisponible."); setMessage("Résultat encore incertain. L’identifiant est conservé."); }
  }
  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    // Recovery runs before offering a new correction, including after a page reload.
    void (async () => {
      let pending: StockAdjustment | undefined;
      try { pending = pendingStockOperations(uid).find((entry) => entry.operation.productId === productId)?.operation; }
      catch (cause) { journalBlocked.current = true; setError(cause instanceof Error ? cause.message : "Journal indisponible."); }
      if (pending) { setFrozen(pending); setTarget(String(pending.targetStock)); setThreshold(String(pending.lowStockThreshold)); setReason(pending.reason); setNote(pending.note); }
      try {
        const data = await readAdminStockDetail(productId);
        if (cancelled) return;
        setDetail(data); setStale(false); onSnapshot(data.product);
        if (!pending) { setTarget(String(data.product.stock)); setThreshold(String(data.product.lowStockThreshold)); setMessage(""); }
      }
      catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "Lecture impossible."); }
      if (pending && !cancelled) {
        inFlight.current = true; setBusy(true);
        try { await verify(pending); } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
      }
    })();
    return () => { cancelled = true; mounted.current = false; };
    // A new product mounts a new dialog; live form changes must not restart recovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, uid]);

  const valid = Boolean(uid && detail && !stale && !frozen && !conflict && !journalBlocked.current && integer(target) && integer(threshold) && reason &&
    (reason !== "other" || note.trim()) && note.trim().length <= 1000 &&
    (Number(target) !== detail.product.stock || Number(threshold) !== detail.product.lowStockThreshold));
  const draft = detail && reason ? {
    productId, expectedStock: detail.product.stock, targetStock: Number(target),
    expectedLowStockThreshold: detail.product.lowStockThreshold, lowStockThreshold: Number(threshold), reason, note: note.trim(),
  } : null;
  const preview = frozen || draft;

  async function send(operation?: StockAdjustment) {
    if (inFlight.current || (!operation && (!valid || !draft))) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("Enregistrement de la correction…");
    try {
      const input = operation || { ...draft!, operationId: crypto.randomUUID() };
      rememberStockOperation(uid, input, detail?.product.name || productId);
      setFrozen(input);
      try { await applied(await adjustAdminStock(input)); }
      catch (cause) {
        const refusalProvesNoExecution = cause instanceof AdminStockApiError && !cause.uncertain &&
          ["stock_conflict", "no_change", "invalid_quantity", "invalid_request", "invalid_reason", "invalid_operation", "invalid_product", "product_missing", "protected_product"].includes(cause.code);
        if (refusalProvesNoExecution && cause instanceof AdminStockApiError) {
          forgetStockOperation(uid, input.operationId); setFrozen(null); setCanReplay(false); setMessage("");
          setError(cause.message);
          if (cause.code === "stock_conflict" && cause.current) { setConflict(cause.current); setStale(true); setConfirm(true); onSnapshot(cause.current); }
        } else {
          setConfirm(false);
          setError(cause instanceof Error ? cause.message : "Réponse incertaine.");
          await verify(input);
        }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Journal indisponible ; aucune correction envoyée."); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { await load(Boolean(conflict)); setConflict(null); setConfirm(false); setMessage("Valeurs serveur rechargées. Vérifiez puis confirmez votre correction."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Lecture impossible."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function verifyAgain() {
    if (!frozen || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { await verify(frozen); } finally { inFlight.current = false; setBusy(false); }
  }
  const unit = detail && ["flowers", "resins"].includes(detail.product.category) ? "g" : "unités";
  return <>
    <AdminDialog open title="Modifier le stock" description="Une correction est enregistrée avec son motif et son historique." pending={busy}
      onClose={onClose} footer={<>
        <button className="btn-secondary" disabled={busy} onClick={onClose}>Fermer</button>
        <button className="btn-primary" disabled={busy || !valid} onClick={() => { setError(""); setConfirm(true); }}>Vérifier la correction</button>
      </>}>
      <div className="space-y-5">
        {detail && <div className="rounded-xl border border-forest/10 bg-cream p-4">
          <h3 className="font-display text-2xl text-forest">{detail.product.name}</h3>
          <p>{detail.product.internalReference || productId} · {categoryLabels[detail.product.category] || "Produit"} · {detail.product.isActive ? "Actif" : "Inactif"}</p>
          <p>Stock serveur : <strong>{detail.product.stock} {unit}</strong> · Seuil : {detail.product.lowStockThreshold} {unit}</p>
        </div>}
        <fieldset disabled={busy || Boolean(frozen) || Boolean(conflict) || stale || journalBlocked.current} className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">Nouveau stock<input className="input-field" type="number" min="0" step="1" value={target} onChange={(event) => setTarget(event.target.value)} /></label>
          <label className="grid gap-1 text-sm">Seuil d’alerte<input className="input-field" type="number" min="0" step="1" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>
          <label className="grid gap-1 text-sm sm:col-span-2">Motif<select aria-label="Motif" className="input-field" value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}>
            <option value="">Choisir un motif</option>{Object.entries(stockReasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label className="grid gap-1 text-sm sm:col-span-2">Note {reason === "other" ? "(obligatoire)" : "(facultative)"}<textarea className="input-field" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        </fieldset>
        {preview && integer(target) && <p className="rounded-lg bg-ivory p-3">Aperçu : {preview.expectedStock} → {preview.targetStock} {unit} · Variation {signed(preview.targetStock - preview.expectedStock)} {unit}.</p>}
        {message && <p role="status">{message}</p>}
        {error && !confirm && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
        {frozen && <div className="space-y-2 rounded-lg border border-amber-200 p-3">
          <p>Opération conservée : <code className="break-all">{frozen.operationId}</code></p>
          <button className="btn-secondary" disabled={busy} onClick={() => void verifyAgain()}>Vérifier le résultat</button>
          {canReplay && <button className="btn-primary" disabled={busy} onClick={() => void send(frozen)}>Reprendre la même opération</button>}
        </div>}
        {conflict && !confirm && <p role="alert">Valeur attendue {preview?.expectedStock}, stock serveur {conflict.stock}, valeur demandée {target}. Aucun ajustement effectué.</p>}
        {stale && !frozen && <button className="btn-secondary" disabled={busy} onClick={() => void reload()}>Recharger les valeurs</button>}
        {detail && <section aria-label="Historique des mouvements" className="space-y-3 border-t border-forest/10 pt-4">
          <h3 className="font-display text-xl">Derniers mouvements</h3>
          {!detail.movements.length && <p>Aucun mouvement enregistré.</p>}
          {detail.movements.map((entry) => <article key={entry.id} className="rounded-lg bg-ivory p-3 text-sm">
            <p><strong>{movementLabels[entry.type] || entry.type}</strong> · {signed(entry.quantity)} {unit}</p>
            {entry.beforeStock !== undefined && <p>{entry.beforeStock} → {entry.afterStock}</p>}
            <p>{entry.note}</p><p className="break-all text-xs text-ink/60">{entry.createdAt ? new Date(entry.createdAt).toLocaleString("fr-FR") : "Date inconnue"} · {entry.createdBy}</p>
          </article>)}
        </section>}
      </div>
    </AdminDialog>
    <AdminConfirmDialog open={confirm} title="Confirmer la correction du stock" pending={busy} error={error}
      confirmLabel="Confirmer la correction" confirmDisabled={!valid} cancelLabel="Retour au formulaire"
      onCancel={() => setConfirm(false)} onConfirm={() => send()}
      summary={preview && <div className="space-y-2">
        <p><strong>{detail?.product.name || productId}</strong> · {detail?.product.internalReference || productId}</p>
        <p>Stock actuel : {preview.expectedStock} {unit} · Nouveau stock : {preview.targetStock} {unit}</p>
        <p>Variation : {signed(preview.targetStock - preview.expectedStock)} {unit} · Seuil : {preview.expectedLowStockThreshold} → {preview.lowStockThreshold}</p>
        <p>Motif : {stockReasons[preview.reason]}{preview.note && ` — ${preview.note}`}</p>
      </div>}
      warning={conflict ? <div>
        <p>Conflit : valeur attendue {preview?.expectedStock}, stock serveur {conflict.stock}, valeur demandée {target}. Aucun ajustement effectué.</p>
        <button className="btn-secondary mt-2" disabled={busy} onClick={() => void reload()}>Recharger les valeurs</button>
      </div> : "Cette correction modifie le stock. Vérifiez le produit, les quantités et le motif."} />
  </>;
}
