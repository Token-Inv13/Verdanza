import { useEffect, useRef, useState } from "react";
import { referralClient, type ReferralClient } from "../../services/referralService";
import type { ReferralSelf } from "../../types/referralRead";
import { formatEuro } from "../../lib/formatEuro";
import { referralMessage } from "./referralMessages";

export function ReferralPanel({ enabled, identityKey, client = referralClient }: {
  enabled: boolean; identityKey: string | null; client?: ReferralClient;
}) {
  return enabled && identityKey ? <OwnerPanel key={identityKey} client={client} /> : null;
}
function OwnerPanel({ client }: { client: ReferralClient }) {
  const [self, setSelf] = useState<ReferralSelf | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const mounted = useRef(false);
  const linkInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void client.getReferralSelf().then((value) => { if (!cancelled) setSelf(value); })
      .catch((error) => { if (!cancelled) setMessage(referralMessage(error)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; mounted.current = false; };
  }, [client]);
  const link = self?.code ? `${window.location.origin}/parrainage/${self.code}` : "";
  async function createCode() {
    if (busy || !self) return;
    setBusy(true); setMessage("");
    try {
      const result = await client.ensureReferralCode();
      if (mounted.current) setSelf((current) => current ? { ...current, code: result.code } : null);
    } catch (error) { if (mounted.current) setMessage(referralMessage(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function copyLink() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(link);
      if (mounted.current) setMessage("Lien copié.");
    } catch {
      linkInput.current?.focus(); linkInput.current?.select();
      if (mounted.current) setMessage("Sélectionnez et copiez le lien ci-dessus.");
    }
  }
  const relationLabels = {
    linked: "Invitation associée à votre compte.", pending: "Votre première commande éligible est payée, en attente de livraison.",
    rewarded: "Votre première commande éligible est livrée.", cancelled: "Cet avantage n’est plus actif.", reversed: "Cet avantage a été corrigé.",
  };
  return <section className="mt-6 rounded-lg border border-forest/10 bg-cream p-5" aria-labelledby="referral-title" data-referral-panel>
    <h2 id="referral-title" className="text-xl font-semibold">Parrainage</h2>
    <p className="mt-2">Invitez un proche : 5 € pour lui, 10 € pour vous après sa première commande éligible livrée.</p>
    <p className="mt-2 text-sm text-forest/70">5 € dès 50 € de produits éligibles. Votre récompense de 10 € est validée après paiement et livraison.
      Les promotions sont prioritaires ; la remise filleul ne se cumule pas avec l’utilisation de la cagnotte.</p>
    {self?.code ? <div className="mt-4">
      <p>Votre code : <strong>{self.code}</strong></p>
      <label className="mt-2 block" htmlFor="referral-share-link">Votre lien d’invitation</label>
      <input ref={linkInput} id="referral-share-link" className="input-field w-full" value={link} readOnly />
      <button type="button" className="btn-secondary mt-2" onClick={() => void copyLink()}>Copier le lien</button>
    </div> : self ? <button type="button" className="btn-secondary mt-4" disabled={busy} onClick={() => void createCode()}>Créer mon lien de parrainage</button> : null}
    {self?.relation && <p className="mt-4">{relationLabels[self.relation.state]}</p>}
    {self && self.sponsorSummary.referralsTotal > 0 && <div className="mt-4 text-sm">
      <p>{self.sponsorSummary.referralsTotal} invitation(s) associée(s) · {self.sponsorSummary.pendingCount} en attente · {self.sponsorSummary.rewardedCount} validée(s)</p>
      <p>Récompenses en attente : {formatEuro(self.sponsorSummary.pendingRewardCents / 100)}.</p>
      <p>Récompenses validées : {formatEuro(self.sponsorSummary.validatedRewardCents / 100)}.</p>
      <p className="text-forest/70">Ce montant retrace vos récompenses validées. Le solde utilisable, après éventuelles régularisations, figure dans votre cagnotte.</p>
    </div>}
    <p className="mt-3 text-sm" role="status" aria-live="polite">{busy ? "Chargement du parrainage…" : message}</p>
  </section>;
}
