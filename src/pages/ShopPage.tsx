import { ProductCard } from "../components/ProductCard";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useNavigationType,
  useSearchParams,
} from "react-router-dom";
import { PromoBannerSlot } from "../components/PromoBannerSlot";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Seo } from "../components/Seo";
import { ShopProductSelector } from "../components/shop/ShopProductSelector";
import { useProducts } from "../hooks/useProducts";
import { trackViewItemList } from "../lib/analytics";
import {
  createProductDiscoverySearchParams,
  filterProductsByDiscoveryCriteria,
  getAvailableProductAromaFamilies,
  hasCompleteProductDiscoveryCriteria,
  parseProductDiscoverySearchParams,
} from "../lib/productDiscovery";

export function ShopPage() {
  const { products, isLoading } = useProducts();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [isSelectorEditing, setIsSelectorEditing] = useState(false);
  const criteria = useMemo(
    () => parseProductDiscoverySearchParams(searchParams),
    [searchParams],
  );
  const trackedListSignature = useRef("");
  const filteredProducts = useMemo(
    () => filterProductsByDiscoveryCriteria(products, criteria),
    [criteria, products],
  );
  const availableAromas = useMemo(
    () => Array.from(getAvailableProductAromaFamilies(products)),
    [products],
  );
  const hasCompleteSelection = hasCompleteProductDiscoveryCriteria(criteria);
  const isCompactMode = hasCompleteSelection && !isSelectorEditing;

  const applyCriteria = (nextCriteria: typeof criteria) => {
    setSearchParams(createProductDiscoverySearchParams(nextCriteria), { replace: true });
  };

  const resetCriteria = () => {
    setIsSelectorEditing(false);
    navigate("/boutique", { replace: true });
  };

  useEffect(() => {
    if (navigationType === "POP") setIsSelectorEditing(false);
  }, [location.key, navigationType]);

  useEffect(() => {
    if (isLoading) return;
    const signature = filteredProducts.map((product) => product.id).join("|");
    if (!signature || trackedListSignature.current === signature) return;
    trackedListSignature.current = signature;
    trackViewItemList("shop_catalog", "Boutique Verdanza", filteredProducts);
  }, [filteredProducts, isLoading]);

  return (
    <main className="container-page py-12">
      <Seo
        title="Boutique Verdanza CBD"
        description="Catalogue Verdanza CBD : fleurs et résines sélectionnées disponibles au gramme, avec livraison locale selon l’adresse ou livraison postale."
        path="/boutique"
      />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: "Boutique", path: "/boutique", current: true },
        ]}
      />
      {!isCompactMode ? (
        <div className="page-intro">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-champagne">
            Trouvez votre profil
          </p>
          <h1 className="mt-2">Trouvez votre sélection</h1>
          <p>Quelques choix suffisent pour affiner les produits Verdanza.</p>
          <p className="mt-3 text-sm leading-6 text-ink/65">
            Vous souhaitez une remise à domicile autour d’Aix ? Consultez la{" "}
            <Link
              to="/livraison-locale"
              className="font-semibold text-forest underline decoration-champagne/70 underline-offset-4"
            >
              zone et les conditions de livraison locale
            </Link>
            .
          </p>
        </div>
      ) : null}

      {!isLoading || products.length > 0 ? (
        <ShopProductSelector
          criteria={criteria}
          resultCount={filteredProducts.length}
          availableAromas={availableAromas}
          compact={isCompactMode}
          focusFirstStep={isSelectorEditing}
          onChange={applyCriteria}
          onEdit={() => setIsSelectorEditing(true)}
          onReset={resetCriteria}
        />
      ) : null}

      {!isCompactMode ? (
        <PromoBannerSlot placement="shop" type="shop_card" className="mt-6 grid gap-3" />
      ) : null}
      {isLoading && products.length === 0 ? (
        <p className="mt-6 text-forest/70">Chargement du catalogue...</p>
      ) : filteredProducts.length === 0 ? (
        <div
          className={`mx-auto max-w-2xl rounded-xl border border-champagne/35 bg-cream/45 px-5 py-8 text-center ${
            isCompactMode ? "mt-5" : "mt-8"
          }`}
        >
          <h2 className="font-display text-2xl text-forest">Aucun produit ne correspond</h2>
          <p className="mt-2 text-sm leading-6 text-ink/60">
            Élargissez votre sélection pour retrouver les produits disponibles au catalogue.
          </p>
          <button
            type="button"
            className="btn-secondary mt-5 min-h-11"
            onClick={resetCriteria}
          >
            Réinitialiser les critères
          </button>
        </div>
      ) : (
        <div className={`product-grid ${isCompactMode ? "mt-5" : "mt-6"}`}>
          {filteredProducts.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              priorityImage={index < 4}
              itemListId="shop_catalog"
              itemListName="Boutique Verdanza"
            />
          ))}
        </div>
      )}
      {isCompactMode ? (
        <PromoBannerSlot placement="shop" type="shop_card" className="mt-6 grid gap-3" />
      ) : null}
    </main>
  );
}
