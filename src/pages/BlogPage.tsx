import { Link } from "react-router-dom";
import { BlogCard } from "../components/BlogCard";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Seo } from "../components/Seo";
import { publishedBlogArticles } from "../data/blogArticles";

export function BlogPage() {
  return (
    <main className="container-page py-12">
      <Seo
        title="Guides CBD : fleurs, résines et méthodes de culture | Verdanza"
        description="Guides pratiques Verdanza pour comprendre fleurs et résines CBD, méthodes de culture, qualité et informations du catalogue."
        path="/blog"
      />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: "Guides CBD", path: "/blog", current: true },
        ]}
      />

      <div className="page-intro">
        <h1>Guides CBD Verdanza</h1>
        <p>
          Des guides simples pour mieux comprendre les fleurs, résines, méthodes de
          culture et informations affichées dans le catalogue Verdanza.
        </p>
      </div>

      <section className="mt-10 grid gap-6 lg:grid-cols-2">
        {publishedBlogArticles.map((article) => (
          <BlogCard key={article.slug} article={article} />
        ))}
      </section>

      <section className="mt-12 rounded-lg border border-forest/10 bg-cream p-6 sm:p-8">
        <h2 className="font-display text-3xl text-forest">Explorer Verdanza</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { to: "/fleurs-cbd", label: "Fleurs CBD" },
            { to: "/resines-cbd", label: "Résines CBD" },
            { to: "/qualite-conformite", label: "Qualité" },
            { to: "/livraison-express-aix", label: "Livraison Aix" },
            { to: "/boutique", label: "Boutique" },
          ].map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="rounded-md border border-forest/10 bg-ivory px-4 py-3 text-sm font-semibold text-forest transition hover:border-champagne"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
