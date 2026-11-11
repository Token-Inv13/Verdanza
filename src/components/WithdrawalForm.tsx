import { type FormEvent, useEffect, useRef, useState } from "react";
import { publicSubmissionSecurityContext } from "../lib/publicSubmissionSecurity";
import { withdrawalStatement, type WithdrawalReceipt } from "../lib/withdrawal";

export function WithdrawalForm({ contactEmail }: { contactEmail: string }) {
  const [details, setDetails] = useState({ name: "", email: "", contract: "", items: "" });
  const [company, setCompany] = useState("");
  const [phase, setPhase] = useState<"details" | "review" | "received">("details");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<WithdrawalReceipt>();
  const [receiptEmailSent, setReceiptEmailSent] = useState(false);
  const startedAt = useRef(Date.now());
  const pending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (phase !== "details") heading.current?.focus(); }, [phase]);

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/contact", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          withdrawal: { ...details, confirmed: true }, company,
          submissionSecurity: publicSubmissionSecurityContext(startedAt.current),
        }),
      });
      const payload = await response.json() as {
        accepted?: boolean; receipt?: WithdrawalReceipt; receiptEmailSent?: boolean; error?: string;
      };
      if (!response.ok || !payload.accepted || !payload.receipt?.id || !payload.receipt?.text) {
        throw new Error(payload.error || "Déclaration non transmise. Vous pouvez aussi nous écrire par e-mail.");
      }
      setReceipt(payload.receipt);
      setReceiptEmailSent(payload.receiptEmailSent === true);
      setPhase("received");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Déclaration non transmise.");
    } finally {
      pending.current = false;
      setSending(false);
    }
  }

  return (
    <section id="retractation" className="mt-10 rounded-lg border border-forest/10 bg-cream p-6" aria-labelledby="withdrawal-title">
      <h2 id="withdrawal-title" ref={heading} tabIndex={-1} className="font-display text-3xl text-forest">
        {phase === "received" ? "Votre rétractation a été transmise" : "Renoncer au contrat ici"}
      </h2>
      {phase === "received" && receipt ? (
        <div className="mt-4 space-y-4" role="status">
          <p>Votre déclaration est reçue. L’adresse de retour vous sera communiquée directement.</p>
          <p>{receiptEmailSent ? "Un accusé de réception a été envoyé à votre adresse e-mail." : "La copie par e-mail n’a pas pu être envoyée. Conservez l’accusé de réception ci-dessous ; votre déclaration est déjà reçue."}</p>
          <p>Envoyée le {new Date(receipt.submittedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} (heure de Paris).</p>
          <a className="underline" download="verdanza-accuse-retractation.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(receipt.text)}`}>Télécharger mon accusé de réception</a>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm">{receipt.text}</pre>
        </div>
      ) : phase === "review" ? (
        <form className="mt-4 space-y-4" onSubmit={confirm} aria-busy={sending}>
          <p>Vérifiez votre déclaration avant de l’envoyer à Verdanza.</p>
          <dl className="space-y-2 break-words">
            <div><dt className="font-semibold">Nom et prénom</dt><dd>{details.name}</dd></div>
            <div><dt className="font-semibold">Accusé de réception par e-mail</dt><dd>{details.email}</dd></div>
          </dl>
          <p className="break-words">{withdrawalStatement(details)}</p>
          {error && <p role="alert" className="text-red-700">{error} <a className="underline" href={`mailto:${contactEmail}`}>{contactEmail}</a></p>}
          <div className="flex flex-wrap gap-4">
            <button type="button" disabled={sending} className="underline" onClick={() => { setPhase("details"); setError(""); }}>Modifier ma déclaration</button>
            <button type="submit" disabled={sending} className="rounded bg-forest px-5 py-3 text-white disabled:opacity-60">{sending ? "Envoi en cours…" : "Confirmer la rétractation"}</button>
          </div>
        </form>
      ) : (
        <form className="mt-4 grid gap-4" onSubmit={(event) => { event.preventDefault(); setPhase("review"); }}>
          <p>Sans compte et sans justificatif du motif. Indiquez la commande concernée et l’adresse e-mail à laquelle recevoir votre accusé de réception.</p>
          <label className="grid gap-1" htmlFor="withdrawal-name">Nom et prénom
            <input id="withdrawal-name" name="name" autoComplete="name" required minLength={2} maxLength={120} className="rounded border border-forest/20 bg-white p-3" value={details.name} onChange={(event) => setDetails({ ...details, name: event.target.value })} />
          </label>
          <label className="grid gap-1" htmlFor="withdrawal-email">E-mail pour l’accusé de réception
            <input id="withdrawal-email" name="email" type="email" autoComplete="email" required maxLength={254} className="rounded border border-forest/20 bg-white p-3" value={details.email} onChange={(event) => setDetails({ ...details, email: event.target.value })} />
          </label>
          <label className="grid gap-1" htmlFor="withdrawal-contract">Référence de commande ou informations pour l’identifier
            <input id="withdrawal-contract" name="contract" required maxLength={300} aria-describedby="withdrawal-contract-help" className="rounded border border-forest/20 bg-white p-3" value={details.contract} onChange={(event) => setDetails({ ...details, contract: event.target.value })} />
          </label>
          <p id="withdrawal-contract-help" className="text-sm">Par exemple : numéro de commande ou date d’achat et produits commandés. Ne transmettez aucune donnée bancaire.</p>
          <label className="grid gap-1" htmlFor="withdrawal-items">Produits concernés si le retour est partiel (facultatif)
            <textarea id="withdrawal-items" name="items" rows={3} maxLength={1000} className="rounded border border-forest/20 bg-white p-3" value={details.items} onChange={(event) => setDetails({ ...details, items: event.target.value })} />
          </label>
          <div className="hidden" aria-hidden="true"><label htmlFor="withdrawal-company">Société<input id="withdrawal-company" tabIndex={-1} autoComplete="off" value={company} onChange={(event) => setCompany(event.target.value)} /></label></div>
          <p className="text-sm">Ces informations servent à traiter votre rétractation et à vous en envoyer l’accusé de réception. <a className="underline" href="/confidentialite">Protection de vos données</a>.</p>
          <button type="submit" className="justify-self-start rounded bg-forest px-5 py-3 text-white">Vérifier ma déclaration</button>
        </form>
      )}
    </section>
  );
}
