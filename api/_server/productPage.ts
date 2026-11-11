import { SERVER_AVAILABILITY_SCRIPT_ID, type ServerProductAvailability } from "../../src/lib/serverProductAvailability.js";
import { publicProductRoute } from "../../src/lib/publicProductRoutes.js";
import type { VercelRequestLike, VercelResponseLike } from "./http.js";

export type PublicProductStock = { slug?: unknown; stock?: unknown; isActive?: unknown };
type ProductPageDependencies = {
  loadStock: (id: string) => Promise<PublicProductStock | undefined>;
  loadTemplate: (slug: string | null) => Promise<string>;
  now?: () => Date;
};

function serialize(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function renderVerifiedProductPage(html: string, snapshot: ServerProductAvailability) {
  let productFound = false;
  const rendered = html.replace(/(<script\b[^>]*type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/g, (script, opening, content, closing) => {
    const schema = JSON.parse(content);
    if (schema["@type"] !== "Product") return script;
    if (!schema.offers || schema.url !== `https://verdanza.fr/produits/${snapshot.slug}`) throw new Error("Product template mismatch");
    productFound = true;
    schema.offers.availability = snapshot.availability;
    return opening + serialize(schema) + closing;
  });
  if (!productFound) throw new Error("Product structured data missing");
  const label = snapshot.availability === "https://schema.org/InStock" ? "Disponible" : "Rupture de stock";
  const withLabel = rendered.replace(/(<span\b[^>]*data-product-availability[^>]*>)[\s\S]*?(<\/span>)/g, `$1${label}$2`);
  if (withLabel === rendered) throw new Error("Public availability label missing");
  const withButton = withLabel.replace(/(<button\b[^>]*data-floating-help-suppress="purchase-cart"[^>]*>)([\s\S]*?)(<\/button>)/g, (_match, opening, content, closing) =>
    opening + content.replace(/Disponibilité à confirmer/g, label === "Disponible" ? "Chargement des formats…" : label) + closing,
  );
  return withButton.replace("</head>", `<script id="${SERVER_AVAILABILITY_SCRIPT_ID}" type="application/json">${serialize(snapshot)}</script></head>`);
}

export function createProductPageHandler(dependencies: ProductPageDependencies) {
  return async (request: VercelRequestLike, response: VercelResponseLike) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "private, no-store, max-age=0");
    response.setHeader("CDN-Cache-Control", "no-store");
    response.setHeader("Vercel-CDN-Cache-Control", "no-store");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      response.statusCode = 405;
      response.end();
      return;
    }
    const url = new URL(request.url || "/", "https://verdanza.fr");
    const slug = url.searchParams.get("slug") || url.pathname.match(/^\/produits\/([a-z0-9-]+)\/?$/)?.[1] || "";
    const route = /^[a-z0-9-]{1,100}$/.test(slug) ? publicProductRoute(slug) : undefined;
    if (!route) {
      response.statusCode = 404;
      response.end(request.method === "HEAD" ? undefined : await dependencies.loadTemplate(null));
      return;
    }
    const template = await dependencies.loadTemplate(slug);
    try {
      const product = await dependencies.loadStock(route.id);
      if (!product || product.isActive !== true || product.slug !== slug) {
        response.statusCode = 404;
        response.end(request.method === "HEAD" ? undefined : await dependencies.loadTemplate(null));
        return;
      }
      if (typeof product.stock !== "number" || !Number.isFinite(product.stock) || product.stock < 0) throw new Error("Unverified stock");
      const snapshot: ServerProductAvailability = {
        version: 1, productId: route.id, slug,
        availability: Math.floor(product.stock) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        verifiedAt: (dependencies.now?.() ?? new Date()).toISOString(),
      };
      const html = renderVerifiedProductPage(template, snapshot);
      response.statusCode = 200;
      response.setHeader("X-Verdanza-Availability", "verified");
      response.end(request.method === "HEAD" ? undefined : html);
    } catch {
      // An unavailable database is not evidence that a product is sold out.
      response.statusCode = 503;
      response.setHeader("Retry-After", "60");
      response.end(request.method === "HEAD" ? undefined : template);
    }
  };
}
