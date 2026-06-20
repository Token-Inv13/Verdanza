import { Seo } from "../components/Seo";

export function LegalPage({ title }: { title: string }) {
  return (
    <main className="container-page py-12">
      <Seo title={`${title} - Verdanza CBD`} description={`${title} Verdanza.`} />
      <div className="page-intro">
        <h1>{title}</h1>
        <p>
          Placeholder juridique Phase 1. Ce contenu doit etre complete et relu
          avant toute mise en production.
        </p>
      </div>
      <section className="mt-10 rounded-lg border border-forest/10 bg-cream p-8 leading-7 text-ink/70">
        <p>Statut juridique, adresse, responsable de publication et politiques finales : a renseigner.</p>
        <p className="mt-4">
          Les produits sont reserves aux personnes majeures, avec un taux de THC
          conforme inferieur a 0,3 %. Tenir hors de portee des enfants.
        </p>
      </section>
    </main>
  );
}
