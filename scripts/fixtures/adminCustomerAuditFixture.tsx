import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { CustomerAdministration } from "../../src/components/admin/customers/CustomerAdministration";
import type { CustomerAudit, CustomerIdentity, CustomerMetadata, CustomerMutation } from "../../src/types/adminCustomers";
import "../../src/styles/index.css";

export type AuditFixtureState = {
  customers: CustomerIdentity[];
  metadata: Record<string, CustomerMetadata>;
  entries: Record<string, CustomerAudit[]>;
  requests: { customerId: string; cursor: string | null }[];
  mutations: CustomerMutation[];
  failNextPage: boolean;
  holdNextPage: boolean;
  release: () => void;
  settled: number;
  aborted: number;
};
declare global { interface Window { customerAuditFixture: AuditFixtureState } }

export function AuditFixture() {
  const [customerId, setCustomerId] = useState("alice");
  const [mounted, setMounted] = useState(true);
  const customer = window.customerAuditFixture.customers.find((item) => item.id === customerId)!;
  return <main className="mx-auto max-w-4xl p-4">
    <nav className="mb-4 flex flex-wrap gap-3">
      <button onClick={() => setCustomerId("alice")}>Client Alice</button>
      <button onClick={() => setCustomerId("bob")}>Client Bob</button>
      <button onClick={() => setMounted((value) => !value)}>{mounted ? "Démonter" : "Remonter"}</button>
    </nav>
    {mounted && <CustomerAdministration customer={customer} coupons={[]} onChanged={() => {}} onBusy={() => {}} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><AuditFixture /></StrictMode>);
