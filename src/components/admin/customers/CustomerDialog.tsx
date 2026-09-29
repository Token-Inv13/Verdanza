import { useEffect, useState } from "react";
import { AdminDialog } from "../AdminDialog";
import type { Coupon } from "../../../types";
import type { CustomerIdentity, CustomerSummary } from "../../../types/adminCustomers";
import { CustomerOverview } from "./CustomerOverview";
import { CustomerOrders } from "./CustomerOrders";
import { CustomerLoyalty } from "./CustomerLoyalty";
import { CustomerReferral } from "./CustomerReferral";
import { CustomerActivity } from "./CustomerActivity";
import { CustomerAdministration } from "./CustomerAdministration";
import { ResourceState } from "./CustomerResource";
import { useCustomerRead } from "../../../hooks/useAdminCustomerResource";

const tabs = ["Vue générale", "Commandes", "Fidélité", "Parrainage", "Activité", "Administration"] as const;
export function CustomerDialog({ customer, coupons, onClose, onChanged, onSummary }: { customer: CustomerIdentity; coupons: Coupon[]; onClose: () => void; onChanged: () => void; onSummary: (summary: CustomerSummary) => void }) {
  const summary = useCustomerRead<CustomerSummary>("adminCustomerSummary", customer.id);
  const [tab, setTab] = useState(0), [visited, setVisited] = useState([0]), [busy, setBusy] = useState(false);
  useEffect(() => { if (summary.data) onSummary(summary.data); }, [summary.data, onSummary]);
  const current = summary.data?.customer || customer;
  function changeTab(index: number) { setTab(index); setVisited((previous) => previous.includes(index) ? previous : [...previous, index]); }
  function changed() { summary.reload(); onChanged(); }
  return <AdminDialog open title={current.name || current.email || "Fiche client"} size="xl" pending={busy} onClose={onClose} description={<span className="break-all">{current.email || "Non disponible"} · {current.archived ? "archived" : current.status || "Non disponible"} · #{current.id.slice(0, 12)}{current.hidden ? " · Masqué" : ""}</span>}>
    <nav aria-label="Sections de la fiche client" className="mb-5 flex flex-wrap gap-2">{tabs.map((label, index) => <button key={label} type="button" aria-current={tab === index ? "page" : undefined} disabled={busy} className={tab === index ? "btn-primary" : "btn-secondary"} onClick={() => changeTab(index)}>{label}</button>)}</nav>
    <ResourceState pending={summary.pending} error={summary.error} onRetry={summary.reload} />
    {summary.data && tabs.map((label, index) => visited.includes(index) && <section key={label} hidden={tab !== index} aria-label={label}>
      {index === 0 && <CustomerOverview summary={summary.data!} />}{index === 1 && <CustomerOrders customerId={customer.id} />}{index === 2 && <CustomerLoyalty customer={current} />}{index === 3 && <CustomerReferral customerId={customer.id} />}{index === 4 && <CustomerActivity customerId={customer.id} />}{index === 5 && <CustomerAdministration customer={current} coupons={coupons} onChanged={changed} onBusy={setBusy} />}
    </section>)}
  </AdminDialog>;
}
