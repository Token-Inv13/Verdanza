import { ProductCard } from "../components/ProductCard";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { PromoBannerSlot } from "../components/PromoBannerSlot";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Seo } from "../components/Seo";
import { useProducts } from "../hooks/useProducts";
import { trackViewItemList } from "../lib/analytics";

export function ShopPage() {
  const { products, isLoading } = useProducts();
  const trackedListSignature = useRef("");

  useEffect(() => {
    if (isLoading) return;
    const signature = products.map((product) => product.id).join("|");
    if (!signature || trackedListSignature.current === signature) return;
    trackedListSignature.current = signature;
    trackViewItemList("shop_catalog", "Boutique Verdanza", products);
  }, [isLoading, products]);

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
      <div className="page-intro">
        <h1>Boutique CBD</h1>
        <p>
          Sélection réelle Verdanza : fleurs et résines CBD sélectionnées disponibles
          au gramme, avec livraison locale selon votre adresse ou livraison postale.
        </p>
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
      <PromoBannerSlot placement="shop" type="shop_card" className="mt-6 grid gap-3" />
      {isLoading && products.length === 0 ? (
        <p className="mt-6 text-forest/70">Chargement du catalogue...</p>
      ) : (
        <div className="product-grid mt-6">
          {products.map((product, index) => (
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
    </main>
  );
}
