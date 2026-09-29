import { lazy, Suspense } from "react";
import { CAGNOTTE_READ_DISPLAY_ENABLED } from "../../../config/cagnotteFeatures";
import type { CustomerIdentity, CustomerLegacyLoyalty } from "../../../types/adminCustomers";
import { MoreButton, ResourceState } from "./CustomerResource";
import { useCustomerPage } from "../../../hooks/useAdminCustomerResource";
import { dateLabel } from "../../../lib/adminCustomersV2";
const Wallet = CAGNOTTE_READ_DISPLAY_ENABLED ? lazy(() => import("../../cagnotte/CagnottePanel").then((module) => ({ default: module.CagnottePanel }))) : null;
export function CustomerLoyalty({ customer }: { customer: CustomerIdentity }) {
  const resource = useCustomerPage<CustomerLegacyLoyalty["items"][number], CustomerLegacyLoyalty>("adminCustomerLoyalty", customer.id);
  return <div className="space-y-6"><section><h3 className="text-lg font-semibold">Points historiques</h3><p className="mt-2">{resource.data?.points == null ? "Non disponible" : `${resource.data.points} points`} · ces points sont distincts des euros de cagnotte.</p>{resource.data?.source === "profile_history" && <p className="text-sm text-amber-800">Ancien historique du profil : les 20 dernières entrées seulement.</p>}<ResourceState pending={resource.pending} error={resource.error} empty={!resource.items.length} onRetry={resource.reload} /><ul className="mt-3 space-y-2">{resource.items.map((item) => <li key={item.id} className="rounded-lg bg-cream p-3 text-sm">{item.points === null ? "Non disponible" : `${item.points > 0 ? "+" : ""}${item.points} points`} · {item.reason || "Non disponible"} · {dateLabel(item.date)}</li>)}</ul><MoreButton cursor={resource.nextCursor} pending={resource.pending} onClick={() => void resource.loadMore()} /></section>
    <section><h3 className="mb-3 text-lg font-semibold">Cagnotte en euros — consultation</h3>{Wallet ? <Suspense fallback={<p role="status">Chargement de la cagnotte…</p>}><Wallet enabled identityKey={`customer-v2:${customer.id}:${customer.uid}`} scope="admin" targetUid={customer.uid} customerLabel={customer.name || customer.email || customer.id} /></Suspense> : <p>Non disponible. La consultation de la cagnotte est désactivée.</p>}</section></div>;
}
