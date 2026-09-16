type PublicCagnotteEnvironment = Readonly<Record<string, unknown>>;

export function resolveCagnotteDisplayConfiguration(environment: PublicCagnotteEnvironment) {
  return Object.freeze({
    readDisplayEnabled: environment.VITE_CAGNOTTE_READ_DISPLAY_ENABLED === "true",
    checkoutUseDisplayEnabled: environment.VITE_CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED === "true",
    adminToolsDisplayEnabled: environment.VITE_CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED === "true",
  });
}

const displayConfiguration = resolveCagnotteDisplayConfiguration(import.meta.env ?? {});

/** Loyalty wallet reads remain unavailable unless the exact public value is "true". */
export const CAGNOTTE_READ_DISPLAY_ENABLED = displayConfiguration.readDisplayEnabled;

/** Loyalty credit use remains unavailable unless the exact public value is "true". */
export const CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED = displayConfiguration.checkoutUseDisplayEnabled;

/** Sensitive loyalty administration tools remain unavailable unless the exact public value is "true". */
export const CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED = displayConfiguration.adminToolsDisplayEnabled;
