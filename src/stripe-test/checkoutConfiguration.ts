import { useTestCagnotte, useTestCheckoutAttempt } from "./checkoutHooks";
import type { CheckoutDependencies, CheckoutIdentity, CheckoutSubmission } from "../checkout/checkoutDependencies";
import { createCheckoutStorage } from "../checkout/checkoutStorage";
import type { DeliveryZone, Product, CartItem } from "../types";
import type { OrderQuote } from "../services/quoteService";

const localOrigin = "http://127.0.0.1:5195";
const prefix = "verdanza:stripe-checkout-test:v1:";
const EmptySlot = () => null;
type Attempt = { id: string; token: string; fingerprint: string };
export type TestOrderStatus = { orderId: string; paymentStatus: string; amountCents: number; paidTransitions: number };

function assertLocalTestContext() {
  if (import.meta.env?.DEV !== true || typeof window === "undefined" || window.location.origin !== localOrigin) {
    throw new Error("checkout_test_local_only");
  }
}

// No caller-supplied URL, transport, Firebase instance, Auth provider or environment flag.
export function createLocalTestCheckoutConfiguration() {
  assertLocalTestContext();
  const local = () => { assertLocalTestContext(); return window.localStorage; };
  const session = () => { assertLocalTestContext(); return window.sessionStorage; };
  const identity: CheckoutIdentity = { user: null, customerProfile: null };
  async function request<T>(route: "catalog" | "delivery-zones" | "quote" | "checkout" | "status" | "resume", body?: unknown, token?: string): Promise<T> {
    assertLocalTestContext();
    const response = await fetch(`${localOrigin}/api/stripe-test/${route}`, {
      method: body === undefined ? "GET" : "POST", credentials: "omit", redirect: "error",
      headers: { "content-type": "application/json", ...(token ? { "x-test-order-token": token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "test_request_failed");
    return payload as T;
  }
  function redirectToPayment(url: string) {
    assertLocalTestContext();
    const target = new URL(url);
    if (target.origin !== "https://checkout.stripe.com" || !target.pathname.startsWith("/c/pay/cs_test_")) throw new Error("test_checkout_url_invalid");
    window.location.assign(url);
  }
  function attemptFor(input: CheckoutSubmission): Attempt {
    // Repeated clicks/retries share the same id. A changed cart/customer starts another attempt.
    const fingerprint = JSON.stringify({ items: input.items, customer: input.customer,
      deliveryMethod: input.deliveryMethod, deliveryZone: input.deliveryZone,
      couponCode: input.couponCode, promotionSelections: input.promotionSelections, customerMessage: input.customerMessage });
    const stored = local().getItem(`${prefix}attempt`);
    if (stored) {
      const previous = JSON.parse(stored) as Attempt;
      if (previous.fingerprint === fingerprint) return previous;
    }
    const attempt: Attempt = { id: window.crypto.randomUUID(), fingerprint,
      token: Array.from(window.crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, "0")).join("") };
    local().setItem(`${prefix}attempt`, JSON.stringify(attempt));
    local().setItem(`${prefix}order:${attempt.id}`, attempt.token);
    return attempt;
  }
  const dependencies: CheckoutDependencies = {
    cagnotteEnabled: false,
    useCagnotteCheckout: useTestCagnotte,
    useCheckoutAttempt: () => useTestCheckoutAttempt(dependencies),
    clearCagnottePreference: () => {},
    quoteOrder: (input) => request<OrderQuote>("quote", input),
    submitOrder: async (input) => {
      assertLocalTestContext();
      if (input.cagnotteUse) throw new Error("test_cagnotte_unavailable");
      const attempt = attemptFor(input);
      const result = await request<{ url: string }>("checkout", { items: input.items, customer: input.customer,
        deliveryMethod: input.deliveryMethod, deliveryZone: input.deliveryZone, couponCode: input.couponCode, promotionSelections: input.promotionSelections,
        customerMessage: input.customerMessage, complianceAccepted: input.complianceAccepted,
        company: input.company, preferredPaymentMethod: input.preferredPaymentMethod, checkoutRequestId: attempt.id }, attempt.token);
      return { redirectUrl: result.url };
    },
    redirectToPayment,
    navigateSuccess: () => { throw new Error("test_webhook_return_required"); },
    initialDeliveryZones: [],
    loadDeliveryZones: () => request<{ zones: DeliveryZone[] }>("delivery-zones"),
    analytics: {
      trackAddPaymentInfo: () => {}, trackAddShippingInfo: () => {}, trackContactClick: () => {},
      trackBeginCheckout: () => {}, trackLocalDeliveryZoneSelected: () => {},
      trackOrderSubmitted: () => {}, trackPaymentMethodSelected: () => {},
      getGa4MeasurementContext: async () => null,
    },
    storage: createCheckoutStorage({ local, session, randomUUID: () => window.crypto.randomUUID(),
      keys: { coupon: `${prefix}coupon`, request: `${prefix}request`, summary: `${prefix}summary` } }),
    submissionSecurity: (formStartedAt) => ({ formStartedAt }),
    rememberOrderAnalytics: () => {},
    createAddressSearch: () => ({
      search: async (query) => {
        assertLocalTestContext();
        return { status: "ready", suggestions: query.trim().length < 3 ? [] : [{
          id: "synthetic-local-address", label: "1 rue du Test local, 13100 Aix-en-Provence (adresse fictive)",
          line1: "1 rue du Test local", postalCode: "13100", city: "Aix-en-Provence",
          latitude: 43.529649, longitude: 5.447913, verificationProvider: "geoplateforme_ban",
        }] };
      },
      dispose: () => {},
    }),
    ContactActions: EmptySlot, PromoBannerSlot: EmptySlot,
    contactEmail: "checkout-test@example.invalid", showAccountLinks: false,
    allowCashOnDelivery: false, catalogPath: "/stripe-test", localDeliveryInfoPath: "/stripe-test",
    initialCustomer: {
      firstName: "Client", lastName: "Test", email: "checkout-test@example.invalid", phone: "0600000000",
      line1: "1 rue du Test", line2: "", postalCode: "75001", city: "Paris", country: "France",
    },
  };
  return {
    identity, dependencies,
    loadCatalog: async () => (await request<{ products: Product[] }>("catalog")).products,
    readStatus: (id: string) => request<TestOrderStatus>("status", { orderId: id }, local().getItem(`${prefix}order:${id}`) || ""),
    resume: async (id: string) => {
      const result = await request<{ url: string }>("resume", { orderId: id }, local().getItem(`${prefix}order:${id}`) || "");
      redirectToPayment(result.url);
    },
    newAttempt: () => local().removeItem(`${prefix}attempt`),
    cartStorage: {
      read: () => local().getItem(`${prefix}cart`),
      write: (items: CartItem[]) => local().setItem(`${prefix}cart`, JSON.stringify(items)),
      clear: () => local().removeItem(`${prefix}cart`),
    },
  };
}
