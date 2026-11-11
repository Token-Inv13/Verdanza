import { next, rewrite } from "@vercel/functions";
import { publicProductRoute } from "./src/lib/publicProductRoutes.js";

export default function proxy(request: Request) {
  const url = new URL(request.url);
  const slug = url.pathname.match(/^\/produits\/([a-z0-9-]+)\/?$/)?.[1];
  if (!slug || !publicProductRoute(slug)) return next();
  const destination = new URL("/api/product-page", url.origin);
  destination.searchParams.set("slug", slug);
  return rewrite(destination);
}
