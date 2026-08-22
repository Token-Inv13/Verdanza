import { FieldValue } from "firebase-admin/firestore";
import { assertAdminUser } from "./_server/adminAuth.js";
import {
  ContestError,
  contestCollections,
  cancelContestPrize,
  createContest,
  getAdminContestDetail,
  invalidateContestWinner,
  listAdminContests,
  performContestDraw,
  rotateContestPrizeClaimToken,
  serializeContestResponse,
  transitionContest,
  updateContest,
  validateContestWinner,
} from "./_server/contests.js";
import { sendContestPrizeEmail } from "./_server/email.js";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import {
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./_server/http.js";
import type { ContestPrize, ContestStatus } from "../src/types/contests.js";

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  if (!request.method || !["GET", "POST"].includes(request.method)) {
    sendJson(response, { error: "Methode non autorisee." }, 405);
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  try {
    const token = bearerToken(request);
    if (!token) {
      sendJson(response, { error: "Token admin requis." }, 401);
      return;
    }
    const db = getAdminDb();
    const admin = await assertAdminUser(db, token);
    const actor = {
      actorType: "admin" as const,
      actorId: admin.email || admin.uid,
    };

    if (request.method === "GET") {
      const query = new URL(request.url || "/", "https://verdanza.local").searchParams;
      if ((query.get("action") || "list") === "list") {
        const contests = await listAdminContests(db);
        sendJson(response, serializeContestResponse({ contests }));
        return;
      }
      if (query.get("action") === "detail") {
        const detail = await getAdminContestDetail(db, String(query.get("contestId") || ""), {
          page: Number(query.get("page") || 1),
          pageSize: Number(query.get("pageSize") || 50),
          search: query.get("search") || "",
        });
        sendJson(response, serializeContestResponse(detail));
        return;
      }
      throw new ContestError("Action admin inconnue.");
    }

    const body = parseBody(request.body);
    const action = String(body.action || "");
    const contestId = String(body.contestId || "").trim();
    if (action === "create") {
      const contest = await createContest(db, body.contest, actor);
      sendJson(response, serializeContestResponse({ contest }), 201);
      return;
    }
    if (action === "update") {
      const contest = await updateContest(db, contestId, body.contest, actor);
      sendJson(response, serializeContestResponse({ contest }));
      return;
    }
    if (action === "transition") {
      const contest = await transitionContest(
        db,
        contestId,
        String(body.status || "") as ContestStatus,
        actor,
      );
      sendJson(response, serializeContestResponse({ contest }));
      return;
    }
    if (action === "draw") {
      const draw = await performContestDraw(db, contestId, actor);
      sendJson(response, draw);
      return;
    }
    if (action === "invalidateWinner") {
      await invalidateContestWinner(db, contestId, body.reason, actor);
      sendJson(response, { ok: true });
      return;
    }
    if (action === "cancelPrize") {
      await cancelContestPrize(
        db,
        contestId,
        String(body.prizeId || ""),
        body.reason,
        actor,
      );
      sendJson(response, { ok: true });
      return;
    }
    if (action === "validateWinner") {
      const result = await validateContestWinner(db, contestId, actor);
      let invitation: Awaited<ReturnType<typeof deliverPrizeInvitation>> | undefined;
      if (!result.existing && result.claimToken) {
        const contestTitle = String(
          (await db.collection(contestCollections.contests).doc(contestId).get()).data()?.title ||
            "Concours Verdanza",
        );
        invitation = await deliverPrizeInvitation({
          db,
          contestTitle,
          prize: result.prize,
          claimToken: result.claimToken,
          actor,
        });
      }
      sendJson(
        response,
        serializeContestResponse({
          prize: result.prize,
          existing: result.existing,
          claimUrl: invitation?.claimUrl,
          emailDelivery: invitation?.emailDelivery,
        }),
      );
      return;
    }
    if (action === "resendPrizeInvitation") {
      const rotated = await rotateContestPrizeClaimToken(
        db,
        contestId,
        String(body.prizeId || ""),
        actor,
      );
      const contestTitle = String(
        (await db.collection(contestCollections.contests).doc(contestId).get()).data()?.title ||
          "Concours Verdanza",
      );
      const invitation = await deliverPrizeInvitation({
        db,
        contestTitle,
        prize: rotated.prize,
        claimToken: rotated.claimToken,
        actor,
      });
      sendJson(response, serializeContestResponse({
        prize: rotated.prize,
        ...invitation,
      }));
      return;
    }
    throw new ContestError("Action admin inconnue.");
  } catch (error) {
    console.error("admin contests failed", error);
    const contestError = error instanceof ContestError ? error : null;
    const message = error instanceof Error ? error.message : "Operation concours impossible.";
    const forbidden = message === "Acces admin requis.";
    sendJson(
      response,
      { error: contestError?.message || message, code: contestError?.code },
      forbidden ? 403 : contestError?.statusCode || 400,
    );
  }
}

function parseBody(value: unknown) {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new ContestError("Payload admin invalide.");
  return body as Record<string, unknown>;
}

function bearerToken(request: VercelRequestLike) {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : "";
}

function publicSiteUrl() {
  const configured = process.env.PUBLIC_SITE_URL || process.env.VITE_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://verdanza.fr";
}

async function deliverPrizeInvitation(input: {
  db: FirebaseFirestore.Firestore;
  contestTitle: string;
  prize: ContestPrize;
  claimToken: string;
  actor: { actorType: "admin"; actorId: string };
}) {
  const claimUrl = `${publicSiteUrl()}/concours/gain/${encodeURIComponent(input.claimToken)}`;
  const delivery = await sendContestPrizeEmail({
    contestId: input.prize.contestId,
    contestTitle: input.contestTitle,
    winnerEmail: input.prize.winnerEmail,
    winnerDisplayName: input.prize.winnerDisplayName,
    prizeValue: input.prize.value,
    expiresAt: input.prize.expiresAt,
    claimUrl,
    invitationId: `${input.prize.id}-${input.prize.invitationVersion}`,
  });
  const emailDelivery = {
    status: delivery.status === "partial" ? "failed" as const : delivery.status,
    ...(delivery.status === "sent" && delivery.id ? { providerId: delivery.id } : {}),
    ...(delivery.status !== "sent" ? { reason: delivery.reason } : {}),
  };
  const prizeRef = input.db.collection(contestCollections.prizes).doc(input.prize.id);
  const auditRef = input.db.collection(contestCollections.audits).doc();
  const batch = input.db.batch();
  batch.update(prizeRef, {
    emailDelivery: {
      ...emailDelivery,
      attemptedAt: FieldValue.serverTimestamp(),
    },
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(auditRef, {
    action: emailDelivery.status === "sent"
      ? "prize_invitation_sent"
      : "prize_invitation_failed",
    contestId: input.prize.contestId,
    drawId: input.prize.drawId,
    prizeId: input.prize.id,
    ...input.actor,
    metadata: {
      invitationVersion: input.prize.invitationVersion,
      deliveryStatus: emailDelivery.status,
      ...(emailDelivery.reason ? { reason: emailDelivery.reason } : {}),
    },
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { claimUrl, emailDelivery };
}
