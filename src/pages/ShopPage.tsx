import { ProductCard } from "../components/ProductCard";
import { Seo } from "../components/Seo";
import { useProducts } from "../hooks/useProducts";

export function ShopPage() {
  const { products, source, isLoading } = useProducts();

  return (
    <main className="container-page py-12">
      <Seo
        title="Boutique Verdanza CBD"
        description="Catalogue initial Verdanza CBD : fleurs et resines premium, THC inferieur a 0,3 %."
      />
      <div className="page-intro">
        <h1>Boutique CBD premium</h1>
        <p>
          Catalogue Phase 1 construit depuis la selection produit fournie. Les
          prix, stocks et donnees de lot sont placeholders avant connexion CMS.
        </p>
        <p className="mt-3 text-sm text-forest/65">
          Source catalogue : {source === "firestore" ? "Firestore" : "fallback local"}.
        </p>
      </div>
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
