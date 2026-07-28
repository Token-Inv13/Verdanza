import { Link } from "react-router-dom";
import { Seo } from "../components/Seo";

export function NotFoundPage() {
  return (
    <main className="container-page py-16">
      <Seo
        title="Page introuvable - Verdanza CBD"
        description="Cette page Verdanza n'existe pas ou a ete deplacee."
        canonical={null}
        noindex
      />
      <section className="max-w-2xl rounded-lg border border-forest/10 bg-cream p-8">
        <p className="text-sm uppercase tracking-[0.18em] text-champagne">Erreur 404</p>
        <h1 className="mt-3 font-display text-5xl text-forest">Page introuvable</h1>
        <p className="mt-5 leading-7 text-ink/70">
          Le lien demande ne correspond a aucune page publique Verdanza.
        </p>
        <Link to="/boutique" className="btn-primary mt-8 inline-flex">
          Retour boutique
        </Link>
      </section>
    </main>
  );
}
