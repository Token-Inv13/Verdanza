import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { referralClient, type ReferralClient } from "../../services/referralService";
import { referralMessage } from "./referralMessages";

export function ReferralInvitation({ code, client = referralClient }: { code: string; client?: ReferralClient }) {
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function associate() {
    if (busy || linked) return;
    setBusy(true); setMessage("");
    try { await client.linkReferralCode(code); if (mounted.current) setLinked(true); }
    catch (error) { if (mounted.current) setMessage(referralMessage(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <section className="rounded-lg border border-forest/10 bg-cream p-6">
    <h1>Vous avez reçu une invitation Verdanza</h1>
    <p className="mt-3">Profitez de 5 € de remise sur votre première commande dès 50 € de produits éligibles.
      Les promotions sont prioritaires et cet avantage ne se cumule pas avec l’utilisation de la cagnotte.</p>
    {linked ? <><p className="mt-4" role="status">Invitation associée à votre compte.</p>
      <Link className="btn-primary mt-4" to="/boutique">Découvrir la boutique</Link></> :
      <button type="button" className="btn-primary mt-4" disabled={busy} onClick={() => void associate()}>Associer cette invitation à mon compte</button>}
    <p className="mt-3" role="status" aria-live="polite">{busy ? "Association en cours…" : message}</p>
  </section>;
}
