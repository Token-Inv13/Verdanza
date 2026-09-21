type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CheckoutStorage = ReturnType<typeof createCheckoutStorage>;

// Stores are obtained lazily, preserving the public page's existing storage timing.
export function createCheckoutStorage(options: {
  local: () => Store;
  session: () => Store;
  randomUUID: () => string;
  keys: { coupon: string; request: string; summary: string };
}) {
  return {
    readCoupon: () => options.local().getItem(options.keys.coupon) || "",
    saveCoupon: (code: string) => options.local().setItem(options.keys.coupon, code),
    removeCoupon: () => options.local().removeItem(options.keys.coupon),
    requestId: () => {
      const existing = options.session().getItem(options.keys.request);
      if (existing) return existing;
      const id = options.randomUUID();
      options.session().setItem(options.keys.request, id);
      return id;
    },
    clearRequestId: () => options.session().removeItem(options.keys.request),
    saveOrderSummary: (summary: unknown) => options.session().setItem(options.keys.summary, JSON.stringify(summary)),
  };
}
