import type { ReferralCheckoutState } from "../../services/referralCheckoutController";
import { formatEuro } from "../../lib/formatEuro";

export function ReferralCheckoutPanel({ state, locked, onCheck, onAccept, onWithout, onChooseReferral, onChooseWallet }: {
  state: ReferralCheckoutState; locked: boolean; onCheck: () => void; onAccept: () => void;
  onWithout: () => void; onChooseReferral: () => void; onChooseWallet: () => void;
}) {
  const quote = state.quote?.referralUse;
  const reasons = { below_threshold: "Votre panier doit atteindre 50 € de produits éligibles avant cette remise.",
    priority_advantage: "Une promotion ou un autre avantage prioritaire s’applique à cette commande.",
    no_relation: "Aucune invitation n’est associée à votre compte.", right_consumed: "Votre avantage de première commande a déjà été utilisé.",
    right_reserved: "Votre avantage est déjà utilisé par une autre commande en cours." };
  const busy = locked || state.phase === "loading";
  return <section className="rounded-md border border-forest/10 bg-cream p-4" aria-labelledby="checkout-referral-title" data-referral-checkout>
    <h2 id="checkout-referral-title" className="font-semibold">Votre avantage parrainage</h2>
    <p className="mt-1 text-xs">5 € dès 50 € de produits éligibles, hors promotions prioritaires et utilisation de la cagnotte.</p>
    <button type="button" className="btn-secondary mt-3" disabled={busy} onClick={onCheck}>Vérifier mon avantage parrainage</button>
    {quote?.applied ? <div className="mt-3">
      <p>Avantage parrainage disponible : −{formatEuro(quote.referralDiscountCents / 100)}.</p>
      <p>Produits après remise : {formatEuro(quote.productsAfterReferralCents / 100)}.</p>
      <p>À régler : {formatEuro(quote.payableCents / 100)}.</p>
      <p className="text-xs">Fidélité estimée après paiement et livraison : {formatEuro(quote.loyaltyEstimateCents / 100)}.</p>
      {!state.acceptance && <button type="button" className="btn-primary mt-2" disabled={busy} onClick={onAccept}>Appliquer les 5 €</button>}
    </div> : quote ? <p className="mt-2">{reasons[quote.reason]}</p> : null}
    {state.phase === "conflict" ? <div className="mt-3 flex flex-col gap-2">
      <button type="button" className="btn-secondary" disabled={busy} onClick={onChooseReferral}>Continuer avec le parrainage sans utiliser ma cagnotte</button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={onChooseWallet}>Conserver ma cagnotte</button>
    </div> : state.requested ? <button type="button" className="mt-3 underline" disabled={busy} onClick={onWithout}>Continuer sans avantage parrainage</button> : null}
    <p className="mt-2 text-sm" aria-live="polite" role="status">{state.message}</p>
  </section>;
}
