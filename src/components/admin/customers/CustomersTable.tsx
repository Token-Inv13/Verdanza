import { useCallback, useMemo, useState } from "react";
import { available, filterCustomers, type CustomerFilter } from "../../../lib/adminCustomersV2";
import type { Coupon } from "../../../types";
import type { CustomerIdentity, CustomerSummary } from "../../../types/adminCustomers";
import { CustomerDialog } from "./CustomerDialog";
import { MoreButton, ResourceState } from "./CustomerResource";
import { useCustomerPage } from "../../../hooks/useAdminCustomerResource";
import { centsLabel, dateLabel } from "../../../lib/adminCustomersV2";

const filters: [CustomerFilter, string][] = [["active", "Actifs et visibles"], ["all", "Tous"], ["new", "Nouveaux"], ["loyal", "Fidèles"], ["watch", "À surveiller"], ["withOrders", "Avec commandes déclarées"], ["withoutOrders", "Sans commande déclarée"], ["withNote", "Avec note"], ["withPromo", "Avec code promo"], ["archived", "Archivés"]];
export function CustomersTable({ coupons, couponAvailable = true }: { coupons: Coupon[]; couponAvailable?: boolean }) {
  const resource = useCustomerPage<CustomerIdentity>("adminCustomersList", "");
  const [search, setSearch] = useState(""), [filter, setFilter] = useState<CustomerFilter>("active"), [sort, setSort] = useState("created"), [selected, setSelected] = useState<CustomerIdentity | null>(null);
  const [summaries, setSummaries] = useState<Record<string, CustomerSummary>>({});
  const recordSummary = useCallback((summary: CustomerSummary) => setSummaries((current) => ({ ...current, [summary.customer.id]: summary })), []);
  const items = useMemo(() => filterCustomers(resource.items, search, filter, sort), [resource.items, search, filter, sort]);
  return <section className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-2xl">Clients</h2><p className="mt-1 text-sm text-ink/65">{resource.primaryError || resource.primaryPending ? "Profils indisponibles pendant la lecture" : `${resource.items.length} profils chargés · recherche et tri sur ces profils${resource.nextCursor ? " · d’autres profils restent à charger" : ""}`}.</p></div><button type="button" className="btn-secondary" onClick={resource.reload}>Actualiser</button></div>
    <div className="grid gap-3 md:grid-cols-3"><label className="text-sm">Rechercher<input className="input-field mt-1 w-full" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nom, email, téléphone ou tag" /></label><label className="text-sm">Filtrer<select className="input-field mt-1 w-full" value={filter} onChange={(event) => setFilter(event.target.value as CustomerFilter)}>{filters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm">Trier<select className="input-field mt-1 w-full" value={sort} onChange={(event) => setSort(event.target.value)}><option value="created">Création du compte</option><option value="name">Nom</option><option value="orders">Commandes déclarées</option><option value="ordered">Montant historique déclaré</option><option value="points">Points historiques</option><option value="lastOrder">Dernière commande connue</option></select></label></div>
    <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Les compteurs déclarés sont historiques. Les paiements, remboursements et dates d’activité sont vérifiés dans la fiche ; une information inconnue reste « Non disponible ».</p>
    <ResourceState pending={resource.primaryPending} error={resource.primaryError} empty={!items.length} onRetry={resource.reload}>
      <div className="grid gap-3 xl:grid-cols-2">{[...items].sort((left, right) => sort === "lastOrder" ? (summaries[right.id]?.metrics.lastOrderAt || "").localeCompare(summaries[left.id]?.metrics.lastOrderAt || "") : 0).map((customer) => {
        const observed = summaries[customer.id]; const current = observed?.customer || customer; const metrics = observed?.metrics;
        return <button key={customer.id} type="button" className="min-w-0 rounded-2xl border border-forest/15 bg-white p-5 text-left shadow-sm transition hover:border-forest/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest" onClick={() => setSelected(current)}>
        <div className="flex flex-wrap items-start justify-between gap-2"><strong className="break-words">{current.name || current.email || current.id.slice(0, 12)}</strong><span className="rounded-full bg-cream px-3 py-1 text-xs">{current.archived ? "archived" : available(current.status)}{current.hidden ? " · masqué" : ""}</span></div>
        <p className="mt-2 break-all text-sm text-ink/70">{available(current.email)} · {available(current.phone)}</p>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">{[["Commandes confirmées", metrics?.count == null ? "Non disponible" : String(metrics.count)], ["Commandé vérifié", centsLabel(metrics?.orderedCents ?? null)], ["Payé hors cagnotte", centsLabel(metrics?.paidCents ?? null)], ["Panier moyen vérifié", centsLabel(metrics?.averageCents ?? null)], ["Cagnotte", "Non disponible"], ["Parrainage", "Non disponible"], ["Dernière commande connue", dateLabel(metrics?.lastOrderAt || null)], ["Dernière activité connue", dateLabel(observed?.lastActivityAt || null)]].map(([label, value]) => <div key={label}><dt className="text-ink/60">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}</dl>
        <p className="mt-3 text-xs text-ink/60">Historique déclaré : {current.historicalOrderCount === null ? "Non disponible" : `${current.historicalOrderCount} commandes`} · {centsLabel(current.historicalOrderedCents)}</p>
        {!!current.tags.length && <p className="mt-3 text-xs text-forest">{current.tags.join(" · ")}</p>}<span className="mt-4 inline-block text-sm font-semibold text-forest">Ouvrir la fiche →</span>
      </button>; })}</div>
    </ResourceState>{resource.pageError && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Page suivante indisponible : {resource.pageError} <button type="button" className="font-semibold underline" onClick={() => void resource.loadMore()}>Réessayer la page</button></p>}<MoreButton cursor={resource.primaryError ? null : resource.nextCursor} pending={resource.pending} onClick={() => void resource.loadMore()} />
    {selected && !resource.primaryError && <CustomerDialog key={selected.id} customer={selected} coupons={coupons} couponAvailable={couponAvailable} onClose={() => setSelected(null)} onChanged={resource.reload} onSummary={recordSummary} />}
  </section>;
}
