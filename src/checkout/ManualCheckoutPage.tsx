import { useCagnotteCheckout, useCheckoutAttempt } from "../hooks/useCagnotteCheckout";
import { clearCagnottePreference } from "../services/cagnotteCheckoutService";
import { CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED } from "../config/cagnotteFeatures";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CheckoutPage as CheckoutForm } from "../pages/CheckoutPage";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { ContactActions } from "../components/ContactActions";
import { PromoBannerSlot } from "../components/PromoBannerSlot";
import { deliveryZones } from "../data/deliveryZones";
import { getDeliveryZonesWithFallback } from "../services/deliveryZonesService";
import { AddressAutocompleteCoordinator } from "../services/addressAutocompleteService";
import * as analytics from "../lib/analytics";
import { rememberPendingOrderAnalyticsRevocation } from "../lib/orderAnalyticsRevocation";
import { publicSubmissionSecurityContext } from "../lib/publicSubmissionSecurity";
import { createCheckoutStorage } from "./checkoutStorage";
import { manualQuoteOrder, submitManualOrder } from "./manualCheckoutServices";
import type { CheckoutDependencies } from "./checkoutDependencies";

const storage = createCheckoutStorage({
  local: () => window.localStorage,
  session: () => window.sessionStorage,
  randomUUID: () => window.crypto.randomUUID(),
  keys: { coupon: "verdanza-coupon-code", request: "verdanza:checkout-request-id", summary: "verdanza:lastOrderSummary" },
});
const createAddressSearch = () => new AddressAutocompleteCoordinator();

// The public route always selects this adapter. No URL, storage or environment switch.
export function CheckoutPage() {
  const cart = useCart();
  const { user, customerProfile } = useAuth();
  const navigate = useNavigate();
  const dependencies = useMemo<CheckoutDependencies>(() => ({
    cagnotteEnabled: CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED,
    useCagnotteCheckout,
    useCheckoutAttempt: useManualCheckoutAttempt,
    clearCagnottePreference,
    quoteOrder: manualQuoteOrder,
    submitOrder: submitManualOrder,
    loadDeliveryZones: getDeliveryZonesWithFallback,
    initialDeliveryZones: deliveryZones,
    analytics,
    storage,
    submissionSecurity: publicSubmissionSecurityContext,
    rememberOrderAnalytics: rememberPendingOrderAnalyticsRevocation,
    navigateSuccess: (orderId) => navigate(`/checkout/success?order_id=${encodeURIComponent(orderId)}`),
    createAddressSearch,
    ContactActions,
    PromoBannerSlot,
    contactEmail: (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) || "contact@verdanza.fr",
    showAccountLinks: true,
  }), [navigate]);
  return <CheckoutForm cart={cart} identity={{ user, customerProfile }} dependencies={dependencies} />;
}

function useManualCheckoutAttempt(identityKey: string) {
  const attempt = useCheckoutAttempt(identityKey);
  return {
    ...attempt,
    submit: (input: Parameters<typeof submitManualOrder>[0]) => attempt.submit(input, submitManualOrder),
    retry: () => attempt.retry(submitManualOrder),
  };
}
