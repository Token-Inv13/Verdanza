import React, { useEffect, useId, useMemo, useState } from "react";
import { CagnotteReadController, fetchCagnotte, type CagnottePanelState, type CagnotteReadRequest } from "../../services/cagnotteService";
import type { CagnotteHistoryDetail, CagnotteHistoryItem, CagnotteReadScope } from "../../types/cagnotteRead";
import { formatCagnotteCents } from "../../lib/cagnottePresentation";

const initialState: CagnottePanelState = { phase: "idle", data: null, errorCode: null };

export function CagnottePanel(props: {
  enabled: boolean;
  identityKey: string | null;
  scope: CagnotteReadScope;
  targetUid?: string;
  customerLabel?: string;
  instanceId?: string;
  request?: (input: CagnotteReadRequest) => ReturnType<typeof fetchCagnotte>;
}) {
  if (!props.enabled) return null;
  return <ActiveCagnottePanel {...props} identityKey={props.identityKey} />;
}

function ActiveCagnottePanel({ identityKey, scope, targetUid, customerLabel, instanceId, request = fetchCagnotte }: Omit<Parameters<typeof CagnottePanel>[0], "enabled">) {
  const [state, setState] = useState<CagnottePanelState>(initialState);
  const controller = useMemo(() => new CagnotteReadController(request, setState), [request]);
  useEffect(() => {
    controller.setIdentity(identityKey ? { identityKey, scope, ...(targetUid ? { targetUid } : {}) } : null);
    return () => controller.dispose();
  }, [controller, identityKey, scope, targetUid]);
  return <CagnotteView state={state} customerLabel={customerLabel} instanceId={instanceId} onRefresh={() => controller.refresh()} onLoadMore={() => controller.loadMore()} />;
}

export function CagnotteView({
  state,
  customerLabel,
  demonstration = false,
  instanceId,
  onRefresh,
  onLoadMore,
}: {
  state: CagnottePanelState;
  customerLabel?: string;
  demonstration?: boolean;
  instanceId?: string;
  onRefresh?: () => void;
  onLoadMore?: () => void;
}) {
  const generatedId = useId();
  const titleId = `cagnotte-${customerLabel ? "admin" : "account"}-${domId(instanceId || generatedId)}-title`;
  const title = customerLabel ? `Avantages en euros — ${customerLabel}` : "Mes avantages";
  if (state.phase === "idle") return <CagnotteMessage title={title}>Fonctionnalité indisponible.</CagnotteMessage>;
  if (state.phase === "loading") return <CagnotteMessage title={title} busy>Chargement des avantages…</CagnotteMessage>;
  if (state.phase === "error") {
    const expired = state.errorCode === "session_expired";
    return (
      <CagnotteMessage title={title} role="alert">
        {expired ? "Votre session a expiré. Reconnectez-vous pour consulter vos avantages." : "Historique indisponible. Aucun solde ne peut être affiché pour le moment."}
        {!expired && <button className="cagnotte-button" type="button" onClick={onRefresh}>Réessayer</button>}
      </CagnotteMessage>
    );
  }
  const data = state.data;
  if (!data) return null;
  return (
    <section className="cagnotte-panel" aria-labelledby={titleId}>
      <header className="cagnotte-heading">
        <div>
          {demonstration && <p className="cagnotte-demo">Démonstration — données fictives</p>}
          <h2 id={titleId}>{title}</h2>
          {customerLabel && <p className="cagnotte-customer">Consultation en lecture seule du client sélectionné.</p>}
        </div>
        <button className="cagnotte-button cagnotte-button-secondary" type="button" onClick={onRefresh}>Actualiser</button>
      </header>
      {data.wallet.status === "not_created" ? (
        <div className="cagnotte-empty">
          <strong>Portefeuille non créé</strong>
          <p>Aucun avantage en euros n’est enregistré pour ce compte.</p>
        </div>
      ) : (
        <>
          <div className="cagnotte-balances">
            <div className="cagnotte-balance cagnotte-balance-primary"><span>Disponible</span><strong>{formatCagnotteCents(data.wallet.availableCents)}</strong></div>
            <div className="cagnotte-balance"><span>Gains en attente</span><strong>{formatCagnotteCents(data.wallet.pendingCents)}</strong></div>
            {data.wallet.reservedCents > 0 && <div className="cagnotte-balance"><span>Réservé pour vos commandes</span><strong>{formatCagnotteCents(data.wallet.reservedCents)}</strong></div>}
            {data.wallet.regularizationCents > 0 && <div className="cagnotte-balance cagnotte-balance-regularization"><span>À régulariser</span><strong>{formatCagnotteCents(data.wallet.regularizationCents)}</strong></div>}
          </div>
          {data.wallet.regularizationCents > 0 && (
            <div className="cagnotte-notice" role="note">
              <strong>Régularisation en cours</strong>
              <p>Ce montant sera compensé par vos prochains gains disponibles. Aucun paiement ne vous est demandé.</p>
            </div>
          )}
        </>
      )}
      <div className="cagnotte-history">
        <h3>Historique</h3>
        <p className="cagnotte-muted">Certains mouvements anciens peuvent ne pas apparaître.</p>
        {!data.history.items.length && !data.history.nextCursor && <p className="cagnotte-muted">Aucun mouvement horodaté à afficher.</p>}
        {!data.history.items.length && data.history.nextCursor && <p className="cagnotte-muted">Cette page ne contient aucun mouvement monétaire. Vous pouvez charger la suite.</p>}
        <ol>
          {data.history.items.map((item, index) => <HistoryRow item={item} key={`${item.occurredAt}-${item.label}-${item.amountCents}-${index}`} />)}
        </ol>
        {data.history.nextCursor && (
          <button className="cagnotte-button" type="button" disabled={state.phase === "loading_more"} onClick={onLoadMore}>
            {state.phase === "loading_more" ? "Chargement…" : "Charger la suite"}
          </button>
        )}
      </div>
      <p className="cagnotte-muted">Les crédits du programme V1 n’expirent pas automatiquement.</p>
      <p className="cagnotte-freshness">Lecture du {formatDate(data.freshness.readAt)}. Actualiser recharge le solde et repart de la première page.</p>
      {demonstration && <p className="cagnotte-preparation">Règles commerciales définies — programme non activé.</p>}
    </section>
  );
}

