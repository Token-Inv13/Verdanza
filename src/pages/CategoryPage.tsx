import { Link } from "react-router-dom";
import { ProductCard } from "../components/ProductCard";
import { CatalogNotice } from "../components/CatalogNotice";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Seo } from "../components/Seo";
import { useProducts } from "../hooks/useProducts";
import { getProductsByCategory } from "../data/products";
import type { Product, ProductCategory } from "../types";

const categoryContent = {
  flowers: {
    path: "/fleurs-cbd",
    title: "Fleurs CBD premium",
    breadcrumb: "Fleurs CBD",
    seoTitle: "Fleurs CBD premium : indoor, greenhouse et hydroponique | Verdanza",
    seoDescription:
      "Sélection de fleurs CBD Verdanza : indoor, greenhouse et hydroponique selon les références, avec livraison à Aix-en-Provence et livraison postale.",
    intro:
      "Verdanza propose une sélection de fleurs CBD aux profils aromatiques et modes de culture variés. Les informations affichées reprennent les fiches produits et analyses producteurs disponibles, avec une disponibilité indiquée sur chaque référence.",
    guideTitle: "Comprendre les méthodes de culture",
    guideText:
      "La sélection réunit des fleurs indoor, sous serre et hydroponiques. L'indoor permet un contrôle fin de l'environnement, la greenhouse s'appuie sur une culture sous serre, et l'hydroponique repose sur une culture contrôlée hors sol. Chaque méthode peut influencer la structure, la présentation et l'expression aromatique sans être systématiquement supérieure aux autres.",
    compareTitle: "Comment comparer les fleurs CBD",
    compareItems: [
      "Profil aromatique indiqué sur la fiche produit.",
      "Mode de culture : indoor, sous serre ou hydroponique selon la référence.",
      "Origine lorsqu'elle est connue.",
      "Aspect, structure et informations fournisseur disponibles.",
      "Disponibilité, statut en arrivage et prix au gramme.",
    ],
    selectionTitle: "La sélection Verdanza",
    selectionText:
      "La sélection privilégie des références distinctes, des informations lisibles et une présentation claire de la traçabilité lorsque les données sont disponibles. Les fiches restent factuelles et ne formulent aucune promesse thérapeutique.",
    featuredTitle: "Fleurs à comparer",
    featuredIntro:
      "Ces liens permettent d'ouvrir rapidement plusieurs fiches fleurs sans dupliquer les informations détaillées de chaque produit.",
    faq: [
      {
        question: "Quelle différence entre indoor, greenhouse et hydroponique ?",
        answer:
          "Ces termes décrivent des méthodes de culture. Indoor signifie culture en intérieur, greenhouse correspond aux cultures sous serre, et hydroponique désigne une culture contrôlée hors sol.",
      },
      {
        question: "Comment choisir une fleur selon son profil aromatique ?",
        answer:
          "Comparez les arômes affichés, l'origine lorsqu'elle est connue, le mode de culture et le prix au gramme. La fiche produit reste la source principale.",
      },
      {
        question: "Les fleurs en arrivage peuvent-elles être commandées ?",
        answer:
          "Les produits marqués en arrivage conservent leur statut réel et ne peuvent pas être ajoutés au panier tant que la disponibilité n'est pas ouverte.",
      },
      {
        question: "La livraison est-elle disponible hors d'Aix-en-Provence ?",
        answer:
          "La livraison locale couvre les zones configurées autour d'Aix-en-Provence. La livraison postale permet aussi une expédition en France selon les conditions affichées.",
      },
    ],
    links: [
      { to: "/resines-cbd", label: "Comparer avec les résines CBD" },
      { to: "/livraison-express-aix", label: "Voir la livraison à Aix-en-Provence" },
      { to: "/livraison-postale", label: "Vérifier la livraison postale" },
      { to: "/qualite-conformite", label: "Consulter les engagements qualité" },
      { to: "/boutique", label: "Retourner à la boutique" },
    ],
  },
  resins: {
    path: "/resines-cbd",
    title: "Résines CBD premium",
    breadcrumb: "Résines CBD",
    seoTitle: "Résines CBD premium : sélection et profils | Verdanza",
    seoDescription:
      "Sélection de résines CBD Verdanza avec textures, taux déclarés et profils disponibles, livraison locale à Aix-en-Provence et livraison postale.",
    intro:
      "Les résines CBD Verdanza regroupent des références dont la texture, la composition déclarée et le profil aromatique peuvent varier selon les fiches. Les produits sont réservés aux adultes et les données affichées restent propres à chaque référence.",
    guideTitle: "Comprendre CBD, CBG et autres indications",
    guideText:
      "CBD, CBG ou CBN désignent des cannabinoïdes mentionnés lorsqu'ils sont indiqués sur une fiche produit. Leur présence ou leur taux dépend de chaque référence et ne doit pas être interprété comme une indication médicale.",
    compareTitle: "Comment comparer les résines CBD",
    compareItems: [
      "Texture décrite sur la fiche : compacte, friable, souple ou crémeuse.",
      "Profil aromatique et origine lorsqu'ils sont renseignés.",
      "Taux de CBD et présence déclarée de CBG, CBN ou autres cannabinoïdes.",
      "Méthode de fabrication ou culture lorsqu'elle est connue.",
      "Prix au gramme et disponibilité réelle.",
    ],
    selectionTitle: "La sélection Verdanza",
    selectionText:
      "La sélection met en avant des références lisibles, des prix clairs et les informations disponibles sans extrapoler d'effets à partir des cannabinoïdes. Chaque fiche doit être consultée pour les détails exacts.",
    featuredTitle: "Résines à découvrir",
    featuredIntro:
      "Ces liens ouvrent directement les fiches des résines actives pour comparer les profils disponibles.",
    faq: [
      {
        question: "Quelle différence entre une fleur et une résine CBD ?",
        answer:
          "Une fleur correspond à la matière végétale issue de la plante. Une résine est une préparation dont la texture et la composition déclarée dépendent de la référence.",
      },
      {
        question: "Comment comparer les textures de résine ?",
        answer:
          "Appuyez-vous sur les descriptions disponibles : compact, friable, souple, crémeux ou mousseux lorsque ces indications sont présentes.",
      },
      {
        question: "Que signifient CBD et CBG sur une fiche produit ?",
        answer:
          "Ce sont des cannabinoïdes. Les taux ou mentions affichés sont propres à chaque fiche produit et ne constituent pas une promesse d'effet.",
      },
      {
        question: "Quels sont les modes de livraison ?",
        answer:
          "Verdanza propose la livraison locale dans les zones configurées autour d'Aix-en-Provence et la livraison postale en France selon les conditions affichées.",
      },
    ],
    links: [
      { to: "/fleurs-cbd", label: "Voir les fleurs CBD" },
      { to: "/livraison-express-aix", label: "Voir la livraison à Aix-en-Provence" },
      { to: "/livraison-postale", label: "Vérifier la livraison postale" },
      { to: "/qualite-conformite", label: "Consulter les engagements qualité" },
      { to: "/boutique", label: "Retourner à la boutique" },
    ],
  },
} satisfies Record<string, CategoryContent>;

