import { useCallback, useEffect, useRef, useState } from "react";
import { readAdminCustomers } from "../services/adminCustomersV2Service";
import type { CustomerAudit, CustomerMetadata, CustomerPage } from "../types/adminCustomers";

type Snapshot = {
  customerId: string;
  version: number;
  data: CustomerMetadata | null;
  audit: CustomerPage<CustomerAudit>;
  pending: boolean;
  error: string;
  pagePending: boolean;
  pageError: string;
};
type RequestScope = {
  customerId: string;
  version: number;
  active: boolean;
  initial: AbortController;
  page: AbortController | null;
  inFlight: boolean;
};

function uniqueEntries(items: CustomerAudit[]): CustomerAudit[] {
  const ids = new Set<string>();
  return items.filter((entry) => {
    if (ids.has(entry.id)) return false;
    ids.add(entry.id);
    return true;
  });
}
function stop(scope: RequestScope | null) {
  if (!scope) return;
  scope.active = false;
  scope.initial.abort();
  scope.page?.abort();
}
function initialSnapshot(customerId: string, version: number): Snapshot {
  return { customerId, version, data: null, audit: { items: [], nextCursor: null }, pending: true, error: "", pagePending: false, pageError: "" };
}

/** Metadata is refreshed without a cursor; only audit entries accumulate. */
export function useAdminCustomerAudit(customerId: string) {
  const [version, setVersion] = useState(0);
  const [snapshot, setSnapshot] = useState(() => initialSnapshot(customerId, 0));
  const scopeRef = useRef<RequestScope | null>(null);
  const current = snapshot.customerId === customerId && snapshot.version === version;
  const visible = current ? snapshot : initialSnapshot(customerId, version);

  const reload = useCallback(() => {
    // Invalidate responses immediately, including before the next effect runs.
    stop(scopeRef.current);
    setVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    const scope: RequestScope = { customerId, version, active: true, initial: new AbortController(), page: null, inFlight: false };
    scopeRef.current = scope;
    setSnapshot(initialSnapshot(customerId, version));
    void readAdminCustomers<CustomerMetadata>("adminCustomerMetadata", { customerId }, scope.initial.signal)
      .then((data) => {
        if (!scope.active) return;
        setSnapshot((value) => scope.active && value.customerId === customerId && value.version === version
          ? { ...initialSnapshot(customerId, version), data, audit: { ...data.audit, items: uniqueEntries(data.audit.items) }, pending: false }
          : value);
      })
      .catch((cause) => {
        if (!scope.active) return;
        setSnapshot((value) => scope.active && value.customerId === customerId && value.version === version
          ? { ...initialSnapshot(customerId, version), pending: false, error: cause instanceof Error ? cause.message : "Données indisponibles." }
          : value);
      });
    return () => stop(scope);
  }, [customerId, version]);

  const loadMore = useCallback(async () => {
    const scope = scopeRef.current;
    const cursor = visible.audit.nextCursor;
    if (!scope?.active || scope.customerId !== customerId || scope.version !== version || !cursor || visible.pending || scope.inFlight) return;
    scope.inFlight = true;
    scope.page = new AbortController();
    setSnapshot((value) => scope.active && value.customerId === customerId && value.version === version
      ? { ...value, pagePending: true, pageError: "" }
      : value);
    try {
      const result = await readAdminCustomers<CustomerMetadata>("adminCustomerMetadata", { customerId, cursor }, scope.page.signal);
      if (!scope.active) return;
      setSnapshot((value) => scope.active && value.customerId === customerId && value.version === version
        ? { ...value, audit: { items: uniqueEntries([...value.audit.items, ...result.audit.items]), nextCursor: result.audit.nextCursor }, pageError: "" }
        : value);
    } catch (cause) {
      if (scope.active) setSnapshot((value) => scope.active && value.customerId === customerId && value.version === version
        ? { ...value, pageError: cause instanceof Error ? cause.message : "Page indisponible." }
        : value);
    } finally {
      scope.inFlight = false;
      if (scope.active) setSnapshot((value) => scope.active && value.customerId === customerId && value.version === version
        ? { ...value, pagePending: false }
        : value);
    }
  }, [customerId, version, visible.audit.nextCursor, visible.pending]);

  return { ...visible, reload, loadMore };
}
