import type { Product } from "../types";
import type { BlogArticle } from "../types/blog";
import { verdanzaPublicContact } from "../config/publicContact";
import { BRAND_STRUCTURED_DATA_LOGO } from "./brandAssets";
import { isProductOrderable as isPublicProductOrderable } from "./cartStock";
import { getActiveSocialLinks } from "./socialLinks";
import { absoluteUrl } from "./siteUrl";
import { normalizeProductImages } from "./productImages";

export type JsonLdValue =
  | string
  | number
  | boolean
  | null
  | JsonLdValue[]
  | { [key: string]: JsonLdValue };

export type BreadcrumbItem = {
  name: string;
  path: string;
};

const organizationId = `${absoluteUrl("/")}#organization`;
const websiteId = `${absoluteUrl("/")}#website`;

export function isProductOrderable(product: Product) {
  return isPublicProductOrderable(product);
}

export function productAvailability(product: Product) {
  return isPublicProductOrderable(product)
    ? "https://schema.org/InStock"
    : "https://schema.org/OutOfStock";
}

export function productCategoryLabel(product: Pick<Product, "category">) {
  return product.category === "flowers" ? "Fleur CBD" : "Resine CBD";
}

export function productPath(product: Pick<Product, "slug">) {
  return `/produits/${product.slug}`;
}

export function buildProductJsonLd(product: Product): JsonLdValue {
  const url = absoluteUrl(productPath(product));
  const imageUrls = normalizeProductImages(product).map((image) => absoluteUrl(image.url));

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: product.name,
    description: product.longDescription,
    image: imageUrls.length ? imageUrls : [absoluteUrl(product.image)],
    sku: product.id,
    category: productCategoryLabel(product),
    url,
    offers: {
      "@type": "Offer",
      "@id": `${url}#offer`,
      url,
      price: product.price,
      priceCurrency: "EUR",
      itemCondition: "https://schema.org/NewCondition",
      availability: productAvailability(product),
      seller: {
        "@id": organizationId,
      },
    },
  };
}

export function buildHomeJsonLd(contactEmail?: string): JsonLdValue {
  const contactPoint: Record<string, JsonLdValue> = {
    "@type": "ContactPoint",
    contactType: "customer service",
    telephone: verdanzaPublicContact.internationalPhone,
    availableLanguage: "fr",
  };
  const store: Record<string, JsonLdValue> = {
    "@type": "OnlineStore",
    "@id": organizationId,
    name: "Verdanza",
    url: absoluteUrl("/"),
    logo: absoluteUrl(BRAND_STRUCTURED_DATA_LOGO),
    telephone: verdanzaPublicContact.internationalPhone,
    sameAs: getActiveSocialLinks().map((link) => link.url),
    contactPoint,
  };

  if (contactEmail) {
    store.email = contactEmail;
    contactPoint.email = contactEmail;
  }

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": websiteId,
        url: absoluteUrl("/"),
        name: "Verdanza",
        publisher: {
          "@id": organizationId,
        },
      },
      store,
    ],
  };
}

export function buildBreadcrumbJsonLd(items: BreadcrumbItem[], pagePath: string): JsonLdValue {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "@id": `${absoluteUrl(pagePath)}#breadcrumb`,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function buildBlogPostingJsonLd(article: BlogArticle): JsonLdValue {
  const url = absoluteUrl(`/blog/${article.slug}`);

  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    url,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
    headline: article.title,
    description: article.description,
    image: [
      absoluteUrl(article.images.square),
      absoluteUrl(article.images.landscape),
      absoluteUrl(article.images.wide),
    ],
    datePublished: article.datePublished,
    dateModified: article.dateModified,
    inLanguage: "fr-FR",
    author: {
      "@type": "Organization",
      name: article.authorName,
      url: absoluteUrl("/a-propos"),
    },
    publisher: {
      "@id": organizationId,
    },
  };
}
