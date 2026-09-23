import { useEffect, useState } from "react";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Seo } from "../components/Seo";
import { ProductProfileSelector } from "../components/product-sheets/ProductProfileSelector";
import { ProductSheetBrowser } from "../components/product-sheets/ProductSheetBrowser";
import { productSheets, type ProductSheet } from "../data/productSheets";

export function ProductSheetsPage() {
  const [sheets, setSheets] = useState<ProductSheet[]>(productSheets);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/selection?action=library", { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ sheets?: ProductSheet[] }> : { sheets: [] })
      .then((result) => {
        if (!Array.isArray(result.sheets)) return;
        const seen = new Set(productSheets.map((sheet) => sheet.slug));
        const additions = result.sheets.filter((sheet) => {
          if (!sheet || typeof sheet.slug !== "string" || seen.has(sheet.slug) ||
            !["flower", "resin"].includes(sheet.selectionProfile?.category) ||
            !["douce", "moyenne", "forte"].includes(sheet.selectionProfile?.intensity)) return false;
          seen.add(sheet.slug);
          return true;
        });
        setSheets([...productSheets, ...additions]);
      }).catch(() => { /* Keep the validated static library when the API is unavailable. */ });
    return () => controller.abort();
  }, []);
  return (
    <main className="overflow-x-clip pb-20">
      <Seo
        title="Fiches produits Verdanza"
        description="Découvrez le type, l’intensité et les profils aromatiques des fleurs et résines Verdanza."
        path="/fiches-produits"
        robots="noindex,follow"
      />

      <header className="border-b border-forest/10 bg-cream/55">
        <div className="container-page py-6 sm:py-10 lg:py-14">
          <Breadcrumbs
            items={[
              { name: "Accueil", path: "/" },
              { name: "Fiches produits", path: "/fiches-produits", current: true },
            ]}
            structuredData={false}
          />
          <div className="page-intro mt-5 sm:mt-7">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-champagne">
              Collection Verdanza
            </p>
            <h1 className="!text-4xl sm:!text-5xl md:!text-6xl">Fiches produits</h1>
            <p className="!mt-3 max-w-2xl !text-base !leading-7 sm:!mt-4 sm:!text-lg">
              Choisissez un type, une intensité et, si vous le souhaitez, vos arômes préférés.
            </p>
          </div>
        </div>
      </header>

      <div className="container-page pt-6 sm:pt-10 lg:pt-12">
        <ProductProfileSelector sheets={sheets} />

        <section
          id="all-product-sheets"
          className="scroll-mt-36 pt-12 sm:pt-16 lg:pt-20"
          aria-labelledby="all-product-sheets-title"
        >
          <div className="border-b border-forest/10 pb-5 sm:pb-7">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-champagne">
              Explorer librement
            </p>
            <h2
              id="all-product-sheets-title"
              className="mt-2 font-display text-4xl leading-tight text-forest sm:text-5xl"
            >
              Toutes les fiches
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/60 sm:mt-3 sm:text-base sm:leading-7">
              Passez des fleurs aux résines en un geste, puis parcourez les fiches à votre rythme.
            </p>
          </div>

          <ProductSheetBrowser library={sheets} />
        </section>
      </div>
    </main>
  );
}
