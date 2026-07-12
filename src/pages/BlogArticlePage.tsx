import { Link, useParams } from "react-router-dom";
import { Clock3, UserRound } from "lucide-react";
import { useEffect, useRef } from "react";
import { BlogArticleRenderer } from "../components/BlogArticleRenderer";
import { BlogCard } from "../components/BlogCard";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { JsonLd } from "../components/JsonLd";
import { Seo } from "../components/Seo";
import {
  blogArticlePath,
  getPublishedBlogArticleBySlug,
  publishedBlogArticles,
} from "../data/blogArticles";
import { buildBlogPostingJsonLd } from "../lib/structuredData";
import { formatFrenchDate } from "../lib/dateFormat";
import { staticImageVariants } from "../lib/generatedImageVariants";
import { trackBlogArticleView, trackBlogReadProgress, trackCtaClick } from "../lib/analytics";

function ctaCategoryForPath(path: string) {
  if (path.startsWith("/blog")) return "content";
  if (path.startsWith("/produits")) return "product_navigation";
  if (path === "/boutique") return "shop_navigation";
  if (path === "/fleurs-cbd" || path === "/resines-cbd") return "category_navigation";
  if (path.startsWith("/livraison")) return "delivery";
  return "navigation";
}

function ctaIdForPath(prefix: string, path: string) {
  return `${prefix}_${path.replace(/^\/+/, "").replace(/[^a-z0-9]+/gi, "_") || "home"}`;
}

export function BlogArticlePage() {
  const { slug } = useParams();
  const article = slug ? getPublishedBlogArticleBySlug(slug) : undefined;
  const viewedSlug = useRef("");
  const progressTracked = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!article || viewedSlug.current === article.slug) return;
    viewedSlug.current = article.slug;
    progressTracked.current = new Set();
    trackBlogArticleView(article);
  }, [article]);

  useEffect(() => {
    if (!article) return undefined;
    const trackedArticle = article;
    function handleScroll() {
      const documentHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (documentHeight <= 0) return;
      const progress = Math.round((window.scrollY / documentHeight) * 100);
      for (const threshold of [25, 50, 75, 90] as const) {
        if (progress >= threshold && !progressTracked.current.has(threshold)) {
          progressTracked.current.add(threshold);
          trackBlogReadProgress(trackedArticle, threshold);
        }
      }
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [article]);

  if (!article) {
    return (
      <main className="container-page py-16">
        <Seo
          title="Guide introuvable - Verdanza CBD"
          description="Ce guide Verdanza n'est pas disponible."
          noindex
        />
        <Breadcrumbs
          structuredData={false}
          items={[
            { name: "Accueil", path: "/" },
            { name: "Guides CBD", path: "/blog" },
            {
              name: "Guide introuvable",
              path: slug ? `/blog/${slug}` : "/blog",
              current: true,
            },
          ]}
        />
        <h1 className="font-display text-4xl text-forest">Guide introuvable</h1>
        <Link to="/blog" className="mt-6 inline-flex text-forest underline">
          Retour aux guides
        </Link>
      </main>
    );
  }

  const path = blogArticlePath(article);
  const heroImage = staticImageVariants[article.images.wide];
  const relatedArticles = publishedBlogArticles.filter((entry) =>
    article.relatedSlugs.includes(entry.slug),
  );

  return (
    <main className="container-page py-12">
      <Seo
        title={article.seoTitle}
        description={article.description}
        path={path}
        ogType="article"
        image={article.images.wide}
        articlePublishedTime={article.datePublished}
        articleModifiedTime={article.dateModified}
        articleAuthor={article.authorName}
      />
      <JsonLd id="blog-posting" data={buildBlogPostingJsonLd(article)} />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: "Guides CBD", path: "/blog" },
          { name: article.title, path, current: true },
        ]}
      />

      <article>
        <header className="max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-champagne">
            {article.category}
          </p>
          <h1 className="mt-4 font-display text-4xl leading-tight text-forest sm:text-5xl md:text-6xl">
            {article.title}
          </h1>
          <p className="mt-5 text-lg leading-8 text-ink/70">{article.excerpt}</p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm text-forest/75">
            <span className="inline-flex items-center gap-2">
              <UserRound size={16} /> {article.authorName}
            </span>
            <time dateTime={article.datePublished}>
              Publié le {formatFrenchDate(article.datePublished)}
            </time>
            {article.dateModified !== article.datePublished && (
              <time dateTime={article.dateModified}>
                Mis à jour le {formatFrenchDate(article.dateModified)}
              </time>
            )}
            <span className="inline-flex items-center gap-2">
              <Clock3 size={16} /> {article.readingTime}
            </span>
          </div>
        </header>

        <figure className="mt-8 overflow-hidden rounded-lg border border-forest/10 bg-cream">
          <img
            src={heroImage?.src || article.images.wide}
            srcSet={heroImage?.srcSet}
            sizes={heroImage?.sizes || "100vw"}
            alt=""
            width={heroImage?.width || 1600}
            height={heroImage?.height || 900}
            fetchPriority="high"
            decoding="async"
            className="aspect-video w-full object-cover"
          />
        </figure>

        <BlogArticleRenderer article={article} />

        <footer className="mt-12 grid gap-4 rounded-lg border border-forest/10 bg-cream p-6 sm:p-8 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <h2 className="font-display text-3xl text-forest">Poursuivre la lecture</h2>
            <p className="mt-3 text-sm leading-6 text-ink/70">
              Retrouvez les produits et les pages pratiques liés à ce guide.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {article.links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="btn-secondary min-h-10 py-2"
                onClick={() =>
                  trackCtaClick({
                    ctaId: ctaIdForPath("blog_article_link", link.to),
                    ctaLocation: "blog_article_footer",
                    destinationPath: link.to,
                    ctaCategory: ctaCategoryForPath(link.to),
                  })
                }
              >
                {link.label}
              </Link>
            ))}
          </div>
        </footer>
      </article>

      {relatedArticles.length > 0 && (
        <section className="mt-14">
          <div className="section-heading">
            <h2>À lire également</h2>
            <Link
              to="/blog"
              onClick={() =>
                trackCtaClick({
                  ctaId: "blog_article_all_guides",
                  ctaLocation: "blog_related_articles",
                  destinationPath: "/blog",
                  ctaCategory: "content",
                })
              }
            >
              Tous les guides
            </Link>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {relatedArticles.map((related) => (
              <BlogCard key={related.slug} article={related} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
