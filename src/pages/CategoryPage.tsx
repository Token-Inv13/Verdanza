import { Link } from "react-router-dom";
import { useEffect, useRef } from "react";
import { ProductCard } from "../components/ProductCard";
import { CatalogNotice } from "../components/CatalogNotice";
import { PromoBannerSlot } from "../components/PromoBannerSlot";
import { QualityBadge } from "../components/QualityBadge";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Seo } from "../components/Seo";
import { useProducts } from "../hooks/useProducts";
import { trackCtaClick, trackViewItemList } from "../lib/analytics";
import type { ProductCategory } from "../types";

const categoryContent = {
  flowers: {
    path: "/fleurs-cbd",
    title: "Fleurs CBD",
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
  const trackedListSignature = useRef("");
  const pageCategory = category === "flowers" ? "flowers" : "resins";
  const content = categoryContent[pageCategory];
  const categoryProducts = products.filter((product) => product.category === category);
  const itemListId = category === "flowers" ? "category_flowers" : "category_resins";

  useEffect(() => {
    if (isLoading) return;
    const signature = categoryProducts.map((product) => product.id).join("|");
    if (!signature || trackedListSignature.current === signature) return;
    trackedListSignature.current = signature;
    trackViewItemList(itemListId, content.breadcrumb, categoryProducts);
  }, [categoryProducts, content.breadcrumb, isLoading, itemListId]);

  return (
    <main className="container-page py-12">
      <Seo title={content.seoTitle} description={content.seoDescription} path={content.path} />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: content.breadcrumb, path: content.path, current: true },
        ]}
      />
      <div className="page-intro">
        <h1>{content.title}</h1>
      </div>
      <CatalogNotice variant={category === "flowers" ? "flowers" : "resins"} />
      <aside className="mt-4 rounded-md border border-forest/10 bg-ivory px-4 py-3 sm:flex sm:items-center sm:justify-between sm:gap-5">
        <p className="text-sm leading-6 text-ink/65">
          Les produits Verdanza sont sélectionnés selon leur origine, leur profil
          et les informations disponibles.
        </p>
        <QualityBadge
          variant="inline"
          showGenericOrigins
          className="mt-3 shrink-0 sm:mt-0"
        />
      </aside>
      <PromoBannerSlot
        placement={category === "flowers" ? "flowers" : "resins"}
        type="shop_card"
        className="mt-6 grid gap-3"
      />
      {isLoading ? (
        <p className="mt-6 text-forest/70">Chargement des produits...</p>
      ) : (
        <div className="product-grid mt-6">
          {categoryProducts.map((product, index) => (
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
    <aside className="mt-8 rounded-md border border-forest/10 bg-cream px-4 py-4 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:px-5">
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