function CagnotteMessage({ title, children, busy = false, role }: { title: string; children: React.ReactNode; busy?: boolean; role?: "alert" }) {
  return <section className="cagnotte-panel cagnotte-message" aria-busy={busy} role={role}><h2>{title}</h2><div>{children}</div></section>;
}

function HistoryRow({ item }: { item: CagnotteHistoryItem }) {
  return (
    <li className="cagnotte-history-row">
      <div><strong>{item.label}</strong><time dateTime={item.occurredAt}>{formatDate(item.occurredAt)}</time></div>
      <span className="cagnotte-history-amount">{formatMovementAmount(item)}</span>
      {item.details.length > 0 && (
        <details className="cagnotte-details">
          <summary>Détail des variations</summary>
          <ul aria-label="Compartiments concernés">
            {item.details.map((detail) => <li key={detail.compartment}>{detailLabel(detail)} : {formatSignedCents(detail.deltaCents)}</li>)}
          </ul>
        </details>
      )}
    </li>
  );
}

function detailLabel(detail: CagnotteHistoryDetail) {
  return detail.compartment === "pending" ? "En attente" : detail.compartment === "available" ? "Disponible" : detail.compartment === "reserved" ? "Réservé" : "À régulariser";
}

function formatSignedCents(cents: number) {
  return `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${formatCagnotteCents(Math.abs(cents))}`;
}

function formatMovementAmount(item: CagnotteHistoryItem) {
  if (item.label === "Gain devenu disponible") return `${formatCagnotteCents(item.amountCents)} transférés`;
  if (item.label === "Gain affecté à une régularisation") return `${formatCagnotteCents(item.amountCents)} compensés`;
  if (item.label === "Cagnotte réservée") return `${formatCagnotteCents(item.amountCents)} réservés`;
  if (item.label === "Cagnotte utilisée") return `${formatCagnotteCents(item.amountCents)} utilisés`;
  if (item.label === "Cagnotte libérée") return `${formatCagnotteCents(item.amountCents)} libérés`;
  return formatSignedCents(item.amountCents);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function domId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "") || "instance";
}
