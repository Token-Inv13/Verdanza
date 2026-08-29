import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Heart, MessageCircle, Send, Share2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { trackBlogCommentSubmit, trackBlogLike, trackBlogShare } from "../lib/analytics";
import { absoluteUrl } from "../lib/siteUrl";
import {
  createBlogComment,
  getBlogEngagementSummary,
  listBlogComments,
  toggleBlogLike,
} from "../services/blogEngagementService";
import type { BlogArticle } from "../types/blog";
import type { BlogComment, BlogEngagementSummary } from "../types/blogEngagement";
import { blogArticlePath } from "../data/blogArticles";

export function BlogEngagement({ article }: { article: BlogArticle }) {
  const { user, customerProfile } = useAuth();
  const navigate = useNavigate();
  const canonicalUrl = useMemo(() => absoluteUrl(blogArticlePath(article)), [article]);
  const [summary, setSummary] = useState<BlogEngagementSummary>({
    slug: article.slug,
    likeCount: 0,
    viewerLiked: false,
    approvedCommentCount: 0,
  });
  const [comments, setComments] = useState<BlogComment[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingLike, setIsUpdatingLike] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadComments = useCallback(async (nextPage = 1, append = false) => {
    const result = await listBlogComments({ slug: article.slug, page: nextPage, pageSize: 10 });
    setComments((current) => append ? [...current, ...result.comments] : result.comments);
    setHasMore(result.hasMore);
    setPage(result.page);
  }, [article.slug]);

  const loadEngagement = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [nextSummary] = await Promise.all([
        getBlogEngagementSummary(article.slug),
        loadComments(1, false),
      ]);
      setSummary(nextSummary);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Interactions indisponibles.");
    } finally {
      setIsLoading(false);
    }
  }, [article.slug, loadComments]);

  useEffect(() => {
    void loadEngagement();
  }, [loadEngagement]);

  useEffect(() => {
    if (!message) return undefined;
    const timeout = window.setTimeout(() => setMessage(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [message]);

  async function handleLike() {
    if (isUpdatingLike) return;
    setIsUpdatingLike(true);
    setError("");
    try {
      const nextSummary = await toggleBlogLike(article.slug);
      setSummary(nextSummary);
      trackBlogLike(article, nextSummary.viewerLiked ? "add" : "remove");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de modifier le J'aime.");
    } finally {
      setIsUpdatingLike(false);
    }
  }

  async function handleShare() {
    setError("");
    try {
      if (navigator.share) {
        await navigator.share({ title: article.title, url: canonicalUrl });
        setMessage("Lien de l'article partagé.");
        trackBlogShare(article, "native");
        return;
      }
      await navigator.clipboard.writeText(canonicalUrl);
      setMessage("Lien de l'article copié.");
      trackBlogShare(article, "clipboard");
    } catch (reason) {
      if ((reason as { name?: string })?.name === "AbortError") return;
      setError("Partage impossible pour le moment.");
    }
  }

  async function handleSubmitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      navigate("/connexion", { state: { from: blogArticlePath(article) } });
      return;
    }
    if (isSubmittingComment) return;
    setIsSubmittingComment(true);
    setError("");
    try {
      await createBlogComment({
        slug: article.slug,
        text: draft,
        displayName: customerProfile?.displayName || user.displayName || "Lecteur Verdanza",
      });
      setDraft("");
      setMessage("Commentaire envoyé. Il sera visible après modération.");
      trackBlogCommentSubmit(article);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Envoi du commentaire impossible.");
    } finally {
      setIsSubmittingComment(false);
    }
  }

  function goToLogin() {
    navigate("/connexion", { state: { from: blogArticlePath(article) } });
  }

  return (
    <section
      className="mt-12 rounded-lg border border-forest/10 bg-ivory p-5 sm:p-7"
      aria-labelledby="blog-engagement-title"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-champagne">
            Réactions
          </p>
          <h2 id="blog-engagement-title" className="mt-2 font-display text-3xl text-forest">
            Votre avis sur ce guide
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={summary.viewerLiked ? "btn-primary min-h-10 px-4 py-2" : "btn-secondary min-h-10 px-4 py-2"}
            aria-pressed={summary.viewerLiked}
            disabled={isUpdatingLike}
            onClick={() => void handleLike()}
          >
            <Heart size={17} fill={summary.viewerLiked ? "currentColor" : "none"} />
            {isUpdatingLike ? "..." : summary.viewerLiked ? "Aimé" : "J'aime"}
            <span aria-label={`${summary.likeCount} J'aime`}>{summary.likeCount}</span>
          </button>
          <button
            type="button"
            className="btn-secondary min-h-10 px-4 py-2"
            onClick={() => void handleShare()}
          >
            <Share2 size={17} />
            Partager
          </button>
        </div>
      </div>

      {isLoading && <p className="mt-5 text-sm text-ink/60">Chargement des réactions...</p>}
      {message && <p className="mt-5 rounded-md border border-forest/15 bg-cream px-4 py-3 text-sm text-forest" role="status">{message}</p>}
      {error && <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p>}

      <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <section aria-labelledby="blog-comments-title">
          <div className="flex items-center gap-2 text-forest">
            <MessageCircle size={18} />
            <h3 id="blog-comments-title" className="font-semibold">
              Commentaires approuvés ({summary.approvedCommentCount})
            </h3>
          </div>
          {!comments.length && !isLoading && (
            <p className="mt-4 rounded-md border border-forest/10 bg-cream px-4 py-4 text-sm text-ink/60">
              Aucun commentaire approuvé pour le moment.
            </p>
          )}
          <div className="mt-4 grid gap-3">
            {comments.map((comment) => (
              <article key={comment.id} className="rounded-md border border-forest/10 bg-cream px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm text-forest">{comment.displayName}</strong>
                  <time className="text-xs text-ink/50" dateTime={comment.createdAt}>
                    {formatDate(comment.createdAt)}
                  </time>
                </div>
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-ink/70">{comment.text}</p>
              </article>
            ))}
          </div>
          {hasMore && (
            <button
              type="button"
              className="btn-secondary mt-4 min-h-10 px-4 py-2"
              onClick={() => void loadComments(page + 1, true)}
            >
              Afficher plus
            </button>
          )}
        </section>

        <form className="rounded-md border border-forest/10 bg-cream p-4" onSubmit={handleSubmitComment}>
          <h3 className="font-semibold text-forest">Ajouter un commentaire</h3>
          {!user ? (
            <div className="mt-4">
              <p className="text-sm text-ink/65">Connectez-vous pour commenter.</p>
              <button type="button" className="btn-primary mt-4 min-h-10 px-4 py-2" onClick={goToLogin}>
                Connectez-vous pour commenter
              </button>
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm text-ink/60">
                Publié sous le nom {customerProfile?.displayName || user.displayName || "Lecteur Verdanza"} après modération.
              </p>
              <label className="mt-4 block text-sm font-medium text-forest">
                Commentaire
                <textarea
                  className="input-field mt-2 min-h-32 resize-y"
                  minLength={8}
                  maxLength={1000}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  required
                />
              </label>
              <button className="btn-primary mt-4 min-h-10 px-4 py-2" disabled={isSubmittingComment}>
                <Send size={16} />
                {isSubmittingComment ? "Envoi..." : "Envoyer à la modération"}
              </button>
            </>
          )}
        </form>
      </div>
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
