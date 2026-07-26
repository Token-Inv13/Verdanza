import { getFirebaseIdToken } from "../lib/firebaseAuth";
import type { AdminAnalyticsQuery, AdminAnalyticsResponse } from "../types/adminAnalytics";

export async function getAdminAnalytics(
  query: AdminAnalyticsQuery,
): Promise<AdminAnalyticsResponse> {
  const token = await getFirebaseIdToken();
  if (!token) throw new Error("Connexion admin requise.");

  const params = new URLSearchParams({
    action: "analytics",
    preset: query.preset,
  });
  if (query.startDate) params.set("startDate", query.startDate);
  if (query.endDate) params.set("endDate", query.endDate);
  if (query.compare) params.set("compare", "1");

  const response = await fetch(`/api/invoices?${params.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = (await response.json().catch(() => ({}))) as
    | AdminAnalyticsResponse
    | { error?: string };
  if (!response.ok) {
    throw new Error("error" in payload && payload.error ? payload.error : "Analytics indisponible.");
  }
  return payload as AdminAnalyticsResponse;
}
