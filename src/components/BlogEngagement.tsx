import {
  FormEvent,
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  Copy,
  Facebook,
  Heart,
  MessageCircle,
  Send,
  Share2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { blogArticlePath } from "../data/blogArticles";
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

export const blogCommentsSectionId = "blog-comments";

type BlogEngagementContextValue = {
  article: BlogArticle;
  canonicalUrl: string;
  comments: BlogComment[];
  draft: string;
  error: string;
  hasMore: boolean;
  isLoading: boolean;
  isSubmittingComment: boolean;
  isUpdatingLike: boolean;
  message: string;
  publicName: string;
  summary: BlogEngagementSummary;
  user: ReturnType<typeof useAuth>["user"];
  clearError: () => void;
  goToLogin: () => void;
  loadMoreComments: () => Promise<void>;
  setDraft: (value: string) => void;
  submitComment: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  toggleLike: () => Promise<void>;
};

const BlogEngagementContext = createContext<BlogEngagementContextValue | null>(null);

function emptySummary(slug: string): BlogEngagementSummary {
  return {
    slug,
    likeCount: 0,
    viewerLiked: false,
    approvedCommentCount: 0,
  };
}

export function BlogEngagementProvider({
  article,
  children,
}: {
  article: BlogArticle;
  children: ReactNode;
}) {
  const { user, customerProfile } = useAuth();
  const navigate = useNavigate();
  const canonicalUrl = useMemo(() => absoluteUrl(blogArticlePath(article)), [article]);
  const [summary, setSummary] = useState<BlogEngagementSummary>(() => emptySummary(article.slug));
  const [comments, setComments] = useState<BlogComment[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingLike, setIsUpdatingLike] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const publicName = customerProfile?.displayName || user?.displayName || "Lecteur Verdanza";

  const loadComments = useCallback(async (nextPage = 1, append = false) => {
    const result = await listBlogComments({ slug: article.slug, page: nextPage, pageSize: 10 });
    setComments((current) => append ? [...current, ...result.comments] : result.comments);
    setHasMore(result.hasMore);
    setPage(result.page);
  }, [article.slug]);

  const loadEngagement = useCallback(async () => {
    setIsLoading(true);
    setError("");
    setSummary(emptySummary(article.slug));
    setComments([]);
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
    const timeout = window.setTimeout(() => setMessage(""), 4800);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const toggleLike = useCallback(async () => {
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
  }, [article, isUpdatingLike]);

  const submitComment = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      goToGuideLogin(navigate, article);
      return false;
    }
    if (isSubmittingComment) return false;
    setIsSubmittingComment(true);
    setError("");
    try {
      await createBlogComment({
        slug: article.slug,
        text: draft,
        displayName: publicName,
      });
      setDraft("");
      setMessage("Commentaire envoyé. Il sera visible après validation.");
      trackBlogCommentSubmit(article);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Envoi du commentaire impossible.");
      return false;
    } finally {
      setIsSubmittingComment(false);
    }
  }, [article, draft, isSubmittingComment, navigate, publicName, user]);

  const loadMoreComments = useCallback(async () => {
    setError("");
    try {
      await loadComments(page + 1, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chargement des commentaires impossible.");
    }
  }, [loadComments, page]);

  const goToLogin = useCallback(() => {
    goToGuideLogin(navigate, article);
  }, [article, navigate]);

  const value = useMemo<BlogEngagementContextValue>(() => ({
    article,
    canonicalUrl,
    comments,
    draft,
    error,
    hasMore,
    isLoading,
    isSubmittingComment,
    isUpdatingLike,
    message,
    publicName,
    summary,
    user,
    clearError: () => setError(""),
    goToLogin,
    loadMoreComments,
    setDraft,
    submitComment,
    toggleLike,
  }), [
    article,
    canonicalUrl,
    comments,
    draft,
    error,
    goToLogin,
    hasMore,
    isLoading,
    isSubmittingComment,
    isUpdatingLike,
    loadMoreComments,
    message,
    publicName,
    submitComment,
    summary,
    toggleLike,
    user,
  ]);

  return (
    <BlogEngagementContext.Provider value={value}>
      {children}
    </BlogEngagementContext.Provider>
  );
}

export function BlogEngagementActions({ layout }: { layout: "horizontal" | "vertical" }) {
  const {
    article,
    canonicalUrl,
    clearError,
    error,
    isUpdatingLike,
    summary,
    toggleLike,
  } = useBlogEngagement();
  const isVertical = layout === "vertical";
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [prefersNativeShare, setPrefersNativeShare] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const shareMenuId = useId();

  useEffect(() => {
    setCanNativeShare(typeof navigator.share === "function");
    setPrefersNativeShare(window.matchMedia("(max-width: 767px), (pointer: coarse)").matches);
  }, []);

  useEffect(() => {
    if (!isShareOpen) return undefined;
    popoverRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();

    function closeOnPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setIsShareOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsShareOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isShareOpen]);

  useEffect(() => {
    if (!shareMessage) return undefined;
    const timeout = window.setTimeout(() => setShareMessage(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [shareMessage]);

  async function shareNatively() {
    if (!navigator.share) return false;
    try {
      await navigator.share({ title: article.title, url: canonicalUrl });
      setShareMessage("Article partagé");
      trackBlogShare(article, "native");
      setIsShareOpen(false);
      return true;
    } catch (reason) {
      if ((reason as { name?: string })?.name === "AbortError") return true;
      return false;
    }
  }

  async function handlePrimaryShare() {
    clearError();
    if (prefersNativeShare && canNativeShare && await shareNatively()) return;
    setIsShareOpen((current) => !current);
  }

  async function copyLink() {
    try {
      await copyText(canonicalUrl);
      setShareMessage("Lien copié");
      trackBlogShare(article, "clipboard");
      setIsShareOpen(false);
      triggerRef.current?.focus();
    } catch {
      setShareMessage("Copie impossible");
    }
  }

  function scrollToComments() {
    const section = document.getElementById(blogCommentsSectionId);
    if (!section) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    section.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    window.setTimeout(() => section.focus({ preventScroll: true }), reducedMotion ? 0 : 220);
  }

  const actionClass = isVertical
    ? "group grid min-h-12 w-12 place-items-center gap-0.5 rounded-full border border-forest/15 bg-ivory px-1 py-2 text-forest shadow-sm transition duration-200 hover:border-champagne hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne focus-visible:ring-offset-2 motion-reduce:transition-none"
    : "group inline-flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-md border border-forest/15 bg-ivory px-2 py-2 text-[11px] font-semibold text-forest transition duration-200 hover:border-champagne hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne focus-visible:ring-offset-2 motion-reduce:transition-none sm:min-h-11 sm:w-auto sm:flex-row sm:gap-2 sm:rounded-full sm:px-3.5 sm:text-sm";
  const likeClass = `${actionClass} ${summary.viewerLiked ? "border-champagne/60 bg-cream shadow-[inset_0_0_0_1px_rgba(201,164,92,0.18)]" : ""}`;

  return (
    <div
      className="relative"
      data-blog-engagement-actions={layout}
      role="group"
      aria-label="Interactions avec ce guide"
    >
      <div className={isVertical ? "grid gap-2" : "grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center"}>
        <button
          type="button"
          className={likeClass}
          aria-label={summary.viewerLiked ? `Retirer mon J'aime, ${summary.likeCount} au total` : `J'aime ce guide, ${summary.likeCount} au total`}
          aria-pressed={summary.viewerLiked}
          disabled={isUpdatingLike}
          onClick={() => void toggleLike()}
        >
          <Heart
            size={isVertical ? 19 : 17}
            fill={summary.viewerLiked ? "currentColor" : "none"}
            className={summary.viewerLiked ? "motion-safe:animate-[blog-like-pop_180ms_ease-out]" : ""}
            aria-hidden="true"
          />
          {isVertical ? (
            <span className="text-[11px] font-semibold leading-none">{summary.likeCount}</span>
          ) : (
            <span className="flex items-center gap-2">
              <span>{isUpdatingLike ? "..." : "J'aime"}</span>
              <span className="border-l border-forest/15 pl-2 tabular-nums">{summary.likeCount}</span>
            </span>
          )}
        </button>

        <div className={isVertical ? "relative" : "relative h-full"}>
          <button
            ref={triggerRef}
            type="button"
            className={actionClass}
            aria-label="Partager ce guide"
            aria-haspopup="menu"
            aria-expanded={isShareOpen}
            aria-controls={isShareOpen ? shareMenuId : undefined}
            onClick={() => void handlePrimaryShare()}
          >
            <Share2 size={isVertical ? 19 : 17} aria-hidden="true" />
            {!isVertical && <span>Partager</span>}
          </button>

          {isShareOpen && (
            <div
              ref={popoverRef}
              id={shareMenuId}
              className={isVertical
                ? "absolute left-full top-0 z-30 ml-3 w-60 rounded-md border border-forest/15 bg-ivory p-2 shadow-soft"
                : "absolute left-0 top-full z-30 mt-2 w-64 rounded-md border border-forest/15 bg-ivory p-2 shadow-soft sm:left-auto sm:right-0"}
              role="menu"
              aria-label="Options de partage"
            >
              <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase text-forest/55">
                Partager ce guide
              </p>
              {canNativeShare && (
                <button
                  type="button"
                  className="blog-share-menu-item"
                  role="menuitem"
                  onClick={() => void shareNatively()}
                >
                  <Share2 size={16} aria-hidden="true" /> Système de partage
                </button>
              )}
              <button type="button" className="blog-share-menu-item" role="menuitem" onClick={() => void copyLink()}>
                <Copy size={16} aria-hidden="true" /> Copier le lien
              </button>
              <ShareLink
                href={`https://wa.me/?text=${encodeURIComponent(`${article.title} ${canonicalUrl}`)}`}
                label="WhatsApp"
                onShare={() => trackBlogShare(article, "whatsapp")}
              >
                <MessageCircle size={16} aria-hidden="true" />
              </ShareLink>
              <ShareLink
                href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(canonicalUrl)}`}
                label="Facebook"
                onShare={() => trackBlogShare(article, "facebook")}
              >
                <Facebook size={16} aria-hidden="true" />
              </ShareLink>
              <ShareLink
                href={`https://x.com/intent/post?text=${encodeURIComponent(article.title)}&url=${encodeURIComponent(canonicalUrl)}`}
                label="X"
                onShare={() => trackBlogShare(article, "x")}
              >
                <span className="text-sm font-semibold" aria-hidden="true">X</span>
              </ShareLink>
            </div>
          )}
        </div>

        <button
          type="button"
          className={actionClass}
          aria-label={`Accéder aux commentaires, ${summary.approvedCommentCount} au total`}
          onClick={scrollToComments}
        >
          <MessageCircle size={isVertical ? 19 : 17} aria-hidden="true" />
          {isVertical ? (
            <span className="text-[11px] font-semibold leading-none">{summary.approvedCommentCount}</span>
          ) : (
            <span className="flex items-center gap-2">
              <span>Commentaires</span>
              <span className="border-l border-forest/15 pl-2 tabular-nums">{summary.approvedCommentCount}</span>
            </span>
          )}
        </button>
      </div>

      {shareMessage && (
        <span className={isVertical ? "absolute left-full top-14 ml-3 whitespace-nowrap rounded-full bg-forest px-3 py-1.5 text-xs font-medium text-ivory" : "absolute left-0 top-full mt-2 rounded-full bg-forest px-3 py-1.5 text-xs font-medium text-ivory"} role="status">
          {shareMessage === "Lien copié" && <Check size={13} className="mr-1 inline" aria-hidden="true" />}
          {shareMessage}
        </span>
      )}
      {error && (
        <p className={isVertical ? "sr-only" : "mt-2 text-sm text-red-800"} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function BlogComments() {
  const {
    comments,
    draft,
    error,
    goToLogin,
    hasMore,
    isLoading,
    isSubmittingComment,
    loadMoreComments,
    message,
    publicName,
    setDraft,
    submitComment,
    summary,
    user,
  } = useBlogEngagement();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formId = useId();

  useEffect(() => {
    if (isFormOpen) textareaRef.current?.focus();
  }, [isFormOpen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (await submitComment(event)) setIsFormOpen(false);
  }

  return (
    <section
      id={blogCommentsSectionId}
      className="mt-12 max-w-4xl scroll-mt-28 border-t border-forest/15 pt-9 outline-none sm:mt-14 sm:pt-10"
      aria-labelledby="blog-comments-title"
      data-blog-comments-section
      tabIndex={-1}
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id="blog-comments-title" className="font-display text-3xl text-forest sm:text-4xl">
          Commentaires
        </h2>
        <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-cream px-2 py-1 text-xs font-semibold tabular-nums text-forest" aria-label={`${summary.approvedCommentCount} commentaires publics`}>
          {summary.approvedCommentCount}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-ink/60">
        Partagez votre avis ou posez une question sur ce guide.
      </p>

      {isLoading ? (
        <p className="mt-6 text-sm text-ink/55" aria-live="polite">Chargement des commentaires...</p>
      ) : comments.length > 0 ? (
        <div className="mt-6 divide-y divide-forest/10 border-y border-forest/10">
          {comments.map((comment) => (
            <article key={comment.id} className="flex gap-3 py-5 sm:gap-4 sm:py-6">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-cream text-sm font-semibold text-forest" aria-hidden="true">
                {initialsFor(comment.displayName)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <strong className="text-sm text-forest">{comment.displayName}</strong>
                  <time className="text-xs text-ink/45" dateTime={comment.createdAt}>
                    {formatDate(comment.createdAt)}
                  </time>
                </div>
                <p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-ink/70">
                  {comment.text}
                </p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-6 border-y border-forest/10 py-5" data-blog-comments-empty>
          <p className="text-sm font-medium text-forest">Aucun commentaire pour le moment.</p>
          <p className="mt-1 text-sm text-ink/55">Vous pouvez ouvrir la discussion.</p>
        </div>
      )}

      {hasMore && (
        <button
          type="button"
          className="mt-5 inline-flex min-h-11 items-center rounded-full border border-forest/15 px-4 py-2 text-sm font-semibold text-forest transition duration-200 hover:border-champagne hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne focus-visible:ring-offset-2 motion-reduce:transition-none"
          onClick={() => void loadMoreComments()}
        >
          Afficher plus de commentaires
        </button>
      )}

      {message && (
        <p className="mt-6 rounded-md border border-forest/15 bg-cream px-4 py-3 text-sm text-forest" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      <div className="mt-6">
        {!user ? (
          <button type="button" className="btn-primary min-h-11 rounded-full px-5 py-2.5" onClick={goToLogin}>
            <MessageCircle size={17} aria-hidden="true" />
            Se connecter pour commenter
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn-primary min-h-11 rounded-full px-5 py-2.5"
              aria-expanded={isFormOpen}
              aria-controls={formId}
              onClick={() => setIsFormOpen((current) => !current)}
            >
              <MessageCircle size={17} aria-hidden="true" />
              {isFormOpen ? "Refermer le formulaire" : "Écrire un commentaire"}
            </button>

            {isFormOpen && (
              <form
                id={formId}
                className="blog-comment-form mt-5 max-w-2xl rounded-md border border-forest/10 bg-cream/55 p-4 sm:p-5"
                onSubmit={(event) => void handleSubmit(event)}
              >
                <p className="text-sm text-ink/60">
                  Vous commentez en tant que <strong className="font-semibold text-forest">{publicName}</strong>.
                </p>
                <label className="mt-4 block text-sm font-medium text-forest" htmlFor={`${formId}-text`}>
                  Votre commentaire
                </label>
                <textarea
                  ref={textareaRef}
                  id={`${formId}-text`}
                  className="input-field mt-2 min-h-32 resize-y bg-ivory"
                  minLength={8}
                  maxLength={1000}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  required
                />
                <div className="mt-2 flex items-center justify-between gap-4 text-xs text-ink/50">
                  <span>8 caractères minimum</span>
                  <span className="tabular-nums">{draft.length}/1000</span>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button className="btn-primary min-h-11 rounded-full px-5 py-2.5" disabled={isSubmittingComment}>
                    <Send size={16} aria-hidden="true" />
                    {isSubmittingComment ? "Envoi..." : "Envoyer pour validation"}
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-forest underline decoration-champagne underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne"
                    onClick={() => setIsFormOpen(false)}
                  >
                    Annuler
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function ShareLink({
  children,
  href,
  label,
  onShare,
}: {
  children: ReactNode;
  href: string;
  label: string;
  onShare: () => void;
}) {
  return (
    <a
      className="blog-share-menu-item"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      role="menuitem"
      onClick={onShare}
    >
      {children} {label}
    </a>
  );
}

function useBlogEngagement() {
  const context = useContext(BlogEngagementContext);
  if (!context) throw new Error("Blog engagement components require BlogEngagementProvider.");
  return context;
}

function goToGuideLogin(navigate: ReturnType<typeof useNavigate>, article: BlogArticle) {
  const fallbackPath = blogArticlePath(article);
  const from = typeof window === "undefined"
    ? fallbackPath
    : `${window.location.pathname}${window.location.search}${window.location.hash}`;
  navigate("/connexion", { state: { from } });
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy failed");
}

function initialsFor(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase("fr-FR"))
    .join("") || "V";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value));
}
