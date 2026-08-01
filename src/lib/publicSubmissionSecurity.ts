export type PublicSubmissionSecurityContext = {
  anonymousId?: string;
  formStartedAt: number;
};

const anonymousSubmissionStorageKey = "verdanza:anonymous-submission-id";

export function publicSubmissionSecurityContext(
  formStartedAt: number,
): PublicSubmissionSecurityContext {
  return {
    anonymousId: getOrCreateAnonymousSubmissionId(),
    formStartedAt,
  };
}

function getOrCreateAnonymousSubmissionId() {
  try {
    const existing = window.localStorage.getItem(anonymousSubmissionStorageKey);
    if (existing) return existing;
    const anonymousId = window.crypto.randomUUID();
    window.localStorage.setItem(anonymousSubmissionStorageKey, anonymousId);
    return anonymousId;
  } catch {
    return undefined;
  }
}
