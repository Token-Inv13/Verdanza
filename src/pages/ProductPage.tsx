import { Link, useParams } from "react-router-dom";
import { Check, ShoppingBag } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Seo } from "../components/Seo";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { JsonLd } from "../components/JsonLd";
import { ProductImage } from "../components/ProductImage";
import { QualityBadge } from "../components/QualityBadge";
import { useCart } from "../context/CartContext";
import { useProducts } from "../hooks/useProducts";
import { trackAddToCart, trackViewItem } from "../lib/analytics";
import { publicProductStockLabel } from "../lib/cartStock";
import {
  isFixedPriceAdvantageous,
  resolveFixedPriceOptions,
} from "../lib/fixedPriceOptions";
import { normalizeProductImages } from "../lib/productImages";
import {
  formatProductPrice,
  productPurchaseCtaLabel,
  productPurchaseOptionLabel,
  resolveProductPurchaseOptions,
} from "../lib/productPurchaseOptions";
import { FavoriteButton } from "../components/FavoriteButton";
import {
  buildProductJsonLd,
  productCategoryLabel,
  productPath,
} from "../lib/structuredData";

function productImageAlt(product: { name: string; category: string; imageAlt?: string }) {
  return product.imageAlt || `${product.name} - ${
    product.category === "flowers" ? "Fleur CBD" : "Résine CBD"
  } Verdanza`;
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
            { name: "Produit introuvable", path: slug ? `/produits/${slug}` : "/produits", current: true },
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
  const fixedPriceOptions = resolveFixedPriceOptions(product);
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
  const path = productPath(product);
  const categoryName = productCategoryLabel(product);
  const categoryPath = product.category === "flowers" ? "/fleurs-cbd" : "/resines-cbd";
  const isHydroponicFlower =
    product.cultureType === "Hydroponique" && product.category === "flowers";
  const isResin = product.category === "resins";
  const keyFacts = isHydroponicFlower
    ? [
        ["Type", "Fleur CBD"],
        ["Gamme", "Sélection Verdanza"],
        ["THC", product.thcRate],
        ["Origine", product.origin],
        ["Culture", product.cultureType],
        ["Stock", stockLabel],
      ]
    : isResin
      ? [
          ["Type", "Résine CBD"],
          ["Gamme", "Sélection Verdanza"],
          ["CBD", product.cbdRate],
          [
            product.cbgRate !== "Non communiqué" ? "CBG" : product.cbnRate ? "CBN" : "Composition",
            product.cbgRate !== "Non communiqué"
              ? product.cbgRate
              : product.cbnRate || "Non communiqué",
          ],
          ["THC", product.thcRate],
          ["Origine", product.origin],
          ["Texture", product.texture || "À confirmer"],
          ["Stock", stockLabel],
        ]
      : [
          ["CBD", product.cbdRate],
          ["CBG", product.cbgRate],
          ["THC", product.thcRate],
          ["Origine", product.origin],
          ["Culture", product.cultureType],
          ["Stock", stockLabel],
        ];

  function handleAddToCart() {
    if (!product || !selectedPurchaseOption) return;
    if (selectedPurchaseOption.fixedPriceOptionId) {
      addFixedPriceOption(product.id, selectedPurchaseOption.fixedPriceOptionId);
    } else {
      addItem(product.id);
    }
    trackAddToCart(product, selectedPurchaseOption.quantityGrams);
  }

  return (
    <main className="container-page pb-28 pt-12 lg:pb-12">
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
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-x-10">
        <section className="lg:col-start-2 lg:row-start-1">
          <p className="text-sm uppercase tracking-[0.18em] text-champagne">
            {product.category === "flowers" ? "Fleur CBD" : "Résine CBD"}
          </p>
          <div className="mt-3 flex items-start justify-between gap-4">
            <h1 className="font-display text-4xl leading-none text-forest sm:text-5xl">
              {product.name}
            </h1>
            <FavoriteButton product={product} className="shrink-0" />
          </div>
          <p className="mt-5 text-lg leading-8 text-ink/70">{product.shortDescription}</p>

          <div
            ref={purchaseBlockRef}
            className="mt-6 rounded-lg border border-champagne/35 bg-cream p-4 shadow-sm sm:p-5"
          >
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-forest/10 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                  Prix au gramme
                </p>
                <p className="mt-1 font-display text-4xl leading-none text-forest">
                  {formatProductPrice(product.price)}
                </p>
              </div>
              <span className="rounded-full border border-forest/15 bg-ivory px-3 py-1.5 text-xs font-semibold text-forest">
                {purchaseAvailabilityLabel}
              </span>
            </div>

            {purchaseOptions.length > 0 && (
              <fieldset className="mt-4">
                <legend className="font-display text-2xl text-forest">Choisir un format</legend>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {purchaseOptions.map((option) => {
                    const selected = option.id === selectedPurchaseOption?.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={`relative min-h-[76px] rounded-md border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 ${
                          selected
                            ? "border-forest/55 bg-sage/25 text-forest shadow-[inset_0_0_0_1px_rgba(11,61,46,0.08)]"
                            : "border-forest/15 bg-ivory text-forest hover:border-forest/30 hover:bg-sage/10"
                        } disabled:cursor-not-allowed disabled:border-forest/10 disabled:bg-cream/50 disabled:text-ink/35 disabled:opacity-100 disabled:hover:border-forest/10 disabled:hover:bg-cream/50`}
                        aria-pressed={selected}
                        disabled={!option.available}
                        title={option.available ? undefined : "Stock insuffisant pour ce format"}
                        onClick={() => setSelectedPurchaseOptionId(option.id)}
                      >
                        {selected && (
                          <Check
                            size={15}
                            className="absolute right-2 top-2 text-forest/70"
                            aria-hidden="true"
                          />
                        )}
                        <span className="block font-semibold">{option.quantityGrams} g</span>
                        <span className="mt-1 block text-sm text-forest/65">
                          {formatProductPrice(option.totalPrice)}
                        </span>
                        {!option.available && (
                          <span className="mt-1 block text-[11px] leading-tight">Stock insuffisant</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}
            {fixedPriceOptions.some((option) => isFixedPriceAdvantageous(product, option)) && (
              <p className="mt-3 text-xs text-forest/60">
                Prix au gramme plus avantageux selon le format choisi.
              </p>
            )}
            <button
              type="button"
              className="btn-primary mt-4 w-full disabled:cursor-not-allowed disabled:bg-forest/45 disabled:text-ivory/80"
              disabled={!selectedPurchaseOption}
              onClick={handleAddToCart}
            >
              <ShoppingBag size={18} aria-hidden="true" />
              {selectedPurchaseOption
                ? `Ajouter ${productPurchaseCtaLabel(selectedPurchaseOption)}`
                : stockLabel !== "Disponible"
                  ? stockLabel
                  : "Stock restant insuffisant"}
            </button>
          </div>
        </section>

        <div className="space-y-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <div className="aspect-square rounded-lg border border-champagne/30 bg-cream p-6 sm:p-8">
            <ProductImage
              variant="detail"
              src={selectedImage?.url || product.image}
              alt={selectedImage?.alt || productImageAlt(product)}
              loading="eager"
              fetchPriority="high"
              className="mx-auto h-full w-full object-contain"
            />
          </div>
          {productImages.length > 1 && (
            <div className="grid grid-cols-3 gap-3" aria-label={`Galerie ${product.name}`}>
              {productImages.map((image) => {
                const selected = image.id === selectedImage?.id;
                return (
                  <button
                    key={image.id}
                    type="button"
                    className={`aspect-square rounded-md border bg-ivory p-2 transition focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 ${
                      selected ? "border-forest ring-1 ring-forest" : "border-forest/10 hover:border-forest/40"
                    }`}
                    aria-label={`Afficher ${image.alt}`}
                    aria-pressed={selected}
                    onClick={() => setSelectedImageId(image.id)}
                  >
                    <ProductImage variant="card" src={image.url} alt="" className="h-full w-full object-contain" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <section className="lg:col-start-2 lg:row-start-2">
          <div>
            <h2 className="font-display text-2xl text-forest">Description détaillée</h2>
            <p className="mt-2 leading-7 text-ink/70">{product.longDescription}</p>
          </div>
          <div className="mt-7 flex items-start gap-4">
            <dl className="grid flex-1 gap-3 sm:grid-cols-2">
              {keyFacts.map(([label, value]) => (
                <div key={label} className="rounded-md border border-forest/10 bg-ivory p-4">
                  <dt className="text-xs uppercase tracking-[0.14em] text-ink/45">{label}</dt>
                  <dd className="mt-1 text-forest">{value}</dd>
                </div>
              ))}
            </dl>
            {product.qualitySealEnabled && (
              <QualityBadge variant="standard" className="mt-1 hidden sm:block" />
            )}
          </div>
          {product.qualitySealEnabled && (
            <QualityBadge variant="standard" className="mt-4 sm:hidden" />
          )}
          <div className="mt-6">
            <h2 className="font-display text-2xl text-forest">Arômes</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {product.aromas.map((aroma) => (
                <span key={aroma} className="tag">{aroma}</span>
              ))}
            </div>
          </div>
          {product.whyChooseDescription && (
            <div className="mt-7">
              <h2 className="font-display text-2xl text-forest">
                Pourquoi choisir cette {product.category === "flowers" ? "fleur" : "résine"} ?
              </h2>
              <p className="mt-2 leading-7 text-ink/70">{product.whyChooseDescription}</p>
            </div>
          )}
          {product.advisedProfile && (
            <div className="mt-5 rounded-md border border-forest/10 bg-cream p-5">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-champagne">Profil conseillé</h2>
              <p className="mt-2 leading-7 text-forest">{product.advisedProfile}</p>
            </div>
          )}
          {isHydroponicFlower && (
            <div className="mt-7">
              <h2 className="font-display text-2xl text-forest">Qualité & culture</h2>
              <p className="mt-2 leading-7 text-ink/70">
                Cette fleur est issue d'une culture hydroponique, une méthode qui
                permet de mieux contrôler l'environnement de production. Elle est
                sélectionnée pour sa structure, son profil aromatique et sa qualité
                visuelle.
              </p>
            </div>
          )}
          {isResin && (
            <div className="mt-7">
              <h2 className="font-display text-2xl text-forest">Composition</h2>
              <p className="mt-2 leading-7 text-ink/70">
                Cette résine est sélectionnée pour sa texture, son profil aromatique et sa qualité visuelle.
              </p>
            </div>
          )}
          {product.experienceDescription && (
            <div className="mt-7 border-l-2 border-champagne pl-5">
              <h2 className="font-display text-2xl text-forest">Expérience Verdanza</h2>
              <p className="mt-2 leading-7 text-ink/70">{product.experienceDescription}</p>
            </div>
          )}
          <p className="mt-6 text-sm leading-6 text-ink/60">
            Produit réservé aux personnes majeures. Tenir hors de portée des
            enfants. Ce produit n'est pas destiné à remplacer un traitement
            médical.
          </p>
        </section>
      </div>

      {selectedPurchaseOption && !purchaseBlockVisible && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-champagne/35 bg-ivory/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-[0_-12px_35px_rgba(11,61,46,0.12)] backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-forest/55">
                {product.name}
              </p>
              <p className="font-display text-xl text-forest">
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
