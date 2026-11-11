import type { Product } from "../types";
import type { BlogArticle } from "../types/blog";
import { verdanzaPublicContact } from "../config/publicContact";
import { RETURN_POLICY_PATH, WITHDRAWAL_NOTICE_DAYS } from "../config/returnPolicy";
import { BRAND_STRUCTURED_DATA_LOGO } from "./brandAssets";
import { isProductOrderable as isPublicProductOrderable } from "./cartStock";
import { getActiveSocialLinks } from "./socialLinks";
import { absoluteUrl } from "./siteUrl";
import { normalizeProductImages } from "./productImages";
import { serverProductAvailability } from "./serverProductAvailability";
import { isProductInternalReference, normalizeInternalReference } from "./productReferences";
import {
  POSTAL_DELIVERY_FEE,
  POSTAL_DELIVERY_MINIMUM,
  POSTAL_DELIVERY_NAME,
  POSTAL_FREE_SHIPPING_THRESHOLD,
  POSTAL_HANDLING_MAX_DAYS,
  POSTAL_TRANSIT_DAYS,
} from "../config/deliveryRules";

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
  // A disabled editorial fallback is not evidence that the real stock is zero.
  if (product.stockVerified === false) return product.isActive === false ? undefined : serverProductAvailability(product);
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

export function productSku(product: Pick<Product, "id" | "internalReference">) {
  const reference = normalizeInternalReference(product.internalReference);
  return isProductInternalReference(reference) ? reference : product.id;
}

export function buildProductJsonLd(product: Product): JsonLdValue {
  const url = absoluteUrl(productPath(product));
  const imageUrls = normalizeProductImages(product).map((image) => absoluteUrl(image.url));
  const availability = productAvailability(product);

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: product.name,
    description: product.longDescription,
    image: imageUrls.length ? imageUrls : [absoluteUrl(product.image)],
    sku: productSku(product),
    brand: { "@type": "Brand", name: "Verdanza" },
    category: productCategoryLabel(product),
    url,
    offers: {
      "@type": "Offer",
      "@id": `${url}#offer`,
      url,
      price: product.price,
      priceCurrency: "EUR",
      itemCondition: "https://schema.org/NewCondition",
      ...(availability ? { availability } : {}),
      shippingDetails: buildPostalShippingDetailsJsonLd(),
      hasMerchantReturnPolicy: buildMerchantReturnPolicyJsonLd(),
      seller: {
        "@id": organizationId,
      },
    },
  };
}

export function buildMerchantReturnPolicyJsonLd(): JsonLdValue {
  return {
    "@type": "MerchantReturnPolicy",
    "@id": `${absoluteUrl(RETURN_POLICY_PATH)}#politique-de-retour`,
    applicableCountry: "FR",
    returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: WITHDRAWAL_NOTICE_DAYS,
    returnMethod: "https://schema.org/ReturnByMail",
    returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
    merchantReturnLink: absoluteUrl(RETURN_POLICY_PATH),
  };
}

function organizationReturnPolicy(): JsonLdValue {
  return {
    ...buildMerchantReturnPolicyJsonLd() as Record<string, JsonLdValue>,
    customerRemorseReturnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
    itemDefectReturnFees: "https://schema.org/FreeReturn",
    refundType: "https://schema.org/FullRefund",
  };
}

export function buildReturnPolicyOrganizationJsonLd(): JsonLdValue {
  return {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": organizationId,
    name: "Verdanza",
    url: absoluteUrl("/"),
    hasMerchantReturnPolicy: organizationReturnPolicy(),
  };
}

function shippingDays(minValue: number, maxValue: number): JsonLdValue {
  return { "@type": "QuantitativeValue", minValue, maxValue, unitCode: "DAY" };
}

export function buildPostalShippingDetailsJsonLd(): JsonLdValue {
  return {
    "@type": "OfferShippingDetails",
    shippingLabel: `${POSTAL_DELIVERY_NAME} — France métropolitaine`,
    shippingDestination: { "@type": "DefinedRegion", addressCountry: "FR" },
    shippingSettingsLink: absoluteUrl("/livraison-postale"),
    // The final rate depends on the whole eligible basket, not the unit price.
    // A maximum remains true for both paid shipping and free shipping at €50.
    shippingRate: { "@type": "MonetaryAmount", maxValue: POSTAL_DELIVERY_FEE, currency: "EUR" },
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      handlingTime: shippingDays(0, POSTAL_HANDLING_MAX_DAYS),
      transitTime: shippingDays(POSTAL_TRANSIT_DAYS, POSTAL_TRANSIT_DAYS),
    },
  };
}

export function buildPostalShippingServiceJsonLd(): JsonLdValue {
  const destination = { "@type": "DefinedRegion", addressCountry: "FR" };
  const transitTime = {
    "@type": "ServicePeriod",
    duration: shippingDays(POSTAL_TRANSIT_DAYS, POSTAL_TRANSIT_DAYS),
  };
  return {
    "@type": "ShippingService",
    "@id": `${absoluteUrl("/livraison-postale")}#colissimo`,
    name: `${POSTAL_DELIVERY_NAME} — France métropolitaine`,
    description: `Minimum ${POSTAL_DELIVERY_MINIMUM} EUR ; frais ${POSTAL_DELIVERY_FEE} EUR, offerts dès ${POSTAL_FREE_SHIPPING_THRESHOLD} EUR de sous-total éligible.`,
    url: absoluteUrl("/livraison-postale"),
    fulfillmentType: "https://schema.org/FulfillmentTypeDelivery",
    handlingTime: {
      "@type": "ServicePeriod",
      duration: shippingDays(0, POSTAL_HANDLING_MAX_DAYS),
    },
    shippingConditions: [
      {
        "@type": "ShippingConditions",
        shippingDestination: destination,
        orderValue: { "@type": "MonetaryAmount", maxValue: POSTAL_DELIVERY_MINIMUM - 0.01, currency: "EUR" },
        doesNotShip: true,
      },
      {
        "@type": "ShippingConditions",
        shippingDestination: destination,
        orderValue: { "@type": "MonetaryAmount", minValue: POSTAL_DELIVERY_MINIMUM, maxValue: POSTAL_FREE_SHIPPING_THRESHOLD - 0.01, currency: "EUR" },
        shippingRate: { "@type": "MonetaryAmount", value: POSTAL_DELIVERY_FEE, currency: "EUR" },
        transitTime,
      },
      {
        "@type": "ShippingConditions",
        shippingDestination: destination,
        orderValue: { "@type": "MonetaryAmount", minValue: POSTAL_FREE_SHIPPING_THRESHOLD, currency: "EUR" },
        shippingRate: { "@type": "MonetaryAmount", value: 0, currency: "EUR" },
        transitTime,
      },
    ],
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
    hasShippingService: buildPostalShippingServiceJsonLd(),
    hasMerchantReturnPolicy: organizationReturnPolicy(),
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
      "@type": "Organization",
      "@id": organizationId,
      name: "Verdanza",
      url: absoluteUrl("/"),
      logo: absoluteUrl(BRAND_STRUCTURED_DATA_LOGO),
    },
  };
}
