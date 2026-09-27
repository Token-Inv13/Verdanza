/** Every pricing read joins the caller's transaction; no nested transaction or write. */
export function transactionalReader(db: FirebaseFirestore.Firestore, transaction: FirebaseFirestore.Transaction): FirebaseFirestore.Firestore {
  const wrap = <T extends object>(target: T): T => new Proxy(target, {
    get(current, key, receiver) {
      if (key === "get") return () => transaction.get(current as never);
      const value = Reflect.get(current, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = Reflect.apply(value, current, args);
        return result && typeof result === "object" ? wrap(result) : result;
      };
    },
  });
  return new Proxy(db, {
    get(current, key, receiver) {
      if (key === "collection") return (path: string) => wrap(current.collection(path));
      return Reflect.get(current, key, receiver);
    },
  });
}
