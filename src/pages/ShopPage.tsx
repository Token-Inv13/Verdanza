import { ProductCard } from "../components/ProductCard";
import { CatalogNotice } from "../components/CatalogNotice";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Seo } from "../components/Seo";
import { useProducts } from "../hooks/useProducts";

export function ShopPage() {
  const { products, isLoading } = useProducts();

  return (
    <main className="container-page py-12">
      <Seo
        title="Boutique Verdanza CBD"
        description="Catalogue Verdanza CBD : fleurs et resines premium disponibles au gramme, livraison express Aix-en-Provence et alentours."
        path="/boutique"
      />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: "Boutique", path: "/boutique", current: true },
        ]}
      />
      <div className="page-intro">
        <h1>Boutique CBD premium</h1>
        <p>
          Selection réelle Verdanza : fleurs et résines CBD premium disponibles
          au gramme, avec livraison express locale à Aix-en-Provence et alentours.
        </p>
      </div>
      <CatalogNotice />
      {isLoading ? (
        <p className="mt-6 text-forest/70">Chargement du catalogue...</p>
      ) : (
        <div className="product-grid mt-6">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </main>
  );
}
