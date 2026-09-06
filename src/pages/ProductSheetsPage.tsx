import { ExternalLink } from "lucide-react";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Seo } from "../components/Seo";
import { ProductProfileSelector } from "../components/product-sheets/ProductProfileSelector";
import {
  productSheetAmbienceLabels,
  productSheetIntensityLabels,
  productSheets,
  type ProductSheet,
  type ProductSheetCategory,
} from "../data/productSheets";

const sections: Array<{ category: ProductSheetCategory; title: string }> = [
  { category: "flower", title: "Fleurs" },
  { category: "resin", title: "Résines" },
];

export function ProductSheetsPage() {
  return (
    <main className="pb-20">
      <Seo
        title="Fiches produits Verdanza"
        description="Découvrez les profils aromatiques, l’intensité et l’ambiance des fleurs et résines Verdanza."
        path="/fiches-produits"
        robots="noindex,follow"
      />

      <header className="border-b border-forest/10 bg-cream/55">
        <div className="container-page py-10 sm:py-14 lg:py-16">
          <Breadcrumbs
            items={[
              { name: "Accueil", path: "/" },
              { name: "Fiches produits", path: "/fiches-produits", current: true },
            ]}
            structuredData={false}
          />
          <div className="page-intro">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-champagne">
              Collection Verdanza
            </p>
            <h1>Fiches produits</h1>
            <p>
              Retrouvez les profils aromatiques, l’intensité et l’ambiance de notre
              sélection.
            </p>
            <p className="!mt-2 text-base !leading-7 text-ink/55">
              Une lecture simple pour trouver le profil qui vous correspond.
            </p>
          </div>
        </div>
      </header>

      <div className="container-page pt-12 sm:pt-16">
        <ProductProfileSelector />

        <section
          id="toutes-les-fiches"
          className="scroll-mt-24 border-b border-forest/10 pb-7 pt-16 sm:pt-20"
          aria-labelledby="all-product-sheets-title"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-champagne">
            Explorer librement
          </p>
          <h2
            id="all-product-sheets-title"
            className="mt-2 font-display text-4xl leading-tight text-forest sm:text-5xl"
          >
            Toutes les fiches
          </h2>
          <p className="mt-3 text-base leading-7 text-ink/60">
            Vous préférez parcourir toute la sélection ? Retrouvez les dix profils
            ci-dessous.
          </p>
        </section>

        <div className="space-y-16 pt-10 sm:pt-12">
          {sections.map((section) => {
            const sheets = productSheets.filter(
              (sheet) => sheet.category === section.category,
            );

            return (
              <section key={section.category} aria-labelledby={`${section.category}-title`}>
                <div className="mb-7 flex items-end justify-between gap-4 border-b border-forest/10 pb-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-champagne">
                      Sélection
                    </p>
                    <h2
                      id={`${section.category}-title`}
                      className="mt-1 font-display text-4xl leading-tight text-forest sm:text-5xl"
                    >
                      {section.title}
                    </h2>
                  </div>
                  <span className="text-sm text-forest/55">
                    {sheets.length} fiche{sheets.length > 1 ? "s" : ""}
                  </span>
                </div>

                <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                  {sheets.map((sheet) => (
                    <ProductSheetCard key={sheet.slug} sheet={sheet} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function ProductSheetCard({ sheet }: { sheet: ProductSheet }) {
  return (
    <article
      className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-forest/10 bg-ivory shadow-sm transition duration-300 hover:-translate-y-0.5 hover:border-champagne/50 hover:shadow-soft"
      data-product-sheet-card={sheet.slug}
    >
      <div className="border-b border-forest/10 bg-cream p-4 sm:p-5">
        <div className="mx-auto aspect-[111/154] w-full max-w-[22rem] overflow-hidden rounded-md border border-forest/10 bg-ivory shadow-sm">
          <img
            src={sheet.previewUrl}
            alt={`Fiche produit ${sheet.name} Verdanza`}
            width={640}
            height={888}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <h3 className="font-display text-3xl leading-tight text-forest">{sheet.name}</h3>
        <p className="mt-2 text-sm leading-6 text-ink/65">{sheet.aromas.join(" · ")}</p>

        <dl className="mt-6 space-y-5">
          <div>
            <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.17em] text-forest/55">
              Intensité
            </dt>
            <dd className="mt-2">
              <span className="inline-flex rounded-full border border-champagne/45 bg-cream px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-forest">
                {productSheetIntensityLabels[sheet.experience.intensity]}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.17em] text-forest/55">
              Ambiance{sheet.experience.ambiences.length > 1 ? "s" : ""}
            </dt>
            <dd className="mt-2 flex flex-wrap gap-2">
              {sheet.experience.ambiences.map((ambience) => (
                <span
                  key={ambience}
                  className="rounded-full border border-sage/45 bg-sage/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-forest"
                >
                  {productSheetAmbienceLabels[ambience]}
                </span>
              ))}
            </dd>
          </div>
        </dl>

        <a
          href={sheet.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary mt-7 w-full"
          aria-label={`Voir la fiche ${sheet.name} (PDF, nouvel onglet)`}
        >
          Voir la fiche
          <ExternalLink aria-hidden="true" size={16} />
        </a>
      </div>
    </article>
  );
}
