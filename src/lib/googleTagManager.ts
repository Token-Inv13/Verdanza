declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    verdanzaConsentModeInitialized?: boolean;
    verdanzaGa4Configured?: boolean;
    verdanzaGtmLoaded?: boolean;
  }
}

export const defaultGtmId = "GTM-W76PFW2X";
export const defaultGa4MeasurementId = "G-E9XNP7BJ2Y";

export const gtmId =
  (import.meta.env.VITE_GTM_ID as string | undefined)?.trim() || defaultGtmId;
export const ga4MeasurementId =
  (import.meta.env.VITE_GA4_MEASUREMENT_ID as string | undefined)?.trim() ||
  defaultGa4MeasurementId;

export function initializeGoogleConsentMode() {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtagShim(...args: unknown[]) {
      window.dataLayer?.push(args);
    };
  if (window.verdanzaConsentModeInitialized) return;
  window.gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  window.verdanzaConsentModeInitialized = true;
}

export function updateAnalyticsConsent(granted: boolean) {
  if (typeof window === "undefined") return;
  initializeGoogleConsentMode();
  window.gtag?.("consent", "update", {
    analytics_storage: granted ? "granted" : "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
}

export function loadGoogleTagManager() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (!gtmId || window.verdanzaGtmLoaded) return;
  if (document.querySelector(`script[data-verdanza-gtm="${gtmId}"]`)) {
    window.verdanzaGtmLoaded = true;
    return;
  }

  initializeGoogleConsentMode();
  loadGoogleAnalyticsTag();
  configureGoogleAnalyticsTag();
  window.dataLayer?.push({
    "gtm.start": Date.now(),
    event: "gtm.js",
  });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`;
  script.dataset.verdanzaGtm = gtmId;
  document.head.appendChild(script);
  window.verdanzaGtmLoaded = true;
}

function loadGoogleAnalyticsTag() {
  if (typeof document === "undefined") return;
  if (document.querySelector(`script[data-verdanza-ga4="${ga4MeasurementId}"]`)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4MeasurementId)}`;
  script.dataset.verdanzaGa4 = ga4MeasurementId;
  document.head.appendChild(script);
}

function configureGoogleAnalyticsTag() {
  if (typeof window === "undefined" || window.verdanzaGa4Configured) return;
  window.gtag?.("config", ga4MeasurementId, {
    send_page_view: false,
  });
  window.verdanzaGa4Configured = true;
}
