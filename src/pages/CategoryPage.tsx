import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useRef } from "react";
import { ProductCard } from "../components/ProductCard";
import { CategoryProductFilters } from "../components/category/CategoryProductFilters";
import { PromoBannerSlot } from "../components/PromoBannerSlot";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Seo } from "../components/Seo";
import { useProducts } from "../hooks/useProducts";
import { trackCtaClick, trackViewItemList } from "../lib/analytics";
import {
  createProductDiscoverySearchParams,
  filterProductsByDiscoveryCriteria,
  getAvailableProductAromaFamilies,
  getAvailableProductIntensities,
  parseProductDiscoverySearchParams,
  type ProductDiscoveryCriteria,
} from "../lib/productDiscovery";
import type { ProductCategory } from "../types";

const categoryContent = {
  flowers: {
    path: "/fleurs-cbd",
    title: "Fleurs CBD",
    heading: "Une sélection de fleurs CBD Verdanza",
    intro:
      "Indoor, greenhouse et hydroponique selon les références, sélectionnées avec soin par Verdanza.",
    breadcrumb: "Fleurs CBD",
    seoTitle: "Fleurs CBD : indoor, greenhouse et hydroponique | Verdanza",
    seoDescription:
      "Sélection de fleurs CBD Verdanza : indoor, greenhouse et hydroponique selon les références, avec livraison à Aix-en-Provence et livraison postale.",
    guideCtaTitle: "Besoin d'aide pour choisir ?",
    guideCtaText:
      "Les guides Verdanza expliquent les différences entre fleurs, résines et méthodes de culture.",
  },
  resins: {
    path: "/resines-cbd",
    title: "Résines CBD",
    heading: "Des textures et profils sélectionnés avec soin",
    intro:
      "Découvrez les résines CBD Verdanza à travers leurs textures et profils disponibles.",
    breadcrumb: "Résines CBD",
    seoTitle: "Résines CBD : sélection et profils | Verdanza",
    seoDescription:
      "Sélection de résines CBD Verdanza avec textures et profils disponibles, livraison locale à Aix-en-Provence et livraison postale.",
    guideCtaTitle: "Besoin d'aide pour comparer ?",
    guideCtaText:
      "Les guides Verdanza aident à comprendre les textures, compositions et différences entre fleurs et résines CBD.",
  },
} satisfies Record<string, CategoryContent>;

type CategoryContent = {
  path: string;
  title: string;
  heading: string;
  intro: string;
  breadcrumb: string;
  seoTitle: string;
  seoDescription: string;
  guideCtaTitle: string;
  guideCtaText: string;
};

