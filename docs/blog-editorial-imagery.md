# Verdanza guide imagery

## Direction

Guide artwork uses a premium contemporary editorial language: ivory and cream surfaces, forest green structure, restrained champagne-brass accents, tactile materials, and soft natural or studio light. The subject must explain the article before it decorates the page.

Do not add words, figures, logos, labels, readable reports, product branding, consumption scenes, smoke, medical cues, neon, or generic cannabis iconography. Keep important content inside the central 55 percent safe zone.

## Visual families

- Analysis and measurements: optical glass, calibrated tools, sample comparisons, balances, and abstract unreadable data.
- Plant observation: macro detail, botanical specimen layouts, structure, scale, and workmanship.
- Packaging and traceability: closures, seals, labels without data, containers, parcels, and provenance layers.
- Conservation and quality: protected shade, material ageing, humidity control, and storage conditions.
- Aromatic profiles: separated botanical scent families with a clear practical or educational composition.
- Cultivation and regulation: architectural growing environments or sober documentary symbols, never promotional scenes.

Adjacent guides must not reuse the same subject arrangement. Review at least the eight most recent guide images before approving a new concept.

## Delivery

Create a high-resolution master without embedded text, then import it with:

```powershell
npm run images:blog-editorial -- --slug=<article-slug> --source=<absolute-master-path>
```

Use `--base=<existing-image-base>` when an established image URL must be preserved. Optional `--square-position`, `--landscape-position`, and `--wide-position` values allow deliberate reframing. Outputs are WebP at 800x800, 1040x780, and 1600x900. The card formats match their two-times display size and every file stays below the 240 KB audit limit.

Run `npm run images:generate` after import. The generator registers and validates the editorial files without replacing them. Legacy synthetic blog artwork is disabled by default; it is available only for a deliberate emergency run with `VERDANZA_ALLOW_LEGACY_BLOG_ARTWORK=1`.
