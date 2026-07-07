import { ProductCard } from "../components/ProductCard";
import { CatalogNotice } from "../components/CatalogNotice";
import { Seo } from "../components/Seo";
import { useProducts } from "../hooks/useProducts";

export function ShopPage() {
  const { products, source, isLoading } = useProducts();

  return (
    <main className="container-page py-12">
      <Seo
        title="Boutique Verdanza CBD"
        description="Catalogue Verdanza CBD : fleurs et resines premium disponibles au gramme, livraison express Aix-en-Provence et alentours."
      />
      <div className="page-intro">
        <h1>Boutique CBD premium</h1>
        <p>
          Selection réelle Verdanza : fleurs et résines CBD premium disponibles
          au gramme, avec livraison express locale à Aix-en-Provence et alentours.
        </p>
        <p className="mt-3 text-sm text-forest/65">
          Catalogue : {source === "firestore" ? "stock en ligne" : "selection locale"}.
        </p>
      </div>
      <CatalogNotice />
      {isLoading ? (
        <p className="mt-10 text-forest/70">Chargement du catalogue...</p>
      ) : (
        <div className="product-grid mt-10">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </main>
  );
}
