# SEO phase 2 prerender - Verdanza.fr

Date: 2026-07-10

## Solution retained

The implementation keeps the existing React 18 + Vite SPA and adds a deterministic post-build static prerender step.

`npm run build` now runs:

```bash
npm run sitemap && tsc -b && vite build && npm run prerender
```

The prerender script starts a temporary local static server for `dist`, opens each known route with Playwright, waits for the page content, serializes the final document HTML, and writes route-specific HTML files back into `dist`.

The app still uses `createRoot`, not `hydrateRoot`. This is intentional: the existing app was not built for React hydration, and `createRoot` preserves the current client behavior by letting React take over after load. The static HTML is for crawlable initial content; the SPA remains responsible for interaction after JavaScript loads.

## Solutions rejected

- Next.js, Remix, SSR migration: rejected because the task explicitly excludes framework migration and permanent SSR.
- External prerender service: rejected because a local deterministic build step is lower risk and avoids paid/external dependencies.
- Firebase/Admin catalog build: rejected because prerender must not require production secrets or Firebase Admin.
- React server rendering: rejected for this phase because several providers/components are browser-oriented and the browser prerender path reuses the real app behavior with less architectural churn.

## Files modified

- `package.json`
- `vercel.json`
- `scripts/seoRoutes.ts`
- `scripts/prerender.ts`
- `scripts/auditPrerender.ts`
- `scripts/auditRuntime.ts`
- `scripts/seoAudit.ts`
- `SEO_PHASE_2_PRERENDER.md`

## Routes prerendered

Indexable public routes:

- `/`
- `/boutique`
- `/fleurs-cbd`
- `/resines-cbd`
- `/livraison-express-aix`
- `/livraison-postale`
- `/qualite-conformite`
- `/a-propos`
- `/faq`
- `/contact`
- `/mentions-legales`
- `/cgv`
- `/confidentialite`
- `/retours`

Active local product routes:

- `/produits/golden-static`
- `/produits/supreme-purple-cbd`
- `/produits/cookie-kush-indoor`
- `/produits/petites-tetes-og-kush`
- `/produits/harlequin-greenhouse`
- `/produits/la-mousse`
- `/produits/mango-haze-cbd`
- `/produits/mandarine-cbd`
- `/produits/amnesia-cbd-hydroponique`
- `/produits/blue-dream-cbd`
- `/produits/plutonium-cbd-hydroponique`

Known noindex shells are also generated for direct access:

- `/connexion`
- `/inscription`
- `/panier`
- `/checkout`
- `/checkout/success`
- `/checkout/cancel`
- `/compte`
- `/compte/commandes`
- `/compte/favoris`
- `/compte/profil`
- `/admin` and known admin child routes
- fallback test routes and `404.html`

Generated output includes both clean-url `.html` files and nested `index.html` files for route compatibility.

## Product data source

The prerender route list uses `scripts/seoRoutes.ts`, which derives product routes from `src/data/products.ts` and includes products where `isActive` is true. During prerender, external Firebase/Auth/Analytics requests are blocked in the Playwright context so product pages fall back to the controlled local catalog. No Firebase Admin key or private session is used.

## Private pages

Private/account/admin/tunnel routes are prerendered only as unauthenticated `noindex,nofollow` shells. They contain no user, cart, order, favorite, or admin data. The runtime authentication and authorization behavior remains unchanged.

## 404 strategy

The previous global Vercel rewrite to `/index.html` was removed. `vercel.json` now uses `cleanUrls: true` and serves the generated static files from `dist`.

Expected deployment behavior:

- generated public and noindex routes return `200`;
- generated active product pages return `200`;
- generated fallback test pages are `noindex,nofollow`;
- unknown static paths should fall through to `404.html` on Vercel and return 404.

Local `vite preview` still returns 200 for some unknown SPA paths. This is a preview-server limitation and is documented separately from Vercel deployment behavior.

## Audits without JavaScript

`npm run audit:prerender` reads generated files directly from `dist` and verifies:

- title;
- meta description;
- canonical;
- robots;
- Open Graph;
- Twitter Card;
- H1 count;
- main/body content;
- sitemap inclusion/exclusion;
- absence of private-data markers.

`npm run audit:runtime -- http://127.0.0.1:4173` also checks representative routes with JavaScript disabled, including home, categories, delivery, three products, login, and an unknown route.

## Test results

Commands run successfully:

```bash
npm run sitemap
npm run lint
npm run build
npm run typecheck:api
npm run audit:prerender
npm run audit:seo -- http://127.0.0.1:4173
npm run audit:runtime -- http://127.0.0.1:4173
```

Results:

- `npm run sitemap`: passed, generated 25 sitemap URLs.
- `npm run lint`: passed.
- `npm run build`: passed, generated 50 prerendered HTML files; Vite still reports the existing bundle-size warning above 500 kB.
- `npm run typecheck:api`: passed.
- `npm run audit:prerender`: passed.
- `npm run audit:seo -- http://127.0.0.1:4173`: passed with route-specific initial HTML.
- `npm run audit:runtime -- http://127.0.0.1:4173`: passed on desktop 1280 px and mobile 390 px, including SPA navigation, cart add, unauthenticated favorite message, private/admin gates, assets, images, and console-error checks.

## Vercel deployment consequences

- Vercel should deploy `dist` as static output.
- `cleanUrls` lets `/boutique` resolve to generated `boutique.html`.
- The previous catch-all rewrite is removed to avoid forcing every unknown URL to status 200.
- After deployment, validate a real unknown URL and an unknown product slug on production because local `vite preview` does not perfectly model Vercel static 404 behavior.

## Maintenance when adding a product

1. Add or update the product in `src/data/products.ts`.
2. Ensure `isActive` is true only when the product should be public and indexable.
3. Run `npm run sitemap`.
4. Run `npm run build`.
5. Run `npm run audit:prerender` and `npm run audit:seo -- http://127.0.0.1:4173`.

If production catalog control moves fully to Firestore, add a safe public export or server-side build input before relying on Firestore for prerendered product pages. Do not expose Firebase Admin credentials in the build.

## Remaining limitations

- Local `vite preview` can return status 200 for unknown paths even after Vercel rewrites are removed; production Vercel status behavior must be checked after deploy.
- The app still uses client-side React takeover via `createRoot`, so the prerender is not full React hydration.
- Coming-soon products are included if `isActive` because there is still no separate `isPublished` flag.
- No Product structured data was added in this phase, per scope.
