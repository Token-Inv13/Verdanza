import { getFirebaseIdToken } from "../lib/firebaseAuth";
import type {
  Contest,
  ContestAuditLog,
  ContestDraw,
  ContestEntry,
  ContestInput,
  ContestPrize,
  ContestStatus,
  PublicContest,
} from "../types/contests";
import type { PublicSubmissionSecurityContext } from "../lib/publicSubmissionSecurity";

export type ContestAdminDetail = {
  contest: Contest;
  entries: ContestEntry[];
  entryTotal: number;
  page: number;
  pageSize: number;
  draws: ContestDraw[];
  prizes: ContestPrize[];
  audits: ContestAuditLog[];
};

export async function getPublicContest() {
  const response = await fetch("/api/contests", { cache: "no-store" });
  const payload = await readJson<{ contest: PublicContest | null }>(response);
  return payload.contest;
}

export async function enterContest(input: {
  contestId: string;
  displayName: string;
  email: string;
  rulesAccepted: boolean;
  marketingConsent: boolean;
  company?: string;
  submissionSecurity: PublicSubmissionSecurityContext;
}) {
  const response = await fetch("/api/contests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<{ entryId: string; publicId: string }>(response);
}

export async function getContestPrize(token: string) {
  const response = await fetch("/api/contest-prize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return readJson<{
    contest: { id: string; title: string };
    prize: Pick<
      ContestPrize,
      | "id"
      | "value"
      | "type"
      | "code"
      | "status"
      | "expiresAt"
      | "winnerDisplayName"
      | "claimedAt"
      | "redeemedAt"
      | "orderId"
    >;
  }>(response);
}

export async function listAdminContests() {
  const response = await adminFetch("/api/admin-contests?action=list");
  return readJson<{ contests: Contest[] }>(response);
}

export async function getAdminContestDetail(input: {
  contestId: string;
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const query = new URLSearchParams({
    action: "detail",
    contestId: input.contestId,
    page: String(input.page || 1),
    pageSize: String(input.pageSize || 50),
  });
  if (input.search?.trim()) query.set("search", input.search.trim());
  const response = await adminFetch(`/api/admin-contests?${query}`);
  return readJson<ContestAdminDetail>(response);
}

export async function createAdminContest(contest: ContestInput) {
  return adminAction<{ contest: Contest }>({ action: "create", contest });
}

export async function updateAdminContest(contestId: string, contest: ContestInput) {
  return adminAction<{ contest: Contest }>({ action: "update", contestId, contest });
}

export async function transitionAdminContest(contestId: string, status: ContestStatus) {
  return adminAction<{ contest: Contest }>({ action: "transition", contestId, status });
}

export async function drawAdminContest(contestId: string) {
  return adminAction<{ drawId: string; winnerEntryId: string; winnerPublicId: string }>({
    action: "draw",
    contestId,
  });
}

export async function validateAdminContestWinner(contestId: string) {
  return adminAction<{
    prize: ContestPrize;
    existing: boolean;
    claimUrl?: string;
    emailDelivery?: { status: "sent" | "skipped" | "failed"; reason?: string };
  }>({ action: "validateWinner", contestId });
}

export async function resendAdminContestPrizeInvitation(contestId: string, prizeId: string) {
  return adminAction<{
    prize: ContestPrize;
    claimUrl: string;
    emailDelivery: { status: "sent" | "skipped" | "failed"; reason?: string };
  }>({ action: "resendPrizeInvitation", contestId, prizeId });
}

export async function invalidateAdminContestWinner(contestId: string, reason: string) {
  return adminAction<{ ok: true }>({ action: "invalidateWinner", contestId, reason });
}

export async function cancelAdminContestPrize(
  contestId: string,
  prizeId: string,
  reason: string,
) {
  return adminAction<{ ok: true }>({ action: "cancelPrize", contestId, prizeId, reason });
}

async function adminAction<T>(body: Record<string, unknown>) {
  const response = await adminFetch("/api/admin-contests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson<T>(response);
}

async function adminFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = await getFirebaseIdToken();
  if (!token) throw new Error("Connexion admin requise.");
  return fetch(input, {
    ...init,
    cache: "no-store",
    headers: {
      ...Object.fromEntries(new Headers(init.headers).entries()),
      authorization: `Bearer ${token}`,
    },
  });
}

async function readJson<T>(response: Response): Promise<T> {
  const parsed = await response.json().catch(() => null);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Réponse concours invalide.");
  }
  const payload = parsed as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Operation concours impossible.");
  return payload;
}
