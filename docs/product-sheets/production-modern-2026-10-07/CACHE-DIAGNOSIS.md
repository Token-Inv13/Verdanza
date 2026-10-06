# Diagnostic cache Golden Static

## Faits observés le 7 octobre 2026

- Le WebP public stable `/images/fiches-produits/golden-static.webp` répondait HTTP 200 et son SHA-256 distant était `f9377d2de38559f29b84d4aa90d3575b78c9a592460cf93ed32e3b77f9f2fa77`, identique au fichier local affichant le produit entier.
- Son en-tête était `Cache-Control: public, max-age=604800, stale-while-revalidate=2592000`.
- Le PDF public stable répondait HTTP 200 avec le SHA-256 `97015d9a940525334fbf030b932970b707524d4d548c265a5ad3aa7b7d8ea8c8`, identique au PDF local.
- `productSheets.ts` utilisait des URLs stables non versionnées et le service worker appliquait une stratégie `StaleWhileRevalidate` aux images.

## Diagnostic

La source et le fichier distant courants étaient déjà corrects. L'ancienne macro encore visible est donc cohérente avec une copie conservée sous la même URL par le cache navigateur, le cache du service worker ou le CDN. Le mapping stable empêchait une invalidation immédiate.

## Préparation locale

La collection moderne utilise les URLs versionnées `golden-static-modern-20261007.webp` et `verdanza-golden-static-modern-20261007.pdf`. La source est verrouillée sur `Composition-ezgif.com-resize.webp` (713 × 713) ; le générateur échoue si l'ancienne source `goldenstatic.webp` est utilisée.
