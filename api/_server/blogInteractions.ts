import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { assertAdminUser, verifyFirebaseIdToken } from "./adminAuth.js";
import { getAdminDb } from "./firebaseAdmin.js";
import {
  sendJson,
  type VercelRequestLike,
  type VercelResponseLike,
} from "./http.js";
import {
  enforcePublicSubmissionRateLimit,
  sendPublicRateLimitResponse,
} from "./publicRateLimit.js";
import { publishedBlogArticleSlugs } from "../../src/data/blogArticleSlugs.js";
import type {
  AdminBlogComment,
  AdminBlogCommentsPage,
  BlogComment,
  BlogCommentStatus,
  BlogCommentsPage,
  BlogEngagementSummary,
} from "../../src/types/blogEngagement.js";

export const blogInteractionCollections = {
  stats: "blogArticleStats",
  likes: "blogArticleLikes",
  comments: "blogArticleComments",
} as const;

const allowedCommentStatuses: BlogCommentStatus[] = ["pending", "approved", "rejected"];
const defaultCommentPageSize = 10;
const maxCommentPageSize = 50;
const maxAdminCommentPageSize = 100;
const browserIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class BlogInteractionError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "blog_interaction_error",
  ) {
    super(message);
    this.name = "BlogInteractionError";
  }
}

export async function handleBlogInteractions(
  request: VercelRequestLike,
  response: VercelResponseLike,
) {
  response.setHeader("Cache-Control", "no-store");
  try {
    if (request.method === "GET") {
      await handleGet(request, response);
      return;
    }
    if (request.method === "POST") {
      await handlePost(request, response);
      return;
    }
    sendJson(response, { error: "Methode non autorisee." }, 405);
  } catch (error) {
    console.error("blog interactions failed", error);
    sendBlogError(response, error);
  }
}

async function handleGet(request: VercelRequestLike, response: VercelResponseLike) {
  const query = new URL(request.url || "/", "https://verdanza.local").searchParams;
  const action = query.get("action") || "summary";
  const slug = assertKnownSlug(query.get("slug") || "");
  const db = getAdminDb();
  if (action === "summary") {
    sendJson(response, await getBlogEngagementSummary(db, {
      slug,
      browserId: query.get("browserId") || "",
    }));
    return;
  }
  if (action === "comments") {
    sendJson(response, await listApprovedComments(db, {
      slug,
      page: Number(query.get("page") || 1),
      pageSize: Number(query.get("pageSize") || defaultCommentPageSize),
    }));
    return;
  }
  if (action === "adminComments") {
    const token = bearerToken(request);
    if (!token) throw new BlogInteractionError("Token admin requis.", 401, "admin_token_required");
    await assertAdminUser(db, token);
    sendJson(response, await listAdminComments(db, {
      slug: query.get("slug") || "",
      status: query.get("status") || "",
      page: Number(query.get("page") || 1),
      pageSize: Number(query.get("pageSize") || 50),
    }));
    return;
  }
  throw new BlogInteractionError("Action inconnue.");
}

async function handlePost(request: VercelRequestLike, response: VercelResponseLike) {
  const body = parseBody(request.body);
  const action = String(body.action || "");
  const db = getAdminDb();
  if (action === "toggleLike") {
    const slug = assertKnownSlug(body.slug);
    const browserId = assertBrowserId(body.browserId);
    const rateLimit = await enforcePublicSubmissionRateLimit({
      route: "/api/blog-interactions",
      request,
      email: "",
      anonymousId: browserId,
      authenticated: false,
      db,
    });
    if (!rateLimit.allowed) {
      sendPublicRateLimitResponse(response, rateLimit);
      return;
    }
    sendJson(response, await toggleArticleLike(db, slug, browserId));
    return;
  }
  if (action === "createComment") {
    const slug = assertKnownSlug(body.slug);
    const token = bearerToken(request);
    if (!token) {
      throw new BlogInteractionError(
        "Connectez-vous pour commenter.",
        401,
        "comment_auth_required",
      );
    }
    const user = await verifyFirebaseIdToken(token);
    const rateLimit = await enforcePublicSubmissionRateLimit({
      route: "/api/blog-interactions",
      request,
      email: user.uid,
      anonymousId: assertOptionalBrowserId(body.browserId),
      authenticated: true,
      db,
    });
    if (!rateLimit.allowed) {
      sendPublicRateLimitResponse(response, rateLimit);
      return;
    }
    const comment = await createPendingComment(db, {
      slug,
      userId: user.uid,
      displayName: body.displayName,
      text: body.text,
    });
    sendJson(response, { comment }, 201);
    return;
  }
  if (action === "moderateComment") {
    const token = bearerToken(request);
    if (!token) throw new BlogInteractionError("Token admin requis.", 401, "admin_token_required");
    const admin = await assertAdminUser(db, token);
    const commentId = cleanIdentifier(body.commentId);
    const status = String(body.status || "") as BlogCommentStatus;
    if (!allowedCommentStatuses.includes(status) || status === "pending") {
      throw new BlogInteractionError("Statut de moderation invalide.");
    }
    sendJson(response, {
      comment: await moderateComment(db, {
        commentId,
        status,
        actorId: admin.email || admin.uid,
      }),
    });
    return;
  }
  if (action === "deleteComment") {
    const token = bearerToken(request);
    if (!token) throw new BlogInteractionError("Token admin requis.", 401, "admin_token_required");
    const admin = await assertAdminUser(db, token);
    await deleteComment(db, cleanIdentifier(body.commentId), admin.email || admin.uid);
    sendJson(response, { ok: true });
    return;
  }
  throw new BlogInteractionError("Action inconnue.");
}

