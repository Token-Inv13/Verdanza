import { products } from "../src/data/products";
import { blogArticlePath, publishedBlogArticles } from "../src/data/blogArticles";

const siteUrl = "https://verdanza.fr";
const blogIndexLastmod = publishedBlogArticles
  .map((article) => article.dateModified)
  .sort()
  .at(-1);
const livraisonLocaleLastmod = "2026-08-11T00:30:41+02:00";

export type SeoRouteKind =
  | "public-indexable"
  | "public-noindex"
  | "private"
  | "admin"
  | "cart-checkout"
  | "product-dynamic"
  | "fallback";

export type SeoRoute = {
  path: string;
  kind: SeoRouteKind;
  component: string;
  indexable: boolean;
  dynamic?: boolean;
  lastmod?: string;
};

export const staticSeoRoutes: SeoRoute[] = [
  { path: "/", kind: "public-indexable", component: "HomePage", indexable: true },
  { path: "/boutique", kind: "public-indexable", component: "ShopPage", indexable: true },
  {
    path: "/decouvrir-verdanza",
    kind: "public-indexable",
    component: "FlyerLandingPage",
    indexable: true,
  },
  {
    path: "/blog",
    kind: "public-indexable",
    component: "BlogPage",
    indexable: true,
    lastmod: blogIndexLastmod,
  },
  {
    path: "/fleurs-cbd",
    kind: "public-indexable",
    component: "CategoryPage(flowers)",
    indexable: true,
  },
  {
    path: "/resines-cbd",
    kind: "public-indexable",
    component: "CategoryPage(resins)",
    indexable: true,
  },
  {
    path: "/livraison",
    kind: "public-indexable",
    component: "DeliveryPage(overview)",
    indexable: true,
  },
  {
    path: "/livraison-locale",
    kind: "public-indexable",
    component: "DeliveryPage(local)",
    indexable: true,
    lastmod: livraisonLocaleLastmod,
  },
  {
    path: "/livraison-postale",
    kind: "public-indexable",
    component: "DeliveryPage(postal)",
    indexable: true,
  },
  {
    path: "/qualite-conformite",
    kind: "public-indexable",
    component: "ContentPage(quality)",
    indexable: true,
  },
  { path: "/a-propos", kind: "public-indexable", component: "ContentPage(about)", indexable: true },
  { path: "/faq", kind: "public-indexable", component: "ContentPage(faq)", indexable: true },
  {
    path: "/contact",
    kind: "public-indexable",
    component: "ContentPage(contact)",
    indexable: true,
  },
  {
    path: "/mentions-legales",
    kind: "public-indexable",
    component: "LegalPage",
    indexable: true,
  },
  { path: "/cgv", kind: "public-indexable", component: "LegalPage", indexable: true },
  {
    path: "/confidentialite",
    kind: "public-indexable",
    component: "LegalPage",
    indexable: true,
  },
  { path: "/retours", kind: "public-indexable", component: "LegalPage", indexable: true },
  { path: "/connexion", kind: "public-noindex", component: "AuthPage(login)", indexable: false },
  {
    path: "/auth/action",
    kind: "public-noindex",
    component: "FirebaseAuthActionPage",
    indexable: false,
  },
  {
    path: "/inscription",
    kind: "public-noindex",
    component: "AuthPage(register)",
    indexable: false,
  },
  { path: "/panier", kind: "cart-checkout", component: "CartPage", indexable: false },
  { path: "/checkout", kind: "cart-checkout", component: "CheckoutPage", indexable: false },
  {
    path: "/checkout/success",
    kind: "cart-checkout",
    component: "CheckoutSuccessPage",
    indexable: false,
  },
  {
    path: "/checkout/cancel",
    kind: "cart-checkout",
    component: "CheckoutCancelPage",
    indexable: false,
  },
  { path: "/compte", kind: "private", component: "AccountLayout", indexable: false },
  {
    path: "/compte/commandes",
    kind: "private",
    component: "AccountOrdersPage",
    indexable: false,
  },
  {
    path: "/compte/favoris",
    kind: "private",
    component: "AccountFavoritesPage",
    indexable: false,
  },
  {
    path: "/compte/profil",
    kind: "private",
    component: "AccountProfilePage",
    indexable: false,
  },
  { path: "/admin", kind: "admin", component: "AdminLayout/AdminPage", indexable: false },
  {
    path: "/admin/analytics",
    kind: "admin",
    component: "AdminPage(Analytics)",
    indexable: false,
  },
  {
    path: "/admin/produits",
    kind: "admin",
    component: "AdminPage(Produits)",
    indexable: false,
  },
  { path: "/admin/stocks", kind: "admin", component: "AdminPage(Stocks)", indexable: false },
  {
    path: "/admin/commandes",
    kind: "admin",
    component: "AdminPage(Commandes)",
    indexable: false,
  },
  {
    path: "/admin/livraisons",
    kind: "admin",
    component: "AdminPage(Livraisons locales)",
    indexable: false,
  },
  { path: "/admin/clients", kind: "admin", component: "AdminPage(Clients)", indexable: false },
  { path: "/admin/favoris", kind: "admin", component: "AdminPage(Favoris)", indexable: false },
  { path: "/admin/avis", kind: "admin", component: "AdminPage(Avis)", indexable: false },
  { path: "/admin/coupons", kind: "admin", component: "AdminPage(Coupons)", indexable: false },
  { path: "/admin/bannieres", kind: "admin", component: "AdminPage(Bannieres)", indexable: false },
  { path: "/admin/archives", kind: "admin", component: "AdminArchivesPage", indexable: false },
  {
    path: "/admin/comptabilite",
    kind: "admin",
    component: "AdminPage(Comptabilite)",
    indexable: false,
  },
  { path: "/admin/factures", kind: "admin", component: "AdminPage(Factures)", indexable: false },
  {
    path: "/admin/facturation",
    kind: "admin",
    component: "AdminPage(Facturation)",
    indexable: false,
  },
  {
    path: "/admin/parametres",
    kind: "admin",
    component: "AdminPage(Parametres)",
    indexable: false,
  },
  {
    path: "/produits/produit-introuvable-test",
    kind: "fallback",
    component: "ProductPage(not found)",
    indexable: false,
    dynamic: true,
  },
  { path: "/route-introuvable-test", kind: "fallback", component: "NotFoundPage", indexable: false },
];

