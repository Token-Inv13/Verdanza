import type { ReactNode } from "react";
export function ResourceState({ pending, error, empty, onRetry, children }: { pending: boolean; error: string; empty?: boolean; onRetry: () => void; children?: ReactNode }) {
  return <>{pending && <p role="status">Chargement…</p>}{error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error} <button type="button" className="underline" onClick={onRetry}>Réessayer</button></div>}{!pending && !error && empty && <p className="rounded-xl bg-cream p-4">Aucun historique disponible.</p>}{children}</>;
}
export function MoreButton({ cursor, pending, onClick }: { cursor: string | null; pending: boolean; onClick: () => void }) { return cursor ? <button type="button" className="btn-secondary mt-4" disabled={pending} onClick={onClick}>Charger la suite</button> : null; }
export function Metric({ label, value }: { label: string; value: ReactNode }) { return <div className="min-w-0 rounded-xl border border-forest/10 bg-cream/50 p-4"><dt className="text-xs text-ink/65">{label}</dt><dd className="mt-1 break-words text-sm font-semibold">{value}</dd></div>; }
