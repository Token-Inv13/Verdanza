export function eurosInputToCents(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return 0;
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(normalized)) throw new Error("Montant en euros invalide.");
  const [euros, decimals = ""] = normalized.split(".");
  const result = Number(euros) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new Error("Montant en euros invalide.");
  return result;
}

export async function runCagnotteAdminLocked(
  lock: { current: boolean },
  run: () => Promise<void>,
  fail: (error: unknown) => void,
) {
  if (lock.current) return;
  lock.current = true;
  try { await run(); } catch (error) { fail(error); } finally { lock.current = false; }
}

export async function refreshCagnotteAdminAfterWrite(
  reloadInspection: () => Promise<void>,
  reloadOrder?: () => Promise<void> | void,
) {
  await Promise.all([
    reloadInspection(),
    Promise.resolve(reloadOrder?.()),
  ]);
}

export function createCagnotteAdminRefreshChannel() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    subscribe(orderId: string, listener: () => void) {
      const orderListeners = listeners.get(orderId) ?? new Set<() => void>();
      orderListeners.add(listener);
      listeners.set(orderId, orderListeners);
      return () => {
        orderListeners.delete(listener);
        if (!orderListeners.size) listeners.delete(orderId);
      };
    },
    publish(orderId: string, source?: () => void) {
      for (const listener of listeners.get(orderId) ?? []) {
        if (listener !== source) listener();
      }
    },
  };
}

export function createCagnotteAdminResponseIdentity() {
  let current = 0;
  return {
    next() { current += 1; return current; },
    isCurrent(value: number) { return value === current; },
    invalidate() { current += 1; },
  };
}
