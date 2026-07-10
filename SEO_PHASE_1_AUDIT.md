# SEO phase 1 audit - Verdanza.fr

Date: 2026-07-10

## Scope

This phase audited and strengthened the current React 18 + TypeScript + Vite SPA without changing framework, commerce flows, design, cart, orders, admin behavior, PWA, or blog architecture.

No Google Search Console indexation claim is made here. The checks below validate local production rendering and technical SEO signals only.

## Files changed

- `src/components/Seo.tsx`
- `src/pages/HomePage.tsx`
- `src/pages/ShopPage.tsx`
- `src/pages/CategoryPage.tsx`
- `src/pages/ProductPage.tsx`
- `src/pages/DeliveryPage.tsx`
- `src/pages/ContentPage.tsx`
- `src/pages/LegalPage.tsx`
- `src/pages/AuthPage.tsx`
- `src/pages/CartPage.tsx`
- `src/pages/CheckoutPage.tsx`
- `src/pages/CheckoutSuccessPage.tsx`
- `src/pages/CheckoutCancelPage.tsx`
- `src/pages/account/AccountLayout.tsx`
- `src/layouts/AdminLayout.tsx`
- `src/components/AdminAuthGate.tsx`
- `scripts/seoRoutes.ts`
- `scripts/generateSitemap.ts`
- `scripts/seoAudit.ts`
- `package.json`
- `public/robots.txt`
- `robots.txt`
- `public/sitemap.xml`

## Corrections implemented

- Extended `Seo` to support canonical URL normalization, `noindex`, Open Graph title/description/url/type/image, Twitter Card title/description/image, `summary_large_image` when a real image is passed, and stale image tag removal after SPA route changes.
- Canonicals are absolute `https://verdanza.fr` URLs, strip query/hash parameters, collapse duplicate slashes, and keep the current no-trailing-slash convention except `/`.
- Added explicit route paths to public pages so canonical URLs are stable after SPA navigation.
- Applied `noindex,nofollow` to login, registration, cart, checkout, checkout success/cancel, account, admin, product-not-found, and fallback 404 states.
- Updated `robots.txt` to allow crawling so search engines can see page-level `noindex`; it still references the production sitemap.
- Rebuilt `public/sitemap.xml` from a maintainable local route/product source, without arbitrary priority/frequency and without private/tunnel/admin/noindex URLs.
- Added `npm run sitemap` and `npm run audit:seo -- http://127.0.0.1:4173`.

## Route audit

| Route | Classification | Component | Indexable | Sitemap | Robots after JS |
|---|---|---|---:|---:|---|
| `/` | public indexable | `HomePage` | yes | yes | `index,follow` |
| `/boutique` | public indexable | `ShopPage` | yes | yes | `index,follow` |
| `/fleurs-cbd` | public indexable | `CategoryPage(flowers)` | yes | yes | `index,follow` |
| `/resines-cbd` | public indexable | `CategoryPage(resins)` | yes | yes | `index,follow` |
| `/produits/:slug` | dynamic product | `ProductPage` | yes for active local products | yes | `index,follow` |
| `/livraison-express-aix` | public indexable | `DeliveryPage(local)` | yes | yes | `index,follow` |
| `/livraison-postale` | public indexable | `DeliveryPage(postal)` | yes | yes | `index,follow` |
| `/qualite-conformite` | public indexable | `ContentPage(quality)` | yes | yes | `index,follow` |
| `/a-propos` | public indexable | `ContentPage(about)` | yes | yes | `index,follow` |
| `/faq` | public indexable | `ContentPage(faq)` | yes | yes | `index,follow` |
| `/contact` | public indexable | `ContentPage(contact)` | yes | yes | `index,follow` |
| `/mentions-legales` | public indexable | `LegalPage` | yes | yes | `index,follow` |
| `/cgv` | public indexable | `LegalPage` | yes | yes | `index,follow` |
| `/confidentialite` | public indexable | `LegalPage` | yes | yes | `index,follow` |
| `/retours` | public indexable | `LegalPage` | yes | yes | `index,follow` |
| `/connexion` | public noindex | `AuthPage(login)` | no | no | `noindex,nofollow` |
| `/inscription` | public noindex | `AuthPage(register)` | no | no | `noindex,nofollow` |
| `/panier` | cart/tunnel | `CartPage` | no | no | `noindex,nofollow` |
| `/checkout` | cart/tunnel | `CheckoutPage` | no | no | `noindex,nofollow` |
| `/checkout/success` | cart/tunnel | `CheckoutSuccessPage` | no | no | `noindex,nofollow` |
| `/checkout/cancel` | cart/tunnel | `CheckoutCancelPage` | no | no | `noindex,nofollow` |
| `/compte/*` | private account | `AccountAuthGate` / account pages | no | no | unauthenticated render redirects to `/connexion`, `noindex,nofollow` |
| `/admin/*` | administration | `AdminAuthGate` / admin pages | no | no | unauthenticated render shows admin gate, `noindex,nofollow` |
| unknown route | fallback | `NotFoundPage` | no | no | `noindex,nofollow` |

## Metadata table after JavaScript