export async function getBlogEngagementSummary(
  db: FirebaseFirestore.Firestore,
  input: { slug: string; browserId?: string },
): Promise<BlogEngagementSummary> {
  const slug = assertKnownSlug(input.slug);
  const [statsSnapshot, likeSnapshot] = await Promise.all([
    db.collection(blogInteractionCollections.stats).doc(slug).get(),
    input.browserId && browserIdPattern.test(input.browserId)
      ? db.collection(blogInteractionCollections.likes)
          .doc(likeDocumentId(slug, input.browserId))
          .get()
      : Promise.resolve(null),
  ]);
  const stats = statsSnapshot.data() || {};
  return {
    slug,
    likeCount: Math.max(0, Number(stats.likeCount || 0)),
    approvedCommentCount: Math.max(0, Number(stats.approvedCommentCount || 0)),
    viewerLiked: likeSnapshot ? likeSnapshot.data()?.active === true : false,
  };
}

export async function toggleArticleLike(
  db: FirebaseFirestore.Firestore,
  slugInput: unknown,
  browserIdInput: unknown,
): Promise<BlogEngagementSummary> {
  const slug = assertKnownSlug(slugInput);
  const browserId = assertBrowserId(browserIdInput);
  const statsRef = db.collection(blogInteractionCollections.stats).doc(slug);
  const likeRef = db.collection(blogInteractionCollections.likes).doc(likeDocumentId(slug, browserId));
  return db.runTransaction(async (transaction) => {
    const [statsSnapshot, likeSnapshot] = await Promise.all([
      transaction.get(statsRef),
      transaction.get(likeRef),
    ]);
    const stats = statsSnapshot.data() || {};
    const existingLike = likeSnapshot.data();
    const wasActive = existingLike?.active === true;
    const nextActive = !wasActive;
    const currentLikeCount = Math.max(0, Number(stats.likeCount || 0));
    const nextLikeCount = nextActive ? currentLikeCount + 1 : Math.max(0, currentLikeCount - 1);
    transaction.set(statsRef, {
      slug,
      likeCount: nextLikeCount,
      approvedCommentCount: Math.max(0, Number(stats.approvedCommentCount || 0)),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(likeRef, {
      slug,
      visitorHash: visitorHash(browserId),
      active: nextActive,
      createdAt: existingLike?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return {
      slug,
      likeCount: nextLikeCount,
      approvedCommentCount: Math.max(0, Number(stats.approvedCommentCount || 0)),
      viewerLiked: nextActive,
    };
  });
}

export async function createPendingComment(
  db: FirebaseFirestore.Firestore,
  input: {
    slug: string;
    userId: string;
    displayName: unknown;
    text: unknown;
  },
): Promise<BlogComment> {
  const slug = assertKnownSlug(input.slug);
  const text = cleanCommentText(input.text);
  const displayName = cleanDisplayName(input.displayName);
  const ref = db.collection(blogInteractionCollections.comments).doc();
  const now = new Date().toISOString();
  await ref.set({
    slug,
    userId: cleanIdentifier(input.userId),
    displayName,
    text,
    status: "pending" satisfies BlogCommentStatus,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {
    id: ref.id,
    slug,
    status: "pending",
    displayName,
    text,
    createdAt: now,
  };
}

export async function listApprovedComments(
  db: FirebaseFirestore.Firestore,
  input: { slug: string; page?: number; pageSize?: number },
): Promise<BlogCommentsPage> {
  const slug = assertKnownSlug(input.slug);
  const pageSize = clampInteger(input.pageSize, defaultCommentPageSize, 1, maxCommentPageSize);
  const page = clampInteger(input.page, 1, 1, 500);
  const snapshot = await db
    .collection(blogInteractionCollections.comments)
    .where("slug", "==", slug)
    .limit(300)
    .get();
  const comments = snapshot.docs
    .map((entry) => document<AdminBlogComment>(entry))
    .filter((comment) => comment.status === "approved")
    .sort((left, right) => dateValue(right.createdAt) - dateValue(left.createdAt));
  const offset = (page - 1) * pageSize;
  return {
    comments: comments.slice(offset, offset + pageSize).map(publicComment),
    total: comments.length,
    page,
    pageSize,
    hasMore: comments.length > offset + pageSize,
  };
}

export async function listAdminComments(
  db: FirebaseFirestore.Firestore,
  input: { slug?: string; status?: string; page?: number; pageSize?: number },
): Promise<AdminBlogCommentsPage> {
  const pageSize = clampInteger(input.pageSize, 50, 1, maxAdminCommentPageSize);
  const page = clampInteger(input.page, 1, 1, 500);
  const slug = input.slug?.trim() ? assertKnownSlug(input.slug) : "";
  const status = input.status && input.status !== "all" ? assertCommentStatus(input.status) : "";
  const snapshot = await db.collection(blogInteractionCollections.comments).limit(500).get();
  const comments = snapshot.docs
    .map((entry) => document<AdminBlogComment>(entry))
    .filter((comment) => !slug || comment.slug === slug)
    .filter((comment) => !status || comment.status === status)
    .sort((left, right) => dateValue(right.createdAt) - dateValue(left.createdAt));
  const offset = (page - 1) * pageSize;
  return {
    comments: comments.slice(offset, offset + pageSize),
    total: comments.length,
    page,
    pageSize,
  };
}

export async function moderateComment(
  db: FirebaseFirestore.Firestore,
  input: { commentId: string; status: "approved" | "rejected"; actorId: string },
): Promise<AdminBlogComment> {
  const ref = db.collection(blogInteractionCollections.comments).doc(cleanIdentifier(input.commentId));
  let result: AdminBlogComment | null = null;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new BlogInteractionError("Commentaire introuvable.", 404);
    const comment = document<AdminBlogComment>(snapshot);
    const statsRef = db.collection(blogInteractionCollections.stats).doc(comment.slug);
    const statsSnapshot = await transaction.get(statsRef);
    const stats = statsSnapshot.data() || {};
    const currentApprovedCount = Math.max(0, Number(stats.approvedCommentCount || 0));
    const wasApproved = comment.status === "approved";
    const willBeApproved = input.status === "approved";
    const nextApprovedCount = wasApproved === willBeApproved
      ? currentApprovedCount
      : willBeApproved
        ? currentApprovedCount + 1
        : Math.max(0, currentApprovedCount - 1);
    transaction.update(ref, {
      status: input.status,
      moderatedAt: FieldValue.serverTimestamp(),
      moderatedBy: input.actorId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(statsRef, {
      slug: comment.slug,
      likeCount: Math.max(0, Number(stats.likeCount || 0)),
      approvedCommentCount: nextApprovedCount,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    result = {
      ...comment,
      status: input.status,
      moderatedAt: new Date().toISOString(),
      moderatedBy: input.actorId,
    };
  });
  if (!result) throw new BlogInteractionError("Moderation impossible.", 500);
  return result;
}

export async function deleteComment(
  db: FirebaseFirestore.Firestore,
  commentId: string,
  actorId: string,
) {
  const ref = db.collection(blogInteractionCollections.comments).doc(cleanIdentifier(commentId));
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const comment = document<AdminBlogComment>(snapshot);
    const statsRef = db.collection(blogInteractionCollections.stats).doc(comment.slug);
    const statsSnapshot = await transaction.get(statsRef);
    const stats = statsSnapshot.data() || {};
    const approvedCommentCount = Math.max(0, Number(stats.approvedCommentCount || 0));
    transaction.delete(ref);
    transaction.set(statsRef, {
      slug: comment.slug,
      likeCount: Math.max(0, Number(stats.likeCount || 0)),
      approvedCommentCount: comment.status === "approved"
        ? Math.max(0, approvedCommentCount - 1)
        : approvedCommentCount,
      lastDeletedCommentBy: actorId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

export function cleanCommentText(value: unknown) {
  const text = String(value || "")
    .normalize("NFKC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim()
    .replace(/\s{3,}/g, " ");
  if (text.length < 8) {
    throw new BlogInteractionError("Votre commentaire est trop court.", 400, "comment_too_short");
  }
  if (text.length > 1_000) {
    throw new BlogInteractionError("Votre commentaire est trop long.", 400, "comment_too_long");
  }
  return text;
}

function cleanDisplayName(value: unknown) {
  const name = String(value || "")
    .normalize("NFKC")
    .replace(/[<>]/g, "")
    .trim()
    .replace(/\s{2,}/g, " ")
    .slice(0, 80);
  return name.length >= 2 ? name : "Lecteur Verdanza";
}

function assertKnownSlug(value: unknown) {
  const slug = String(value || "").trim();
  if (!publishedBlogArticleSlugs.includes(slug as never)) {
    throw new BlogInteractionError("Guide introuvable.", 404, "unknown_blog_slug");
  }
  return slug;
}

function assertCommentStatus(value: unknown): BlogCommentStatus {
  const status = String(value || "") as BlogCommentStatus;
  if (!allowedCommentStatuses.includes(status)) {
    throw new BlogInteractionError("Statut de commentaire invalide.");
  }
  return status;
}

function assertBrowserId(value: unknown) {
  const browserId = String(value || "").trim().toLowerCase();
  if (!browserIdPattern.test(browserId)) {
    throw new BlogInteractionError("Identifiant navigateur invalide.", 400, "browser_id_invalid");
  }
  return browserId;
}

function assertOptionalBrowserId(value: unknown) {
  const browserId = String(value || "").trim().toLowerCase();
  return browserIdPattern.test(browserId) ? browserId : undefined;
}

function likeDocumentId(slug: string, browserId: string) {
  return hmacSecret(`blog-like:${slug}:${browserId}`);
}

function visitorHash(browserId: string) {
  return hmacSecret(`blog-visitor:${browserId}`);
}

function hmacSecret(value: string) {
  const secret = process.env.RATE_LIMIT_HMAC_SECRET;
  if (!secret || secret.length < 32) {
    throw new BlogInteractionError(
      "Configuration de securite indisponible.",
      503,
      "blog_security_config_missing",
    );
  }
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function parseBody(value: unknown) {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") {
    throw new BlogInteractionError("Payload invalide.");
  }
  return body as Record<string, unknown>;
}

function bearerToken(request: VercelRequestLike) {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : "";
}

function cleanIdentifier(value: unknown) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(text)) {
    throw new BlogInteractionError("Identifiant invalide.");
  }
  return text;
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function document<T extends { id: string }>(snapshot: FirebaseFirestore.DocumentSnapshot) {
  return serializeValue({ id: snapshot.id, ...snapshot.data() }) as T;
}

function publicComment(comment: AdminBlogComment): BlogComment {
  return {
    id: comment.id,
    slug: comment.slug,
    status: "approved",
    displayName: comment.displayName,
    text: comment.text,
    createdAt: comment.createdAt,
  };
}

function serializeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(serializeValue);
  if (!value || typeof value !== "object") return value;
  const timestamp = value as { toDate?: () => Date; toMillis?: () => number; seconds?: number };
  if (typeof timestamp.toDate === "function") return timestamp.toDate().toISOString();
  if (typeof timestamp.toMillis === "function") return new Date(timestamp.toMillis()).toISOString();
  if (typeof timestamp.seconds === "number" && Object.keys(value).length <= 2) {
    return new Date(timestamp.seconds * 1000).toISOString();
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, serializeValue(entry)]),
  );
}

function dateValue(value: unknown) {
  if (typeof value === "string") return Date.parse(value) || 0;
  if (value && typeof value === "object") {
    const timestamp = value as { toMillis?: () => number; seconds?: number };
    if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
    if (typeof timestamp.seconds === "number") return timestamp.seconds * 1000;
  }
  return 0;
}

function sendBlogError(response: VercelResponseLike, error: unknown) {
  const blogError = error instanceof BlogInteractionError ? error : null;
  const message = blogError?.message || "Interaction guide indisponible pour le moment.";
  sendJson(
    response,
    { error: message, code: blogError?.code || "blog_interaction_unavailable" },
    blogError?.statusCode || 500,
  );
}
