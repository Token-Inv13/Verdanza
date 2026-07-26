import { Link } from "react-router-dom";
import { CalendarDays, Clock3 } from "lucide-react";
import { blogArticlePath } from "../data/blogArticles";
import { formatFrenchDate } from "../lib/dateFormat";
import { staticImageVariants } from "../lib/generatedImageVariants";
import type { BlogArticle } from "../types/blog";

export function BlogCard({ article }: { article: BlogArticle }) {
  const image = staticImageVariants[article.images.landscape];

  return (
    <article className="overflow-hidden rounded-lg border border-forest/10 bg-ivory shadow-sm">
      <Link
        to={blogArticlePath(article)}
        className="block bg-cream"
        aria-label={`Lire le guide ${article.title}`}
      >
        <img
          src={image?.src || article.images.landscape}
          srcSet={image?.srcSet}
          sizes={image?.sizes || "(min-width: 1024px) 420px, 92vw"}
          alt=""
          width={image?.width || 1200}
          height={image?.height || 900}
          loading="lazy"
          decoding="async"
          className="aspect-[4/3] w-full object-cover transition hover:scale-[1.02]"
        />
      </Link>
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-champagne">
          <span>{article.category}</span>
          <span className="inline-flex items-center gap-1 text-forest/65">
            <CalendarDays size={14} /> {formatDate(article.datePublished)}
          </span>
          <span className="inline-flex items-center gap-1 text-forest/65">
            <Clock3 size={14} /> {article.readingTime}
          </span>
        </div>
        <h2 className="font-display text-3xl leading-tight text-forest">
          <Link to={blogArticlePath(article)}>{article.title}</Link>
        </h2>
        <p className="text-sm leading-6 text-ink/70">{article.excerpt}</p>
        <Link
          to={blogArticlePath(article)}
          className="inline-flex text-sm font-semibold text-forest underline decoration-champagne underline-offset-4"
        >
          Lire le guide
        </Link>
      </div>
    </article>
  );
}

const formatDate = formatFrenchDate;
