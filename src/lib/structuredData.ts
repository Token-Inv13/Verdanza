import type { Product } from "../types";
import { absoluteUrl } from "./siteUrl";

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
  return !product.comingSoon && product.stockStatus !== "coming_soon";
}

export function productAvailability(product: Product) {
  return isProductOrderable(product)
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

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: product.name,
    description: product.longDescription,
    image: [absoluteUrl(product.image)],
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
  const store: Record<string, JsonLdValue> = {
    "@type": "OnlineStore",
    "@id": organizationId,
    name: "Verdanza",
    url: absoluteUrl("/"),
    logo: absoluteUrl("/verdanza-logo.png"),
  };

  if (contactEmail) {
    store.email = contactEmail;
    store.contactPoint = {
      "@type": "ContactPoint",
      contactType: "customer service",
      email: contactEmail,
      availableLanguage: "fr",
    };
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
