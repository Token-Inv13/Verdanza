import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  ContestError,
  getContestPrizeByToken,
  serializeContestResponse,
} from "./_server/contests.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (assertMethod(request, response, "POST")) return;
  response.setHeader("Cache-Control", "no-store");
  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const token = body && typeof body === "object" ? (body as { token?: unknown }).token : "";
    const result = await getContestPrizeByToken(getAdminDb(), token);
    sendJson(response, serializeContestResponse(result));
  } catch (error) {
    const contestError = error instanceof ContestError ? error : null;
    sendJson(
      response,
      {
        error: contestError?.message || "Gain indisponible.",
        code: contestError?.code || "prize_unavailable",
      },
      contestError?.statusCode || 500,
    );
  }
}
