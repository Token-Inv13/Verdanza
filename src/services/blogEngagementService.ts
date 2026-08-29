import { getFirebaseIdToken, getCurrentFirebaseUser } from "../lib/firebaseAuth";
import type {
  AdminBlogComment,
  AdminBlogCommentsPage,
  BlogComment,
  BlogCommentsPage,
  BlogEngagementSummary,
  BlogCommentStatus,
} from "../types/blogEngagement";

const browserIdStorageKey = "verdanza:blog-engagement:browser-id";

export function getBlogEngagementBrowserId() {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(browserIdStorageKey);
  if (existing && isUuid(existing)) return existing;
  const next = crypto.randomUUID();
  window.localStorage.setItem(browserIdStorageKey, next);
  return next;
}

export async function getBlogEngagementSummary(slug: string) {
  const query = new URLSearchParams({
    action: "summary",
    slug,
    browserId: getBlogEngagementBrowserId(),
  });
  const response = await fetch(`/api/blog-interactions?${query}`, { cache: "no-store" });
  return readJson<BlogEngagementSummary>(response);
}

export async function listBlogComments(input: {
  slug: string;
  page?: number;
  pageSize?: number;
}) {
  const query = new URLSearchParams({
    action: "comments",
    slug: input.slug,
    page: String(input.page || 1),
    pageSize: String(input.pageSize || 10),
  });
  const response = await fetch(`/api/blog-interactions?${query}`, { cache: "no-store" });
  return readJson<BlogCommentsPage>(response);
}

export async function toggleBlogLike(slug: string) {
  const response = await fetch("/api/blog-interactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "toggleLike",
      slug,
      browserId: getBlogEngagementBrowserId(),
    }),
  });
  return readJson<BlogEngagementSummary>(response);
}

export async function createBlogComment(input: { slug: string; text: string; displayName?: string }) {
  const [token, user] = await Promise.all([
    getFirebaseIdToken(),
    getCurrentFirebaseUser(),
  ]);
  if (!token) throw new Error("Connectez-vous pour commenter.");
  const response = await fetch("/api/blog-interactions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: "createComment",
      slug: input.slug,
      text: input.text,
      displayName: input.displayName || user?.displayName || "Lecteur Verdanza",
      browserId: getBlogEngagementBrowserId(),
    }),
  });
  return readJson<{ comment: BlogComment }>(response);
}

export async function listAdminBlogComments(input: {
  slug?: string;
  status?: BlogCommentStatus | "all";
  page?: number;
  pageSize?: number;
}) {
  const query = new URLSearchParams({
    action: "adminComments",
    status: input.status || "pending",
    page: String(input.page || 1),
    pageSize: String(input.pageSize || 50),
  });
  if (input.slug) query.set("slug", input.slug);
  const response = await adminFetch(`/api/blog-interactions?${query}`);
  return readJson<AdminBlogCommentsPage>(response);
}

export async function moderateAdminBlogComment(
  commentId: string,
  status: Exclude<BlogCommentStatus, "pending">,
) {
  return adminBlogAction<{ comment: AdminBlogComment }>({
    action: "moderateComment",
    commentId,
    status,
  });
}

export async function deleteAdminBlogComment(commentId: string) {
  return adminBlogAction<{ ok: true }>({
    action: "deleteComment",
    commentId,
  });
}

async function adminBlogAction<T>(body: Record<string, unknown>) {
  const response = await adminFetch("/api/blog-interactions", {
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
    throw new Error("Réponse blog invalide.");
  }
  const payload = parsed as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Interaction guide impossible.");
  return payload;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
