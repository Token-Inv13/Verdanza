import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw, Trash2, XCircle } from "lucide-react";
import { publishedBlogArticles } from "../../data/blogArticles";
import {
  deleteAdminBlogComment,
  listAdminBlogComments,
  moderateAdminBlogComment,
} from "../../services/blogEngagementService";
import type { AdminBlogComment, BlogCommentStatus } from "../../types/blogEngagement";

const statusLabels: Record<BlogCommentStatus | "all", string> = {
  all: "Tous",
  pending: "En attente",
  approved: "Approuvés",
  rejected: "Rejetés",
};

export default function AdminBlogCommentsPage() {
  const [comments, setComments] = useState<AdminBlogComment[]>([]);
  const [status, setStatus] = useState<BlogCommentStatus | "all">("pending");
  const [slug, setSlug] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadComments = useCallback(async (nextPage = page) => {
    setIsLoading(true);
    setError("");
    try {
      const result = await listAdminBlogComments({
        slug,
        status,
        page: nextPage,
        pageSize: 50,
      });
      setComments(result.comments);
      setTotal(result.total);
      setPage(result.page);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chargement des commentaires impossible.");
    } finally {
      setIsLoading(false);
    }
  }, [page, slug, status]);

  useEffect(() => {
    void loadComments(1);
  }, [loadComments]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / 50)), [total]);

  async function runAction(action: () => Promise<unknown>, success: string) {
    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
      await loadComments(page);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Action impossible.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="grid min-w-0 gap-6">
      <header className="admin-card">
        <p className="text-xs uppercase tracking-[0.18em] text-champagne">Guides CBD</p>
        <h1 className="mt-2 font-display text-4xl text-forest md:text-5xl">
          Commentaires du blog
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/60">
          Modération des commentaires envoyés depuis les guides. Les commentaires restent invisibles tant qu'ils ne sont pas approuvés.
        </p>
      </header>

      <section className="rounded-lg border border-forest/10 bg-ivory p-4">
        <div className="grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
          <label className="text-sm font-semibold text-forest">
            Statut
            <select
              className="input-field mt-2"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as BlogCommentStatus | "all");
                setPage(1);
              }}
            >
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-forest">
            Article
            <select
              className="input-field mt-2"
              value={slug}
              onChange={(event) => {
                setSlug(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Tous les guides</option>
              {publishedBlogArticles.map((article) => (
                <option key={article.slug} value={article.slug}>{article.title}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-secondary min-h-11 px-4 py-2"
            onClick={() => void loadComments(1)}
            disabled={isLoading}
          >
            <RefreshCw size={16} />
            Actualiser
          </button>
        </div>
      </section>

      {message && <p className="rounded-md border border-forest/15 bg-cream px-4 py-3 text-sm text-forest" role="status">{message}</p>}
      {error && <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p>}

      <section className="min-w-0 overflow-hidden rounded-lg border border-forest/10 bg-ivory">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-forest/10 bg-cream/70 p-4">
          <p className="text-sm text-ink/60">{total} commentaire(s)</p>
          <p className="text-xs text-ink/50">Page {page} / {pageCount}</p>
        </div>
        {isLoading && <Empty title="Chargement..." />}
        {!isLoading && !comments.length && <Empty title="Aucun commentaire" />}
        {!!comments.length && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="bg-cream text-xs uppercase tracking-[0.12em] text-forest/70">
                <tr>
                  {["Statut", "Article", "Pseudo", "Message", "Date", "Actions"].map((header) => (
                    <th key={header} className="px-4 py-3 font-medium">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comments.map((comment) => (
                  <tr key={comment.id} className="border-t border-forest/10 align-top">
                    <td className="px-4 py-4"><StatusBadge status={comment.status} /></td>
                    <td className="px-4 py-4">
                      <span className="block max-w-64 font-medium text-forest">
                        {articleTitle(comment.slug)}
                      </span>
                      <span className="mt-1 block font-mono text-xs text-ink/45">{comment.slug}</span>
                    </td>
                    <td className="px-4 py-4">
                      <span className="block font-medium text-forest">{comment.displayName}</span>
                      <span className="mt-1 block break-all font-mono text-xs text-ink/45">{comment.userId}</span>
                    </td>
                    <td className="px-4 py-4">
                      <p className="max-w-md whitespace-pre-line leading-6 text-ink/70">{comment.text}</p>
                    </td>
                    <td className="px-4 py-4 text-xs text-ink/55">{formatDate(comment.createdAt)}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        {comment.status !== "approved" && (
                          <button
                            type="button"
                            className="btn-primary min-h-9 px-3 py-2 text-xs"
                            disabled={isSaving}
                            onClick={() => void runAction(
                              () => moderateAdminBlogComment(comment.id, "approved"),
                              "Commentaire approuvé.",
                            )}
                          >
                            <CheckCircle2 size={15} />
                            Approuver
                          </button>
                        )}
                        {comment.status !== "rejected" && (
                          <button
                            type="button"
                            className="btn-secondary min-h-9 px-3 py-2 text-xs"
                            disabled={isSaving}
                            onClick={() => void runAction(
                              () => moderateAdminBlogComment(comment.id, "rejected"),
                              "Commentaire rejeté.",
                            )}
                          >
                            <XCircle size={15} />
                            Rejeter
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-secondary min-h-9 border-red-200 px-3 py-2 text-xs text-red-700"
                          disabled={isSaving}
                          onClick={() => {
                            if (!window.confirm("Supprimer définitivement ce commentaire ?")) return;
                            void runAction(
                              () => deleteAdminBlogComment(comment.id),
                              "Commentaire supprimé.",
                            );
                          }}
                        >
                          <Trash2 size={15} />
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pageCount > 1 && (
          <div className="flex items-center justify-between border-t border-forest/10 p-4">
            <button className="btn-secondary min-h-9 px-3 py-2" disabled={page <= 1} onClick={() => void loadComments(page - 1)}>
              Précédent
            </button>
            <button className="btn-secondary min-h-9 px-3 py-2" disabled={page >= pageCount} onClick={() => void loadComments(page + 1)}>
              Suivant
            </button>
          </div>
        )}
      </section>
    </section>
  );
}

function StatusBadge({ status }: { status: BlogCommentStatus }) {
  const tone = status === "approved"
    ? "border-forest/20 bg-forest/10 text-forest"
    : status === "rejected"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-champagne/30 bg-cream text-forest";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>{statusLabels[status]}</span>;
}

function Empty({ title }: { title: string }) {
  return <div className="p-10 text-center"><h3 className="font-display text-3xl text-forest">{title}</h3></div>;
}

function articleTitle(slug: string) {
  return publishedBlogArticles.find((article) => article.slug === slug)?.title || slug;
}

function formatDate(value?: string) {
  return value
    ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
    : "Non communiqué";
}
