import { Link } from "react-router-dom";
import type { CustomerOrder } from "../../../types/adminCustomers";
import { MoreButton, ResourceState } from "./CustomerResource";
import { useCustomerPage } from "../../../hooks/useAdminCustomerResource";
import { centsLabel, dateLabel } from "../../../lib/adminCustomersV2";
export function CustomerOrders({ customerId }: { customerId: string }) {
  const resource = useCustomerPage<CustomerOrder>("adminCustomerOrders", customerId);
  return <div><p className="mb-4 text-sm text-ink/65">Les rapprochements probables sont séparés des liens UID et exclus des totaux. Pagination par identifiant persistant.</p><ResourceState pending={resource.pending} error={resource.error} empty={!resource.items.length} onRetry={resource.reload} />
    <div className="space-y-3">{resource.items.map((order) => <article key={order.id} className="rounded-xl border border-forest/15 p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{order.reference}</strong><span className={order.confidence === "confirmed" ? "text-sm text-forest" : "text-sm text-amber-800"}>{order.confidence === "confirmed" ? "Lien confirmé" : "Rapprochement probable"}</span></div><p className="mt-1 text-sm">{dateLabel(order.date)} · {order.status || "Non disponible"} · Paiement : {order.paymentStatus || "Non disponible"}</p>
      {order.confidence === "probable" && <p className="mt-2 text-sm text-amber-800">Cette commande est rapprochée par {order.match === "email" ? "email" : "téléphone"}, sans lien UID confirmé.</p>}
      <dl className="my-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[["Commandé", order.totalCents], ["Payé hors cagnotte", order.paidCents], ["Cagnotte prévue/utilisée", order.cagnotteCents], ["Remboursé hors cagnotte", order.refundedCents]].map(([label, cents]) => <div key={String(label)}><dt className="text-xs text-ink/60">{label}</dt><dd>{centsLabel(cents as number | null)}</dd></div>)}</dl><Link className="text-sm font-semibold text-forest underline" to={`/admin/commandes?search=${encodeURIComponent(order.id)}`}>Consulter le détail dans Commandes</Link>
    </article>)}</div><MoreButton cursor={resource.nextCursor} pending={resource.pending} onClick={() => void resource.loadMore()} />
  </div>;
}