type CategoryContent = {
  path: string;
  title: string;
  breadcrumb: string;
  seoTitle: string;
  seoDescription: string;
  intro: string;
  guideTitle: string;
  guideText: string;
  compareTitle: string;
  compareItems: string[];
  selectionTitle: string;
  selectionText: string;
  featuredTitle: string;
  featuredIntro: string;
  faq: { question: string; answer: string }[];
  links: { to: string; label: string }[];
};

export function CategoryPage({
  category,
  title,
}: {
  category: ProductCategory;
  title: string;
}) {
  const { products, isLoading } = useProducts();
  const pageCategory = category === "flowers" ? "flowers" : "resins";
  const content = categoryContent[pageCategory];
  const categoryProducts = products.filter((product) => product.category === category);
  const localCategoryProducts = getProductsByCategory(category).filter((product) => product.isActive);
  const highlightedProducts = localCategoryProducts.slice(0, 4);

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
        <p>{content.intro}</p>
      </div>
      <CatalogNotice variant={category === "flowers" ? "flowers" : "resins"} />
      {isLoading ? (
        <p className="mt-6 text-forest/70">Chargement des produits...</p>
      ) : (
        <div className="product-grid mt-6">
          {categoryProducts.map((product, index) => (
            <ProductCard key={product.id} product={product} priorityImage={index < 4} />
          ))}
        </div>
      )}
      <CategoryGuide content={content} products={highlightedProducts} titleFallback={title} />
    </main>
  );
}

function CategoryGuide({
  content,
  products,
  titleFallback,
}: {
  content: CategoryContent;
  products: Product[];
  titleFallback: string;
}) {
  return (
    <div className="mt-12 space-y-10">
      <section className="grid gap-6 lg:grid-cols-2">
        <article className="feature-panel">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-champagne">
            Guide {titleFallback}
          </p>
          <h2>{content.guideTitle}</h2>
          <p>{content.guideText}</p>
        </article>
        <article className="feature-panel">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-champagne">
            Comparer
          </p>
          <h2>{content.compareTitle}</h2>
          <ul className="mt-4 space-y-2 text-sm leading-6 text-ink/70">
            {content.compareItems.map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="rounded-lg border border-forest/10 bg-cream p-6 sm:p-8">
        <h2 className="font-display text-3xl text-forest">{content.selectionTitle}</h2>
        <p className="mt-4 max-w-4xl leading-7 text-ink/70">{content.selectionText}</p>
      </section>

      <section>
        <div className="section-heading mb-5">
          <div>
            <h2>{content.featuredTitle}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/65">
              {content.featuredIntro}
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {products.map((product) => (
            <Link
              key={product.id}
              to={`/produits/${product.slug}`}
              className="rounded-md border border-forest/10 bg-ivory p-4 text-sm font-semibold text-forest transition hover:border-champagne hover:bg-cream"
            >
              {product.category === "flowers" ? "Découvrir" : "Consulter"} {product.name}
              {product.comingSoon || product.stockStatus === "coming_soon" ? (
                <span className="mt-2 block text-xs font-medium text-ink/55">
                  {product.stockLabel || "En arrivage"}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display text-3xl text-forest">Liens utiles</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {content.links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="rounded-md border border-forest/10 bg-ivory px-4 py-3 text-sm font-semibold text-forest transition hover:border-champagne hover:bg-cream"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display text-3xl text-forest">Questions fréquentes</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {content.faq.map((item) => (
            <article key={item.question} className="rounded-lg border border-forest/10 bg-ivory p-5">
              <h3 className="font-display text-2xl leading-tight text-forest">
                {item.question}
              </h3>
              <p className="mt-3 text-sm leading-6 text-ink/70">{item.answer}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