export function CategoryPage({
  category,
}: {
  category: ProductCategory;
  title: string;
}) {
  const { products, isLoading } = useProducts();
  const [searchParams, setSearchParams] = useSearchParams();
  const trackedListSignature = useRef("");
  const pageCategory = category === "flowers" ? "flowers" : "resins";
  const content = categoryContent[pageCategory];
  const categoryProducts = useMemo(
    () => products.filter((product) => product.category === category),
    [category, products],
  );
  const parsedCriteria = useMemo(
    () => parseProductDiscoverySearchParams(searchParams),
    [searchParams],
  );
  const criteria = useMemo<ProductDiscoveryCriteria>(
    () => ({
      category: pageCategory,
      intensity: parsedCriteria.intensity,
      aromas: parsedCriteria.aromas,
    }),
    [pageCategory, parsedCriteria.aromas, parsedCriteria.intensity],
  );
  const filteredProducts = useMemo(
    () => filterProductsByDiscoveryCriteria(categoryProducts, criteria),
    [categoryProducts, criteria],
  );
  const availableIntensities = useMemo(
    () => Array.from(getAvailableProductIntensities(categoryProducts, pageCategory)),
    [categoryProducts, pageCategory],
  );
  const availableAromas = useMemo(
    () =>
      Array.from(
        getAvailableProductAromaFamilies(categoryProducts, {
          category: pageCategory,
          intensity: null,
        }),
      ),
    [categoryProducts, pageCategory],
  );
  const itemListId = category === "flowers" ? "category_flowers" : "category_resins";

  const applyCriteria = (nextCriteria: ProductDiscoveryCriteria) => {
    const nextSearchParams = createProductDiscoverySearchParams(nextCriteria);
    nextSearchParams.delete("type");
    setSearchParams(nextSearchParams);
  };

  const resetCriteria = () => {
    setSearchParams(new URLSearchParams());
  };

  useEffect(() => {
    if (isLoading) return;
    const signature = categoryProducts.map((product) => product.id).join("|");
    if (!signature || trackedListSignature.current === signature) return;
    trackedListSignature.current = signature;
    trackViewItemList(itemListId, content.breadcrumb, categoryProducts);
  }, [categoryProducts, content.breadcrumb, isLoading, itemListId]);

  return (
    <main
      className="category-page-v2 container-page py-8 md:py-10"
      data-category-page
      data-category={pageCategory}
    >
      <Seo title={content.seoTitle} description={content.seoDescription} path={content.path} />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: content.breadcrumb, path: content.path, current: true },
        ]}
      />
      <header className="mt-6 max-w-4xl" data-category-header>
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-champagne">
          {content.title}
        </p>
        <h1 className="mt-2 max-w-3xl font-display text-4xl leading-[1.02] text-forest sm:text-5xl md:text-[3.45rem]">
          {content.heading}
        </h1>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-ink/65 sm:text-base sm:leading-7">
          {content.intro}
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/60">
          Livraison locale disponible selon la zone autour d’Aix-en-Provence.{" "}
          <Link
            to="/livraison-locale"
            className="font-semibold text-forest underline decoration-champagne underline-offset-4"
            onClick={() =>
              trackCtaClick({
                ctaId: "category_delivery_local_link",
                ctaLocation: "category_page",
                destinationPath: "/livraison-locale",
                ctaCategory: "delivery",
              })
            }
          >
            Vérifier la livraison
          </Link>
          .
        </p>
      </header>

      {!isLoading || products.length > 0 ? (
        <CategoryProductFilters
          categoryLabel={content.title}
          criteria={criteria}
          availableIntensities={availableIntensities}
          availableAromas={availableAromas}
          resultCount={filteredProducts.length}
          onChange={applyCriteria}
          onReset={resetCriteria}
        />
      ) : null}

      <PromoBannerSlot
        placement={category === "flowers" ? "flowers" : "resins"}
        type="shop_card"
        className="mt-5 grid gap-3"
      />
      {isLoading && categoryProducts.length === 0 ? (
        <p className="mt-6 text-forest/70">Chargement des produits...</p>
      ) : filteredProducts.length === 0 ? (
        <section
          className="mt-7 border-y border-champagne/30 py-8 text-center"
          aria-labelledby="category-empty-title"
          data-category-empty-state
        >
          <h2 id="category-empty-title" className="font-display text-2xl text-forest">
            Aucun produit ne correspond à ces critères.
          </h2>
          <button
            type="button"
            className="mt-3 min-h-11 rounded px-2 text-sm font-semibold text-forest underline decoration-champagne underline-offset-4 focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2"
            onClick={resetCriteria}
            data-category-empty-reset
          >
            Réinitialiser
          </button>
        </section>
      ) : (
        <div className="product-grid category-product-grid mt-7" id="produits">
          {filteredProducts.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              priorityImage={index < 4}
              itemListId={itemListId}
              itemListName={content.breadcrumb}
            />
          ))}
        </div>
      )}
      <CategoryGuideCta content={content} />
    </main>
  );
}

function CategoryGuideCta({ content }: { content: CategoryContent }) {
  return (
    <aside className="mt-10 border-t border-forest/10 py-6 sm:flex sm:items-center sm:justify-between sm:gap-6">
      <div className="max-w-2xl">
        <h2 className="font-display text-2xl leading-tight text-forest">
          {content.guideCtaTitle}
        </h2>
        <p className="mt-2 text-sm leading-6 text-ink/65">{content.guideCtaText}</p>
      </div>
      <Link
        to="/blog"
        className="btn-secondary mt-4 min-h-10 px-4 py-2 sm:mt-0"
        onClick={() =>
          trackCtaClick({
            ctaId: "category_guides",
            ctaLocation: "category_guide_cta",
            destinationPath: "/blog",
            ctaCategory: "content",
          })
        }
      >
        Voir les guides
      </Link>
    </aside>
  );
}
