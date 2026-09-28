import type { Firestore } from "firebase-admin/firestore";

/** The dry-run engine receives only read capabilities, including snapshot references.
 * SDK arguments are unwrapped internally; no write method can reach Firestore. */
export function referralReadOnlyFirestore(db: Firestore): Firestore {
  const originals = new WeakMap<object, object>();
  const views = new WeakMap<object, object>();
  const readChains = new Set(["collection", "doc", "orderBy", "where", "select", "limit", "startAfter"]);
  const values = new Set(["projectId", "id", "path", "exists", "empty", "size", "readTime", "createTime", "updateTime"]);
  const unwrap = (value: unknown) => value && typeof value === "object" ? originals.get(value) ?? value : value;
  function view(target: object): object {
    const prior = views.get(target);
    if (prior) return prior;
    const proxy = new Proxy(target, {
      get(source, key) {
        if (typeof key !== "string") throw new Error("referral_maintenance_read_only");
        if (key === "then") return undefined;
        if (!values.has(key) && !readChains.has(key) && !["docs", "ref", "data", "get", "getAll", "runTransaction"].includes(key))
          throw new Error("referral_maintenance_read_only");
        const value = Reflect.get(source, key);
        if (values.has(key)) return value;
        if (key === "docs") return (value as object[]).map(view);
        if (key === "ref") return view(value as object);
        if (key === "data") return () => (value as () => unknown).call(source);
        if (readChains.has(key)) return (...args: unknown[]) => view((value as (...args: unknown[]) => object).apply(source, args.map(unwrap)));
        if (key === "get") return async (...args: unknown[]) => view(await (value as (...args: unknown[]) => Promise<object>).apply(source, args.map(unwrap)));
        if (key === "getAll") return async (...args: unknown[]) => (await (value as (...args: unknown[]) => Promise<object[]>).apply(source, args.map(unwrap))).map(view);
        if (key === "runTransaction") return (work: (transaction: object) => Promise<unknown>) =>
          (value as (work: (transaction: object) => Promise<unknown>, options: { readOnly: true }) => Promise<unknown>)
            .call(source, (transaction) => work(view(transaction)), { readOnly: true });
        throw new Error("referral_maintenance_read_only");
      },
      set() { throw new Error("referral_maintenance_read_only"); },
      defineProperty() { throw new Error("referral_maintenance_read_only"); },
      deleteProperty() { throw new Error("referral_maintenance_read_only"); },
    });
    originals.set(proxy, target); views.set(target, proxy);
    return proxy;
  }
  return view(db) as Firestore;
}
