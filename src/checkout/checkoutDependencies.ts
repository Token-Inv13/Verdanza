import type { ComponentProps, ComponentType } from "react";
import type { useCart } from "../context/CartContext";
import type { useAuth } from "../context/AuthContext";
import type { ContactActions } from "../components/ContactActions";
import type { PromoBannerSlot } from "../components/PromoBannerSlot";
import type { quoteOrder } from "../services/quoteService";
import type { AddressAutocompleteCoordinator } from "../services/addressAutocompleteService";
import type * as Analytics from "../lib/analytics";
import type { PublicSubmissionSecurityContext } from "../lib/publicSubmissionSecurity";
import type { CreateCheckoutOrderInput, CheckoutOrderResult } from "../services/ordersService";
import type { useCagnotteCheckout, useCheckoutAttempt } from "../hooks/useCagnotteCheckout";
import type { DeliveryZone } from "../types";
import type { CheckoutStorage } from "./checkoutStorage";

// Type-only references: importing the shared form never initializes Firebase or analytics.
export type CheckoutCart = Pick<ReturnType<typeof useCart>,
  "itemCount" | "subtotal" | "items" | "lines" | "cartWarnings" | "hasBlockingCartIssues" | "promotionSelections" | "setPromotionSelection">;
export type CheckoutIdentity = {
  user: Pick<NonNullable<ReturnType<typeof useAuth>["user"]>, "uid" | "email" | "displayName" | "getIdToken"> | null;
  customerProfile: Pick<NonNullable<ReturnType<typeof useAuth>["customerProfile"]>, "phone" | "displayName"> | null;
};
export type CheckoutCustomerFields = {
  email: string; phone: string; firstName: string; lastName: string;
  line1: string; line2: string; postalCode: string; city: string; country: string;
};
export type CheckoutSubmission = CreateCheckoutOrderInput;
export type CheckoutOutcome = CheckoutOrderResult | { redirectUrl: string };
export type CheckoutAttempt = Omit<ReturnType<typeof useCheckoutAttempt>, "submit" | "retry"> & {
  submit: (input: CheckoutSubmission) => Promise<CheckoutOutcome | null>;
  retry: () => Promise<CheckoutOutcome | null>;
};
export type CheckoutAnalytics = Pick<typeof Analytics,
  "trackAddPaymentInfo" | "trackAddShippingInfo" | "trackContactClick" | "trackBeginCheckout" |
  "getGa4MeasurementContext" | "trackLocalDeliveryZoneSelected" | "trackOrderSubmitted" | "trackPaymentMethodSelected">;
export type CheckoutAddressSearch = Pick<AddressAutocompleteCoordinator, "search" | "dispose">;

export type CheckoutDependencies = {
  quoteOrder: typeof quoteOrder;
  cagnotteEnabled: boolean;
  useCagnotteCheckout: typeof useCagnotteCheckout;
  useCheckoutAttempt: (identityKey: string) => CheckoutAttempt;
  clearCagnottePreference: (identityKey: string | null) => void;
  submitOrder: (input: CheckoutSubmission) => Promise<CheckoutOutcome>;
  redirectToPayment?: (url: string) => void;
  loadDeliveryZones: () => Promise<{ zones: DeliveryZone[] }>;
  initialDeliveryZones: DeliveryZone[];
  analytics: CheckoutAnalytics;
  storage: CheckoutStorage;
  submissionSecurity: (startedAt: number) => PublicSubmissionSecurityContext;
  rememberOrderAnalytics: (orderId: string, token?: string) => void;
  navigateSuccess: (orderId: string) => void;
  createAddressSearch: () => CheckoutAddressSearch;
  ContactActions: ComponentType<ComponentProps<typeof ContactActions>>;
  PromoBannerSlot: ComponentType<ComponentProps<typeof PromoBannerSlot>>;
  contactEmail: string;
  showAccountLinks: boolean;
  allowCashOnDelivery?: boolean;
  catalogPath?: string;
  localDeliveryInfoPath?: string;
  initialCustomer?: CheckoutCustomerFields;
};
