import { useCallback, useEffect, useRef, useState } from "react";
import { readAdminCustomers } from "../services/adminCustomersV2Service";
import type { CustomerPage } from "../types/adminCustomers";

export function useCustomerRead<T>(action: string, customerId: string, extra: Record<string, string> = {}) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(""), [pending, setPending] = useState(false), [version, setVersion] = useState(0);
  const extraKey = JSON.stringify(extra);
  const reload = useCallback(() => setVersion((current) => current + 1), []);
  useEffect(() => {
    const controller = new AbortController(); setPending(true); setError("");
    void readAdminCustomers<T>(action, { ...(customerId ? { customerId } : {}), ...JSON.parse(extraKey) }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Données indisponibles."); })
      .finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [action, customerId, extraKey, version]);
  return { data, error, pending, reload };
}
export function useCustomerPage<T, P extends CustomerPage<T> = CustomerPage<T>>(action: string, customerId: string, extra: Record<string, string> = {}) {
  const resource = useCustomerRead<P>(action, customerId, extra);
  const [more, setMore] = useState<T[]>([]), [cursor, setCursor] = useState<string | null>(null), [error, setError] = useState(""), [pending, setPending] = useState(false);
  const alive = useRef(true), inFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setMore([]); setCursor(resource.data?.nextCursor || null); setError(""); }, [resource.data]);
  async function loadMore() {
    if (!cursor || inFlight.current) return;
    inFlight.current = true; setPending(true); setError("");
    try { const next = await readAdminCustomers<P>(action, { customerId, ...extra, cursor }); if (alive.current) { setMore((items) => [...items, ...next.items]); setCursor(next.nextCursor); } }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Page indisponible."); }
    finally { inFlight.current = false; if (alive.current) setPending(false); }
  }
  return { ...resource, items: [...(resource.data?.items || []), ...more], nextCursor: cursor, error: resource.error || error, pending: resource.pending || pending, loadMore };
}
