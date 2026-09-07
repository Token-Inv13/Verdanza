import React, { useId } from "react";
import { formatCagnotteCents } from "../../lib/cagnottePresentation";
import type { CagnotteCheckoutState, CheckoutAttemptPhase } from "../../services/cagnotteCheckoutService";
import type { CheckoutOrderResult } from "../../services/ordersService";

type PanelAction = () => Promise<unknown> | void;

export function CagnotteCheckoutPanel(props: {
  enabled: boolean;
  mode: "cart" | "checkout";
  state: CagnotteCheckoutState;
  authenticated: boolean;
  locked?: boolean;
  demonstration?: boolean;
  instanceId?: string;
  onToggle: (enabled: boolean) => void;
  onAmountChange: (value: string) => void;
  onRequest: PanelAction;
  onMaximum: PanelAction;
  onAccept?: () => void;
  onContinueWithout?: () => void;
  onAcceptWithout?: () => void;
  onRefreshWallet?: () => void;
}) {
  if (!props.enabled) return null;
  return <CagnotteCheckoutView {...props} />;
}

export function CagnotteCheckoutView({
  mode,
  state,
  authenticated,
  locked = false,
  demonstration = false,
  instanceId,
  onToggle,
  onAmountChange,
  onRequest,
  onMaximum,
  onAccept,
  onContinueWithout,
  onAcceptWithout,
  onRefreshWallet,
}: Omit<Parameters<typeof CagnotteCheckoutPanel>[0], "enabled">) {
  const wallet = state.wallet?.wallet;
  const capabilities = state.wallet?.capabilities;
  const useUnavailable = capabilities?.canRequestReservation === false;
  const regularizationBlocked = Boolean(wallet?.regularizationCents);
  const noAvailableCredit = state.walletPhase === "ready" && (wallet?.availableCents ?? 0) === 0;
  const quote = state.proposal?.cagnotteUse;
  const canAccept = Boolean(quote && quote.proposedCagnotteCents > 0 && mode === "checkout");
  const generatedId = useId();
  const idSuffix = domId(instanceId || generatedId);
  const titleId = `cagnotte-use-title-${mode}-${idSuffix}`;
  const inputId = `cagnotte-use-amount-${mode}-${idSuffix}`;
  const displayedBalanceIsOlder = Boolean(
    quote && wallet && quote.limitationReasons.includes("available_balance") &&
    wallet.availableCents > quote.proposedCagnotteCents,
  );

  return (
    <section className="cagnotte-use-panel" aria-labelledby={titleId}>
      {demonstration && <p className="cagnotte-use-demo">Démonstration — données fictives</p>}
      <h2 id={titleId}>Utiliser ma cagnotte</h2>
      {!authenticated ? (
        <p className="cagnotte-use-muted">
          Connectez-vous pour consulter et utiliser votre cagnotte. Vous pouvez continuer sans cagnotte.
        </p>
      ) : state.walletPhase === "loading" || state.walletPhase === "idle" ? (
        <p className="cagnotte-use-muted" aria-busy="true">Chargement du disponible…</p>
      ) : state.walletPhase === "error" ? (
        <div className="cagnotte-use-error" role="alert">
          <p>{state.walletErrorCode === "session_expired" ? "Votre session a expiré." : "Le disponible ne peut pas être consulté. Aucun solde nul n’est supposé."}</p>
          {onRefreshWallet && <button type="button" onClick={onRefreshWallet}>Réessayer</button>}
        </div>
      ) : (
        <>
          <dl className="cagnotte-use-balances">
            <div><dt>Disponible</dt><dd>{formatCagnotteCents(wallet?.availableCents ?? 0)}</dd></div>
            <div><dt>En attente</dt><dd>{formatCagnotteCents(wallet?.pendingCents ?? 0)}</dd></div>
            <div><dt>Réservé ailleurs</dt><dd>{formatCagnotteCents(wallet?.reservedCents ?? 0)}</dd></div>
          </dl>
          {regularizationBlocked && (
            <p className="cagnotte-use-warning" role="note">
              Une régularisation de {formatCagnotteCents(wallet?.regularizationCents ?? 0)} empêche une nouvelle utilisation.
            </p>
          )}
          {useUnavailable && (
            <p className="cagnotte-use-warning" role="note">Les nouvelles utilisations sont actuellement suspendues.</p>
          )}
          {noAvailableCredit && !regularizationBlocked && (
            <p className="cagnotte-use-muted">Aucun crédit disponible. Les montants réservés et les gains en attente ne sont pas utilisables.</p>
          )}
          <label className="cagnotte-use-toggle">
            <input
              type="checkbox"
              checked={state.selectionEnabled}
              disabled={locked || useUnavailable || regularizationBlocked || noAvailableCredit}
              onChange={(event) => onToggle(event.target.checked)}
            />
            Utiliser ma cagnotte
          </label>
          {state.selectionEnabled && (
            <div className="cagnotte-use-controls">
              <label htmlFor={inputId}>Montant souhaité en euros</label>
              <input
                id={inputId}
                inputMode="decimal"
                autoComplete="off"
                value={state.amountInput}
                disabled={locked}
                aria-invalid={Boolean(state.amountError)}
                aria-describedby={state.amountError ? `${inputId}-error` : undefined}
                onChange={(event) => onAmountChange(event.target.value)}
                placeholder="8,50"
              />
              {state.amountError && <p id={`${inputId}-error`} className="cagnotte-use-error" role="alert">{state.amountError}</p>}
              <div className="cagnotte-use-actions">
                <button type="button" disabled={locked || state.proposalPhase === "loading" || Boolean(state.amountError)} onClick={() => void onRequest()}>
                  {state.proposalPhase === "loading" ? "Calcul…" : "Appliquer ce montant"}
                </button>
                <button type="button" disabled={locked || state.proposalPhase === "loading"} onClick={() => void onMaximum()}>
                  Utiliser le maximum
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {state.proposalPhase === "invalidated" && (
        <p className="cagnotte-use-warning" role="status">Le panier ou la livraison a changé. Demandez puis validez un nouveau devis.</p>
      )}
      {state.proposalPhase === "error" && (
        <div className="cagnotte-use-error" role="alert">
          <p>{proposalErrorMessage(state.proposalErrorCode)}</p>
          {mode === "checkout" && onContinueWithout && !locked && (
            <button type="button" onClick={onContinueWithout}>Continuer sans utiliser ma cagnotte</button>
          )}
        </div>
      )}
      {quote && (
        <div className="cagnotte-use-quote">
          {state.proposalPhase === "changed" && (
            <p className="cagnotte-use-warning" role="alert">Le montant a changé. Ce nouveau récapitulatif doit être validé.</p>
          )}
          {quote.compatibility.status === "blocked" && (
            <p className="cagnotte-use-warning" role="note">
              Une offre promotionnelle s’applique à cette commande : la cagnotte ne peut pas être utilisée. L’offre reste conservée.
            </p>
          )}
          <dl>
            <div><dt>Total de la commande</dt><dd>{formatEuroCents(Math.round((state.proposal?.total ?? 0) * 100))}</dd></div>
            <div><dt>Financé par votre cagnotte</dt><dd>{formatCagnotteCents(quote.proposedCagnotteCents)}</dd></div>
            <div className="cagnotte-use-payable"><dt>À régler hors cagnotte</dt><dd>{formatCagnotteCents(quote.payableCents)}</dd></div>
          </dl>
          {quote.limitationReasons.map((reason) => (
            <p className="cagnotte-use-muted" key={reason}>{limitationMessage(reason, quote.proposedCagnotteCents)}</p>
          ))}
          {quote.requestedCagnotteCents !== quote.proposedCagnotteCents &&
            quote.proposedCagnotteCents > 0 && quote.limitationReasons.length === 0 && (
              <p className="cagnotte-use-muted">Le montant utilisable vérifié est de {formatCagnotteCents(quote.proposedCagnotteCents)}.</p>
            )}
          {displayedBalanceIsOlder && (
            <div className="cagnotte-use-warning" role="note">
              <p>Le solde affiché est antérieur à la dernière vérification de ce montant.</p>
              {onRefreshWallet && <button type="button" onClick={onRefreshWallet}>Actualiser le solde</button>}
            </div>
          )}
          {quote.loyaltyAccrualStatus === "estimated" && quote.estimatedLoyaltyCents > 0 ? (
            <p className="cagnotte-use-muted">
              {quote.compatibility.status === "blocked" && "Vous continuez à cumuler de la fidélité sur les produits payés. "}
              Gain estimé après paiement et livraison : {formatCagnotteCents(quote.estimatedLoyaltyCents)}. Il n’est pas encore acquis.
            </p>
          ) : (
            <p className="cagnotte-use-muted">Aucun nouveau gain n’est annoncé pour cette commande.</p>
          )}
          {mode === "cart" && <p className="cagnotte-use-muted">Estimation du panier. Le checkout demandera une validation du montant final.</p>}
          {mode === "checkout" && canAccept && onAccept && (
            <button type="button" disabled={locked} onClick={onAccept}>
              {state.acceptance ? `Montant accepté — ${formatCagnotteCents(quote.payableCents)} à régler` : `Accepter — ${formatCagnotteCents(quote.payableCents)} à régler`}
            </button>
          )}
          {mode === "checkout" && onContinueWithout && !locked && (
            <button className="cagnotte-use-link" type="button" onClick={onContinueWithout}>Continuer sans utiliser ma cagnotte</button>
          )}
        </div>
      )}
      {state.fallbackPhase === "loading" && <p className="cagnotte-use-muted" aria-busy="true">Calcul du nouveau total sans cagnotte…</p>}
      {state.fallbackPhase === "error" && <p className="cagnotte-use-error" role="alert">Le devis sans cagnotte est indisponible.</p>}
      {state.fallbackPhase === "ready" && state.fallbackQuote && (
        <div className="cagnotte-use-quote">
          <p>Total sans cagnotte : <strong>{formatEuroCents(Math.round(state.fallbackQuote.total * 100))}</strong></p>
          <button type="button" disabled={locked} onClick={onAcceptWithout}>
            {state.fallbackAccepted ? "Total sans cagnotte accepté" : "Valider le total sans cagnotte"}
          </button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">{state.announcement}</p>
    </section>
  );
}

export function CheckoutAttemptNotice({ phase, error, onRetry, demonstration = false }: {
  phase: CheckoutAttemptPhase;
  error?: string;
  onRetry?: () => void;
  demonstration?: boolean;
}) {
  if (phase !== "uncertain" && phase !== "reload_check" && phase !== "refused") return null;
  if (phase === "refused") {
    return (
      <section className="cagnotte-use-panel cagnotte-use-error" role="alert">
        <h2>Commande non enregistrée</h2>
        <p>{error || "La commande a été refusée. Vérifiez le panier avant de réessayer."}</p>
      </section>
    );
  }
  return (
    <section className="cagnotte-use-panel cagnotte-use-uncertain" role="alert">
      {demonstration && <p className="cagnotte-use-demo">Démonstration — données fictives</p>}
      <h2>Résultat de création à vérifier</h2>
      <p>{error || "La réponse n’est pas arrivée. La commande peut avoir été enregistrée."}</p>
      {phase === "uncertain" && onRetry ? (
        <button type="button" onClick={onRetry}>Reprendre cette tentative</button>
      ) : (
        <p>Consultez « Mes commandes » avant toute nouvelle tentative.</p>
      )}
    </section>
  );
}

export function CheckoutCreationSummary({ result, demonstration = false }: {
  result: CheckoutOrderResult;
  demonstration?: boolean;
}) {
  const paid = result.paymentStatus === "paid";
  return (
    <section className="cagnotte-use-panel cagnotte-use-success">
      {demonstration && <p className="cagnotte-use-demo">Démonstration — données fictives</p>}
      <h2>Commande enregistrée</h2>
      <p>Total de la commande : <strong>{formatEuroCents(Math.round(result.total * 100))}</strong></p>
      {result.cagnotteUse && <p>Cagnotte réservée pour cette commande : <strong>{formatCagnotteCents(result.cagnotteUse.amountCents)}</strong></p>}
      <p>{paid ? "Règlement confirmé." : <>Paiement encore attendu : <strong>{formatEuroCents(Math.round(result.paymentAmount * 100))}</strong>.</>}</p>
    </section>
  );
}

function limitationMessage(reason: string, proposedCents: number) {
  if (reason === "available_balance") return `Le solde disponible vérifié permet d’utiliser ${formatCagnotteCents(proposedCents)}.`;
  if (reason === "twenty_percent_cap") return `Le plafond d’utilisation permet d’utiliser ${formatCagnotteCents(proposedCents)}.`;
  if (reason === "compatibility_blocked") return "Le cumul avec l’avantage actuel n’est pas autorisé.";
  return "Ce cumul nécessite encore une validation commerciale.";
}

function proposalErrorMessage(code: string | null) {
  if (code === "AUTH_REQUIRED") return "Votre session a expiré. Reconnectez-vous pour utiliser votre cagnotte.";
  if (code === "RESERVATIONS_DISABLED") return "Les nouvelles utilisations de cagnotte sont indisponibles.";
  return "La proposition de cagnotte ne peut pas être calculée pour le moment.";
}

function formatEuroCents(cents: number) {
  return formatCagnotteCents(cents);
}

function domId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "") || "instance";
}
