import { handleAdminContests } from "./_server/contestAdminRoute.js";
import { handleContestPrize } from "./_server/contestPrizeRoute.js";
import { handlePublicContests } from "./_server/contestPublicRoute.js";
import {
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";

export type ContestApiRoute = "public" | "admin" | "prize";

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  const route = resolveContestApiRoute(request.url);
  if (route === "public") return handlePublicContests(request, response);
  if (route === "admin") return handleAdminContests(request, response);
  if (route === "prize") return handleContestPrize(request, response);
  sendJson(response, { error: "Route concours introuvable." }, 404);
}

export function resolveContestApiRoute(url: string | undefined): ContestApiRoute | null {
  const parsed = new URL(url || "/", "https://verdanza.local");
  if (parsed.pathname === "/api/contests") return "public";
  if (parsed.pathname === "/api/admin-contests") return "admin";
  if (parsed.pathname === "/api/contest-prize") return "prize";
  if (parsed.pathname !== "/api/contest-api") return null;
  const route = parsed.searchParams.get("__verdanzaRoute");
  return route === "public" || route === "admin" || route === "prize" ? route : null;
}
