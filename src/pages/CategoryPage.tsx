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
        description={`${title} Verdanza, produits CBD premium au gramme avec livraison express Aix-en-Provence et alentours.`}
      />
      <div className="page-intro">
        <h1>{title}</h1>
        <p>
          Une selection courte, réelle et lisible, centrée sur les produits
          actuellement disponibles chez Verdanza.
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
