import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { FavoriteButton } from "../components/FavoriteButton";
import { JsonLd } from "../components/JsonLd";
import { LocalDeliveryNote } from "../components/LocalDeliveryNote";
import { QualityBadge } from "../components/QualityBadge";
import { Seo } from "../components/Seo";
import {
  ProductGallery,
  ProductPurchasePanel,
} from "../components/product/ProductPageSections";
import { useCart } from "../context/CartContext";
import { useProducts } from "../hooks/useProducts";
import { trackAddToCart, trackViewItem } from "../lib/analytics";
import { publicProductStockLabel } from "../lib/cartStock";
import { normalizeProductImages } from "../lib/productImages";
import {
  resolveProductCardPresentation,
  type ProductCardPresentation,
} from "../lib/productPresentation";
import {
  productPurchaseOptionLabel,
  resolveProductPurchaseOptions,
} from "../lib/productPurchaseOptions";
import {
  buildProductJsonLd,
  productCategoryLabel,
  productPath,
} from "../lib/structuredData";
import type { Product } from "../types";

type ProductFact = {
  label: string;
  value: string;
};

function hasProductValue(value: string | undefined) {
  if (!value?.trim()) return false;
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return ![
    "a confirmer",
    "a renseigner",
    "autre",
    "non communique",
    "non renseigne",
  ].includes(normalized);
}

function resolveProductFacts(product: Product, presentation: ProductCardPresentation) {
  const culture = hasProductValue(product.cultureType) ? product.cultureType : "";
  const cannabinoidSummary = [
    ["CBD", product.cbdRate],
    ["CBG", product.cbgRate],
    ["CBN", product.cbnRate],
    ["THC", product.thcRate],
  ]
    .filter((entry): entry is [string, string] => hasProductValue(entry[1]))
    .map(([label, value]) => `${label} ${value}`)
    .join(" · ");
  const facts: Array<ProductFact | null> = [
    {
      label: "Type / culture",
      value: [presentation.categoryLabel, culture].filter(Boolean).join(" · "),
    },
    hasProductValue(product.origin)
      ? { label: "Origine", value: product.origin }
      : null,
    hasProductValue(product.texture)
      ? { label: "Texture", value: product.texture || "" }
      : null,
    cannabinoidSummary
      ? { label: "Cannabinoïdes", value: cannabinoidSummary }
      : null,
  ];

  return facts.filter((fact): fact is ProductFact => Boolean(fact)).slice(0, 4);
}