| Route group | Title | Canonical | H1 count | Notes |
|---|---|---|---:|---|
| `/` | `Verdanza CBD - Fleurs et résines CBD premium en ligne` | `https://verdanza.fr/` | 1 | Real hero image used for OG/Twitter image. |
| `/boutique` | `Boutique Verdanza CBD` | `https://verdanza.fr/boutique` | 1 | Product cards link to product pages. |
| `/fleurs-cbd` | `Fleurs CBD - Verdanza CBD` | `https://verdanza.fr/fleurs-cbd` | 1 | Category products load from Firestore with local fallback. |
| `/resines-cbd` | `Résines CBD - Verdanza CBD` | `https://verdanza.fr/resines-cbd` | 1 | Category products load from Firestore with local fallback. |
| `/livraison-express-aix` | `Livraison CBD express Aix-en-Provence - Verdanza` | `https://verdanza.fr/livraison-express-aix` | 1 | Local zones rendered from delivery data. |
| `/livraison-postale` | `Livraison hors zone - Verdanza` | `https://verdanza.fr/livraison-postale` | 1 | Content is useful but title should be improved in a content phase. |
| legal/content pages | Page-specific legal/content title | Matching route URL | 1 | `/confidentialite` canonical fixed. |
| active product pages | Product `seoTitle` | `https://verdanza.fr/produits/{slug}` | 1 | Product image used as real OG/Twitter image. |
| auth/cart/checkout/account/admin/fallback | Page-specific private/tunnel title | Current route or gate route | 1 | All are `noindex,nofollow` and absent from sitemap. |

## Initial HTML audit

Production local preview was checked before JavaScript and after JavaScript.

Initial HTML for every SPA route is still the shared Vite shell:

- title exists, but it is the homepage title for all routes;
- meta description exists, but it is generic/homepage-oriented for all routes;
- canonical exists, but it is `https://verdanza.fr/` for all routes;
- robots exists, but it is `index,follow` for all routes;
- H1 count is `0`;
- product content, category content, route-specific headings, route-specific `noindex`, and route-specific social metadata are absent until JavaScript runs.

After JavaScript, the audited routes have correct route-specific metadata, one H1, and correct sitemap inclusion/exclusion.

## SPA rendering risk

The current SPA remains the main SEO risk. Google can execute JavaScript, but initial HTML does not contain route-specific titles, canonicals, H1s, product content, `noindex` directives, or product social metadata. That creates delayed rendering/indexing risk and can produce wrong signals for crawlers or social parsers that do not execute JavaScript.

This phase did not implement SSR or pre-rendering by design. The next structural decision should be made after Search Console coverage/indexing data is reviewed.

## Sitemap maintenance

The sitemap is generated by:

```bash
npm run sitemap
```

It uses `scripts/seoRoutes.ts` and local `src/data/products.ts`, includes only `isActive` products, and does not require Firebase secrets. If production catalog truth moves fully to Firestore, the robust options are either a secure server-side sitemap endpoint or a build step using non-secret public config plus read-only rules. Do not expose Firebase admin credentials in the frontend build.

Current sitemap URL count: 25.

## Issues detected but not corrected in this phase

- Initial HTML remains non-route-specific because the app is still a Vite SPA.
- `/livraison-postale` title says `Livraison hors zone - Verdanza`; this is technically valid but semantically weaker than a dedicated postal-delivery SEO title.
- Some public informational pages are thin (`a-propos`, parts of legal/contact content). This should be handled in a content phase, not by mass rewriting here.
- Coming-soon products are included when `isActive` because there is no separate `published` field. Add `isPublished` or equivalent before needing finer sitemap control.
- 404/fallback routes return HTTP 200 under SPA preview. A hosting-level rewrite/404 strategy should be evaluated separately.
- No structured `Product` data was added in this phase.

## Pre-rendering options

| Option | Benefits | Limits | Complexity | Firebase/catalog compatibility |
|---|---|---|---|---|
| Static pre-render at build | Route-specific initial HTML for public routes; good fit for current Vite app | Needs a stable route list and product data at build | medium | Good if product data can be read safely at build or from local generated data |
| Snapshot generation for public routes | Keeps SPA architecture; can snapshot only indexable pages | Needs cache invalidation when products change | medium | Good with a generated product-route manifest |
| External pre-render service | Fast to add; minimal app changes | Ongoing service dependency and cost; still needs validation | low/medium | Works with dynamic catalog if service renders after JS |
| Future SSR migration | Best long-term control over HTML, status codes, dynamic metadata | Larger project migration; not needed for this phase | high | Best for Firestore-backed dynamic catalog if implemented carefully |

Recommendation: next step should be static pre-render or snapshot generation for the public route set, not a full SSR migration yet. The current app already has a finite public route graph and a local product fallback, so pre-rendering can address the biggest SEO gap with lower risk.

## Verification results

Commands run:

```bash
npm run sitemap
npm run lint
npm run build
npm run typecheck:api
npm run audit:seo -- http://127.0.0.1:4173
```

Results:

- `npm run sitemap`: passed, generated `public/sitemap.xml` with 25 URLs.
- `npm run lint`: passed.
- `npm run build`: passed. Vite reported the existing bundle-size warning for a chunk above 500 kB.
- `npm run typecheck:api`: passed.
- `npm run audit:seo -- http://127.0.0.1:4173`: passed across 49 route checks.

## Manual actions

- After deployment, submit or refresh `https://verdanza.fr/sitemap.xml` in Google Search Console.
- Inspect Search Console coverage for public product/category pages before claiming indexation success.
- In Vercel, confirm SPA rewrites do not accidentally serve private data; authentication remains the security boundary.
- For the next phase, decide whether to pre-render public routes before adding blog/PWA work.
