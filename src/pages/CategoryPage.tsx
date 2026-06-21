import { ProductCard } from "../components/ProductCard";
import { Seo } from "../components/Seo";
import { useProducts } from "../hooks/useProducts";
import type { ProductCategory } from "../types";

export function CategoryPage({
  category,
  title,
}: {
  category: ProductCategory;
  title: string;
}) {
  const { products, isLoading } = useProducts();
  const categoryProducts = products.filter((product) => product.category === category);

  return (
    <main className="container-page py-12">
      <Seo
        title={`${title} - Verdanza CBD`}
        description={`${title} selection premium Verdanza, produits conformes et livraison Aix ou postale.`}
      />
      <div className="page-intro">
        <h1>{title}</h1>
        <p>
          Une selection courte et lisible pour la pre-ouverture Verdanza, avec
          fiches a confirmer a partir des analyses de lots.
        </p>
      </div>
      {isLoading ? (
        <p className="mt-10 text-forest/70">Chargement des produits...</p>
      ) : (
        <div className="product-grid mt-10">
          {categoryProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </main>
  );
}
