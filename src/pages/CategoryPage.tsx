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
      "Selection de fleurs CBD Verdanza : indoor, greenhouse et hydroponique selon les references, avec livraison a Aix-en-Provence et livraison postale.",
    intro:
      "Verdanza propose une selection de fleurs CBD aux profils aromatiques et modes de culture varies. Les informations affichees reprennent les fiches produits et analyses producteurs disponibles, avec une disponibilite indiquee sur chaque reference.",
    guideTitle: "Comprendre les methodes de culture",
    guideText:
      "La selection reunit des fleurs indoor, sous serre et hydroponiques. L'indoor permet un controle fin de l'environnement, la greenhouse s'appuie sur une culture sous serre, et l'hydroponique repose sur une culture controlee hors sol. Chaque methode peut influencer la structure, la presentation et l'expression aromatique sans etre systematiquement superieure aux autres.",
    compareTitle: "Comment comparer les fleurs CBD",
    compareItems: [
      "Profil aromatique indique sur la fiche produit.",
      "Mode de culture : indoor, sous serre ou hydroponique selon la reference.",
      "Origine lorsqu'elle est connue.",
      "Aspect, structure et informations fournisseur disponibles.",
      "Disponibilite, statut en arrivage et prix au gramme.",
    ],
    selectionTitle: "La selection Verdanza",
    selectionText:
      "La selection privilegie des references distinctes, des informations lisibles et une presentation claire de la tracabilite lorsque les donnees sont disponibles. Les fiches restent factuelles et ne formulent aucune promesse therapeutique.",
    featuredTitle: "Fleurs a comparer",
    featuredIntro:
      "Ces liens permettent d'ouvrir rapidement plusieurs fiches fleurs sans dupliquer les informations detaillees de chaque produit.",
    faq: [
      {
        question: "Quelle difference entre indoor, greenhouse et hydroponique ?",
        answer:
          "Ces termes decrivent des methodes de culture. Indoor signifie culture en interieur, greenhouse correspond aux cultures sous serre, et hydroponique designe une culture controlee hors sol.",
      },
      {
        question: "Comment choisir une fleur selon son profil aromatique ?",
        answer:
          "Comparez les aromes affiches, l'origine lorsqu'elle est connue, le mode de culture et le prix au gramme. La fiche produit reste la source principale.",
      },
      {
        question: "Les fleurs en arrivage peuvent-elles etre commandees ?",
        answer:
          "Les produits marques en arrivage conservent leur statut reel et ne peuvent pas etre ajoutes au panier tant que la disponibilite n'est pas ouverte.",
      },
      {
        question: "La livraison est-elle disponible hors d'Aix-en-Provence ?",
        answer:
          "La livraison locale couvre les zones configurees autour d'Aix-en-Provence. La livraison postale permet aussi une expedition en France selon les conditions affichees.",
      },
    ],
    links: [
      { to: "/resines-cbd", label: "Comparer avec les resines CBD" },
      { to: "/livraison-express-aix", label: "Voir la livraison a Aix-en-Provence" },
      { to: "/livraison-postale", label: "Verifier la livraison postale" },
      { to: "/qualite-conformite", label: "Consulter les engagements qualite" },
      { to: "/boutique", label: "Retourner a la boutique" },
    ],
  },
  resins: {
    path: "/resines-cbd",
    title: "Resines CBD premium",
    breadcrumb: "Résines CBD",
    seoTitle: "Resines CBD premium : selection et profils | Verdanza",
    seoDescription:
      "Selection de resines CBD Verdanza avec textures, taux declares et profils disponibles, livraison locale a Aix-en-Provence et livraison postale.",
    intro:
      "Les resines CBD Verdanza regroupent des references dont la texture, la composition declaree et le profil aromatique peuvent varier selon les fiches. Les produits sont reserves aux adultes et les donnees affichees restent propres a chaque reference.",
    guideTitle: "Comprendre CBD, CBG et autres indications",
    guideText:
      "CBD, CBG ou CBN designent des cannabinoides mentionnes lorsqu'ils sont indiques sur une fiche produit. Leur presence ou leur taux depend de chaque reference et ne doit pas etre interprete comme une indication medicale.",
    compareTitle: "Comment comparer les resines CBD",
    compareItems: [
      "Texture decrite sur la fiche : compacte, friable, souple ou cremeuse.",
      "Profil aromatique et origine lorsqu'ils sont renseignes.",
      "Taux de CBD et presence declaree de CBG, CBN ou autres cannabinoides.",
      "Methode de fabrication ou culture lorsqu'elle est connue.",
      "Prix au gramme et disponibilite reelle.",
    ],
    selectionTitle: "La selection Verdanza",
    selectionText:
      "La selection met en avant des references lisibles, des prix clairs et les informations disponibles sans extrapoler d'effets a partir des cannabinoides. Chaque fiche doit etre consultee pour les details exacts.",
    featuredTitle: "Resines a decouvrir",
    featuredIntro:
      "Ces liens ouvrent directement les fiches des resines actives pour comparer les profils disponibles.",
    faq: [
      {
        question: "Quelle difference entre une fleur et une resine CBD ?",
        answer:
          "Une fleur correspond a la matiere vegetale issue de la plante. Une resine est une preparation dont la texture et la composition declaree dependent de la reference.",
      },
      {
        question: "Comment comparer les textures de resine ?",
        answer:
          "Appuyez-vous sur les descriptions disponibles : compact, friable, souple, cremeux ou mousseux lorsque ces indications sont presentes.",
      },
      {
        question: "Que signifient CBD et CBG sur une fiche produit ?",
        answer:
          "Ce sont des cannabinoides. Les taux ou mentions affiches sont propres a chaque fiche produit et ne constituent pas une promesse d'effet.",
      },
      {
        question: "Quels sont les modes de livraison ?",
        answer:
          "Verdanza propose la livraison locale dans les zones configurees autour d'Aix-en-Provence et la livraison postale en France selon les conditions affichees.",
      },
    ],
    links: [
      { to: "/fleurs-cbd", label: "Voir les fleurs CBD" },
      { to: "/livraison-express-aix", label: "Voir la livraison a Aix-en-Provence" },
      { to: "/livraison-postale", label: "Verifier la livraison postale" },
      { to: "/qualite-conformite", label: "Consulter les engagements qualite" },
      { to: "/boutique", label: "Retourner a la boutique" },
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
          {categoryProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
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
              {product.category === "flowers" ? "Decouvrir" : "Consulter"} {product.name}
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
        <h2 className="font-display text-3xl text-forest">Questions frequentes</h2>
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
