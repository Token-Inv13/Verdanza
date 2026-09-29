import type { FormEvent } from "react";
import type { ContestInput } from "../../../types/contests";
import { marketingLocalToIso, marketingLocalValue } from "../../../lib/adminMarketingDates";

export function ContestEditor({ value, onChange, onSubmit }: { value: ContestInput; onChange: (value: ContestInput) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const field = <K extends keyof ContestInput>(key: K, v: ContestInput[K]) => onChange({ ...value, [key]: v });
  return <form onSubmit={onSubmit} className="grid gap-4">
    <label className="text-sm">Titre<input className="input-field mt-1" value={value.title} onChange={(e) => field("title", e.target.value)} /></label>
    <label className="text-sm">Slug<input className="input-field mt-1" value={value.slug} onChange={(e) => field("slug", e.target.value)} /></label>
    <label className="text-sm">Description<textarea className="input-field mt-1 min-h-24" value={value.description} onChange={(e) => field("description", e.target.value)} /></label>
    <div className="grid gap-4 sm:grid-cols-3">{([["startAt", "Début"], ["endAt", "Fin"], ["drawAt", "Tirage prévu"]] as const).map(([key, label]) => <label key={key} className="text-sm">{label} (Europe/Paris)<input type="datetime-local" className="input-field mt-1" value={marketingLocalValue(value[key])} onChange={(e) => field(key, marketingLocalToIso(e.target.value))} /></label>)}</div>
    <div className="grid gap-4 sm:grid-cols-3"><label className="text-sm">Type de lot<select className="input-field mt-1" value={value.prizeType} onChange={() => field("prizeType", "store_credit")}><option value="store_credit">Bon / crédit Verdanza</option></select></label><label className="text-sm">Valeur du lot (EUR)<input type="number" min="0.01" step="0.01" className="input-field mt-1" value={value.prizeValue} onChange={(e) => field("prizeValue", Number(e.target.value))} /></label><label className="text-sm">Expiration du gain (jours)<input type="number" min="1" max="365" className="input-field mt-1" value={value.prizeExpirationDays} onChange={(e) => field("prizeExpirationDays", Number(e.target.value))} /></label></div>
    <label className="text-sm">Conditions d'éligibilité<textarea className="input-field mt-1 min-h-20" value={value.eligibilityConditions} onChange={(e) => field("eligibilityConditions", e.target.value)} /></label>
    <label className="text-sm">Lien vers le règlement<input type="url" className="input-field mt-1" value={value.rulesUrl || ""} onChange={(e) => field("rulesUrl", e.target.value)} /></label>
    <label className="text-sm">Règlement<textarea className="input-field mt-1 min-h-32" value={value.rulesText || ""} onChange={(e) => field("rulesText", e.target.value)} /></label>
    <button className="btn-primary" type="submit">Enregistrer le brouillon privé</button>
  </form>;
}