function ProductProfile({
  presentation,
  showQualitySeal,
}: {
  presentation: ProductCardPresentation;
  showQualitySeal: boolean;
}) {
  return (
    <section
      className="rounded-[0.85rem] border border-champagne/30 bg-cream/55 px-5 py-4 sm:px-6"
      aria-labelledby="product-profile-title"
      data-product-profile
    >
      <div className="flex items-center justify-between gap-4">
        <h2
          id="product-profile-title"
          className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-forest/65"
        >
          Profil Verdanza
        </h2>
        {showQualitySeal && <QualityBadge variant="inline" className="bg-forest" />}
      </div>

      <dl className="mt-4 space-y-3.5">
        {presentation.aromaProfile.length > 0 && (
          <div className="grid gap-1 sm:grid-cols-[6.5rem_1fr] sm:items-baseline">
            <dt className="text-xs uppercase tracking-[0.13em] text-ink/45">Arômes</dt>
            <dd>
              <ul className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-forest">
                {presentation.aromaProfile.map((aroma, index) => (
                  <li key={aroma} className="inline-flex items-center" data-product-aroma>
                    {index > 0 && (
                      <span className="mr-2 text-champagne" aria-hidden="true">·</span>
                    )}
                    {aroma}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}

        <div className="grid gap-1 sm:grid-cols-[6.5rem_1fr] sm:items-center">
          <dt className="text-xs uppercase tracking-[0.13em] text-ink/45">Intensité</dt>
          <dd className="flex items-center justify-between gap-4 text-sm font-semibold text-forest">
            <span data-product-intensity>{presentation.intensityLabel}</span>
            <span
              className="flex gap-1.5"
              role="img"
              aria-label={`Intensité ${presentation.intensityLabel.toLowerCase()}`}
            >
              {[1, 2, 3].map((level) => (
                <span
                  key={level}
                  aria-hidden="true"
                  className={`h-2.5 w-2.5 rounded-full border border-champagne ${
                    level <= presentation.intensityLevel ? "bg-forest" : "bg-ivory"
                  }`}
                />
              ))}
            </span>
          </dd>
        </div>

        {presentation.appearance.length > 0 && (
          <div className="grid gap-1 sm:grid-cols-[6.5rem_1fr] sm:items-baseline">
            <dt className="text-xs uppercase tracking-[0.13em] text-ink/45">Aspect</dt>
            <dd className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-forest">
              {presentation.appearance.map((value, index) => (
                <span key={value} className="inline-flex items-center" data-product-aspect>
                  {index > 0 && (
                    <span className="mr-2 text-champagne" aria-hidden="true">·</span>
                  )}
                  {value}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function ProductEditorialDetails({
  product,
  presentation,
}: {
  product: Product;
  presentation: ProductCardPresentation;
}) {
  const facts = resolveProductFacts(product, presentation);
  const isHydroponicFlower =
    product.cultureType === "Hydroponique" && product.category === "flowers";
  const isResin = product.category === "resins";

  return (
    <div
      className="mt-14 border-t border-champagne/30 pt-10 sm:mt-16 sm:pt-12"
      data-product-editorial
    >
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-x-14">
        {facts.length > 0 && (
          <section aria-labelledby="product-facts-title">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-champagne">
              L’essentiel
            </p>
            <h2 id="product-facts-title" className="mt-2 font-display text-3xl text-forest">
              En bref
            </h2>
            <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {facts.map((fact) => (
                <div key={fact.label} className="border-t border-forest/10 pt-3">
                  <dt className="text-[0.65rem] uppercase tracking-[0.14em] text-ink/45">
                    {fact.label}
                  </dt>
                  <dd className="mt-1 text-sm leading-6 text-forest">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <section aria-labelledby="product-about-title">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-champagne">
            La sélection
          </p>
          <h2 id="product-about-title" className="mt-2 font-display text-3xl text-forest">
            À propos de ce produit
          </h2>
          <div className="mt-5 space-y-4 text-[1.02rem] leading-8 text-ink/70">
            <p>{product.longDescription}</p>
            {product.whyChooseDescription && <p>{product.whyChooseDescription}</p>}
          </div>
        </section>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        {product.advisedProfile && (
          <section
            className="rounded-[0.85rem] border border-forest/10 bg-cream/55 p-6 sm:p-7"
            aria-labelledby="product-audience-title"
          >
            <h2 id="product-audience-title" className="font-display text-2xl text-forest">
              Pour qui ?
            </h2>
            <p className="mt-3 leading-7 text-ink/70">{product.advisedProfile}</p>
          </section>
        )}

        <section
          className="rounded-[0.85rem] border border-champagne/30 bg-ivory p-6 sm:p-7"
          aria-labelledby="product-additional-title"
        >
          <h2 id="product-additional-title" className="font-display text-2xl text-forest">
            Informations complémentaires
          </h2>
          <div className="mt-3 space-y-4 leading-7 text-ink/70">
            {isHydroponicFlower && (
              <p>
                Cette fleur est issue d'une culture hydroponique, une méthode qui
                permet de mieux contrôler l'environnement de production. Elle est
                sélectionnée pour sa structure, son profil aromatique et sa qualité
                visuelle.
              </p>
            )}
            {isResin && (
              <p>
                Cette résine est sélectionnée pour sa texture, son profil aromatique
                et sa qualité visuelle.
              </p>
            )}
            {product.experienceDescription && <p>{product.experienceDescription}</p>}
          </div>
        </section>
      </div>

      <div className="mt-8">
        <LocalDeliveryNote category={product.category} />
        <p className="mt-6 max-w-3xl text-sm leading-6 text-ink/60">
          Produit réservé aux personnes majeures. Tenir hors de portée des enfants.
          Ce produit n'est pas destiné à remplacer un traitement médical.
        </p>
      </div>
    </div>
  );
}

export function ProductPage() {
  const { slug } = useParams();
  const { products, isLoading } = useProducts();
  const product = slug ? products.find((entry) => entry.slug === slug) : undefined;
  const { addItem, addFixedPriceOption, items } = useCart();
  const [selectedImageId, setSelectedImageId] = useState("");
  const [selectedPurchaseOptionId, setSelectedPurchaseOptionId] = useState("gram");
  const [purchaseBlockVisible, setPurchaseBlockVisible] = useState(true);
  const purchaseBlockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!product) return;
    trackViewItem(product);
  }, [product]);

  useEffect(() => {
    setSelectedImageId("");
    setSelectedPurchaseOptionId("gram");
    setPurchaseBlockVisible(true);
  }, [product?.id]);

  useEffect(() => {
    const purchaseBlock = purchaseBlockRef.current;
    if (!purchaseBlock || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => setPurchaseBlockVisible(entry.isIntersecting),
      { threshold: 0.15 },
    );
    observer.observe(purchaseBlock);
    return () => observer.disconnect();
  }, [product?.id]);

  if (isLoading && !product) {
    return (
      <main className="container-page py-16">
        <p className="text-forest/70">Chargement du produit...</p>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="container-page py-16">
        <Seo
          title="Produit introuvable - Verdanza CBD"
          description="Ce produit Verdanza n'est pas disponible."
          canonical={null}
          noindex
        />
        <Breadcrumbs
          structuredData={false}
          items={[
            { name: "Accueil", path: "/" },
            { name: "Boutique", path: "/boutique" },
            {
              name: "Produit introuvable",
              path: slug ? `/produits/${slug}` : "/produits",
              current: true,
            },
          ]}
        />
        <h1 className="font-display text-4xl text-forest">Produit introuvable</h1>
        <Link to="/boutique" className="mt-6 inline-flex text-forest underline">
          Retour boutique
        </Link>
      </main>
    );
  }

  const stockLabel = publicProductStockLabel(product);
  const purchaseOptions = resolveProductPurchaseOptions(product, items);
  const selectedPurchaseOption =
    purchaseOptions.find(
      (option) => option.id === selectedPurchaseOptionId && option.available,
    ) || purchaseOptions.find((option) => option.available);
  const purchaseAvailabilityLabel = selectedPurchaseOption
    ? stockLabel
    : stockLabel !== "Disponible"
      ? stockLabel
      : "Stock déjà réservé dans votre panier";
  const productImages = normalizeProductImages(product);
  const selectedImage =
    productImages.find((image) => image.id === selectedImageId) ||
    productImages.find((image) => image.isPrimary) ||
    productImages[0];
  const presentation = resolveProductCardPresentation(product);
  const path = productPath(product);
  const categoryName = productCategoryLabel(product);
  const categoryPath = product.category === "flowers" ? "/fleurs-cbd" : "/resines-cbd";
  const activeProduct = product;

  function handleAddToCart() {
    if (!selectedPurchaseOption) return;
    if (selectedPurchaseOption.fixedPriceOptionId) {
      addFixedPriceOption(activeProduct.id, selectedPurchaseOption.fixedPriceOptionId);
    } else {
      addItem(activeProduct.id);
    }
    trackAddToCart(activeProduct, selectedPurchaseOption.quantityGrams);
  }

  return (
    <main
      className="container-page min-w-0 pb-28 pt-8 sm:pt-10 lg:pb-16"
      data-product-page-v2
      data-product-slug={product.slug}
    >
      <Seo
        title={product.seoTitle}
        description={product.seoDescription}
        path={path}
        ogType="product"
        image={product.image}
      />
      <JsonLd id="product" data={buildProductJsonLd(product)} />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: categoryName, path: categoryPath },
          { name: product.name, path, current: true },
        ]}
      />

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-x-12 lg:gap-y-5 xl:gap-x-16">
        <header className="min-w-0 lg:col-start-2 lg:row-start-1">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-champagne">
            {presentation.categoryLabel}
          </p>
          <div className="mt-3 flex items-start justify-between gap-4">
            <h1 className="min-w-0 font-display text-4xl leading-[0.98] text-forest sm:text-5xl xl:text-[3.5rem]">
              {product.name}
            </h1>
            <FavoriteButton product={product} className="shrink-0" />
          </div>
          <p className="mt-5 max-w-2xl text-base leading-7 text-ink/70 sm:text-lg sm:leading-8">
            {product.shortDescription}
          </p>
        </header>

        <ProductGallery
          product={product}
          images={productImages}
          selectedImage={selectedImage}
          onSelectImage={setSelectedImageId}
        />

        <div className="lg:col-start-2 lg:row-start-2">
          <ProductProfile
            presentation={presentation}
            showQualitySeal={product.qualitySealEnabled === true}
          />
        </div>

        <div className="lg:col-start-2 lg:row-start-3">
          <ProductPurchasePanel
            product={product}
            purchaseOptions={purchaseOptions}
            selectedPurchaseOption={selectedPurchaseOption}
            availabilityLabel={purchaseAvailabilityLabel}
            stockLabel={stockLabel}
            purchaseBlockRef={purchaseBlockRef}
            onSelectPurchaseOption={setSelectedPurchaseOptionId}
            onAddToCart={handleAddToCart}
          />
        </div>
      </div>

      <ProductEditorialDetails product={product} presentation={presentation} />

      {selectedPurchaseOption && !purchaseBlockVisible && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t border-champagne/35 bg-[#fbfaf5] px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-[0_-12px_35px_rgba(11,61,46,0.12)]"
          data-product-sticky-purchase
          data-floating-help-suppress
        >
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-forest/55">
                {product.name}
              </p>
              <p className="truncate font-display text-xl leading-tight text-forest">
                {productPurchaseOptionLabel(selectedPurchaseOption)}
              </p>
            </div>
            <button
              type="button"
              className="btn-primary min-h-11 shrink-0 px-5 py-2.5"
              aria-label={`Ajouter ${productPurchaseOptionLabel(selectedPurchaseOption)} de ${product.name} au panier`}
              onClick={handleAddToCart}
            >
              Ajouter
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
