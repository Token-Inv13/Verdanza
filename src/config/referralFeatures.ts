export function resolveReferralDisplayConfiguration(environment: Readonly<Record<string, unknown>>) {
  return Object.freeze({
    displayEnabled: environment.VITE_REFERRAL_DISPLAY_ENABLED === "true",
    checkoutDisplayEnabled: environment.VITE_REFERRAL_CHECKOUT_DISPLAY_ENABLED === "true",
  });
}
export const REFERRAL_DISPLAY_CONFIGURATION = resolveReferralDisplayConfiguration(import.meta.env ?? {});
