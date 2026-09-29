import { useState } from "react";
import { Link } from "react-router-dom";
import type { CustomerActivityItem } from "../../../types/adminCustomers";
import { MoreButton, ResourceState } from "./CustomerResource";
import { useCustomerPage } from "../../../hooks/useAdminCustomerResource";
import { dateLabel } from "../../../lib/adminCustomersV2";
function ActivityStream({ customerId, kind }: { customerId: string; kind: CustomerActivityItem["kind"] }) {
  const resource = useCustomerPage<CustomerActivityItem>("adminCustomerActivity", customerId, { kind });
  const dates = resource.items.map((item) => item.date).filter((value): value is string => !!value).sort();
  return <div><p className="my-4 text-sm text-ink/65">Dernière activité connue parmi les événements chargés : {dateLabel(dates.slice(-1)[0] || null)}. Les événements sans date restent indiqués comme indisponibles.</p><ResourceState pending={resource.pending} error={resource.error} empty={!resource.items.length} onRetry={resource.reload} /><ul className="space-y-3">{resource.items.map((item) => <li key={item.id} className="rounded-xl border border-forest/15 p-4"><p className="text-xs text-ink/60">{item.kind} · {dateLabel(item.date)}</p><p className="mt-2 break-words text-sm">{item.summary}</p>{item.href && <Link to={item.href} className="mt-2 inline-block text-sm text-forest underline">Consulter le contenu</Link>}</li>)}</ul><MoreButton cursor={resource.nextCursor} pending={resource.pending} onClick={() => void resource.loadMore()} /></div>;
}
export function CustomerActivity({ customerId }: { customerId: string }) {
  const [kind, setKind] = useState<CustomerActivityItem["kind"]>("orders"); const labels = { orders: "Commandes", favorites: "Favoris", reviews: "Avis", comments: "Commentaires" };
  return <div><label className="text-sm">Type d’activité<select className="input-field ml-3" value={kind} onChange={(event) => setKind(event.target.value as CustomerActivityItem["kind"])}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><ActivityStream key={kind} customerId={customerId} kind={kind} /></div>;
}
