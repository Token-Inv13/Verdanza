export const consentStorageKey = "verdanza-consent-v1";
export const consentVersion = 1;

export type ConsentState = {
  version: 1;
  analytics: boolean;
  decidedAt: string;
};

export function readStoredConsent(): ConsentState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(consentStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    if (parsed.version !== consentVersion || typeof parsed.analytics !== "boolean") return null;
    if (!parsed.decidedAt || Number.isNaN(Date.parse(parsed.decidedAt))) return null;
    return {
      version: consentVersion,
      analytics: parsed.analytics,
      decidedAt: parsed.decidedAt,
    };
  } catch {
    return null;
  }
}

export function buildConsentState(analytics: boolean): ConsentState {
  return {
    version: consentVersion,
    analytics,
    decidedAt: new Date().toISOString(),
  };
}

export function storeConsent(consent: ConsentState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(consentStorageKey, JSON.stringify(consent));
}

export function removeAnalyticsCookies() {
  if (typeof document === "undefined") return;
  const cookieNames = document.cookie
    .split(";")
    .map((cookie) => cookie.split("=")[0]?.trim())
    .filter((name) => name === "_ga" || name.startsWith("_ga_"));

  const hostParts = window.location.hostname.split(".");
  const candidateDomains = new Set<string>([""]);
  for (let index = 0; index < hostParts.length - 1; index += 1) {
    candidateDomains.add(`.${hostParts.slice(index).join(".")}`);
  }

  for (const name of cookieNames) {
    for (const domain of candidateDomains) {
      document.cookie = [
        `${name}=`,
        "Max-Age=0",
        "expires=Thu, 01 Jan 1970 00:00:00 GMT",
        "path=/",
        domain ? `domain=${domain}` : "",
        "SameSite=Lax",
      ]
        .filter(Boolean)
        .join("; ");
    }
  }
}
