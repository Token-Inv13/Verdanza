import { products } from "../src/data/products";

const siteUrl = "https://verdanza.fr";

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
};

export const staticSeoRoutes: SeoRoute[] = [
  { path: "/", kind: "public-indexable", component: "HomePage", indexable: true },
  { path: "/boutique", kind: "public-indexable", component: "ShopPage", indexable: true },
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
    path: "/livraison-express-aix",
    kind: "public-indexable",
    component: "DeliveryPage(local)",
    indexable: true,
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

export function allSeoRoutes() {
  return [
    ...staticSeoRoutes.filter((route) => route.kind !== "fallback"),
    ...productSeoRoutes(),
    ...staticSeoRoutes.filter((route) => route.kind === "fallback"),
  ];
}

export function sitemapUrls() {
  const paths = allSeoRoutes()
    .filter((route) => route.indexable)
    .map((route) => route.path);
  return [...new Set(paths)].map((path) => canonicalUrl(path));
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
