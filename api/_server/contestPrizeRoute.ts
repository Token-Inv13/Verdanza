import { getAdminDb } from "./firebaseAdmin.js";
import {
  ContestError,
  getContestPrizeByToken,
  serializeContestResponse,
} from "./contests.js";
import {
  assertMethod,
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./http.js";

export async function handleContestPrize(
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
