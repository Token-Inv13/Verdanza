import type { ReactNode } from "react";

export type BlogArticleStatus = "draft" | "published";

export type BlogArticleImageSet = {
  square: string;
  landscape: string;
  wide: string;
};

export type BlogArticleLink = {
  to: string;
  label: string;
};

export type BlogArticleTable = {
  caption: string;
  headers: string[];
  rows: string[][];
};

export type BlogArticleBlock =
  | { type: "heading"; id: string; text: string }
  | { type: "paragraph"; text: ReactNode }
  | { type: "list"; items: ReactNode[] }
  | { type: "table"; table: BlogArticleTable }
  | { type: "note"; text: ReactNode }
  | { type: "links"; title: string; links: BlogArticleLink[] };

export type BlogArticle = {
  slug: string;
  title: string;
  seoTitle: string;
  description: string;
  excerpt: string;
  category: string;
  authorName: string;
  datePublished: string;
  dateModified: string;
  readingTime: string;
  status: BlogArticleStatus;
  images: BlogArticleImageSet;
  blocks: BlogArticleBlock[];
  relatedSlugs: string[];
  links: BlogArticleLink[];
};