export function productSeoRoutes(): SeoRoute[] {
  return products
    .filter((product) => product.isActive)
    .map((product) => ({
      path: `/produits/${product.slug}`,
      kind: "product-dynamic" as const,
      component: "ProductPage",
      indexable: true,
      dynamic: true,
    }));
}

export function blogSeoRoutes(): SeoRoute[] {
  return publishedBlogArticles.map((article) => ({
    path: blogArticlePath(article),
    kind: "public-indexable" as const,
    component: "BlogArticlePage",
    indexable: true,
    dynamic: true,
    lastmod: article.dateModified,
  }));
}

export function allSeoRoutes() {
  return [
    ...staticSeoRoutes.filter((route) => route.kind !== "fallback"),
    ...blogSeoRoutes(),
    ...productSeoRoutes(),
    ...staticSeoRoutes.filter((route) => route.kind === "fallback"),
  ];
}

export function prerenderSeoRoutes() {
  return allSeoRoutes().filter((route) => route.kind !== "fallback");
}

export function fallbackSeoRoute() {
  const route = staticSeoRoutes.find((entry) => entry.path === "/route-introuvable-test");
  if (!route) throw new Error("Missing fallback route definition.");
  return route;
}

export function prerenderFallbackSeoRoutes() {
  return staticSeoRoutes.filter((route) => route.kind === "fallback");
}

export function sitemapUrls() {
  return sitemapEntries().map((entry) => entry.loc);
}

export function sitemapEntries() {
  const paths = allSeoRoutes()
    .filter((route) => route.indexable)
    .map((route) => ({
      loc: canonicalUrl(route.path),
      lastmod: route.lastmod,
    }));
  return uniqueEntries(paths);
}

export function canonicalUrl(path: string) {
  const url = new URL(path, siteUrl);
  url.hash = "";
  url.search = "";
  url.pathname = normalizePathname(url.pathname);
  return url.toString();
}

function normalizePathname(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}

function uniqueEntries(entries: { loc: string; lastmod?: string }[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.loc)) return false;
    seen.add(entry.loc);
    return true;
  });
}
