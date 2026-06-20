import { Seo } from "../components/Seo";

const content = {
  quality: {
    title: "Qualite & conformite",
    text: "Verdanza privilegie une selection courte, tracable et conforme. Les analyses de lot, certificats et informations fournisseurs seront connectes au CMS avant publication commerciale.",
    points: [
      "THC inferieur a 0,3 %",
      "Produits reserves aux personnes majeures",
      "Lots controles et informations a confirmer avant mise en vente",
      "Aucune promesse medicale",
    ],
  },
  about: {
    title: "A propos",
    text: "Verdanza est une marque inspiree par la Provence, construite autour d'une experience vegetale sobre, premium et transparente.",
    points: [
      "Selection CBD premium",
      "Service local a Aix-en-Provence",
      "Livraison postale discrete",
      "Design naturel et haut de gamme",
    ],
  },
  faq: {
    title: "FAQ",
    text: "Les reponses finales devront etre relues avant publication. Cette base couvre les questions principales de Phase 1.",
    points: [
      "Les produits sont-ils reserves aux majeurs ? Oui.",
      "Le THC est-il conforme ? Les fiches indiquent un taux inferieur a 0,3 %.",
      "La livraison express couvre-t-elle toute la France ? Non, elle est locale autour d'Aix.",
      "Le paiement Stripe est-il actif ? Pas encore, le checkout serveur arrive en Phase 2.",
    ],
  },
  contact: {
    title: "Contact",
    text: "Les coordonnees definitives restent a valider. Cette page prepare le futur point de contact client.",
    points: [
      "Email support : a renseigner",
      "Telephone ou WhatsApp : a renseigner",
      "Adresse legale : a renseigner",
      "Horaires livraison locale : a parametrer",
    ],
  },
} as const;

export function ContentPage({ variant }: { variant: keyof typeof content }) {
  const page = content[variant];
  return (
    <main className="container-page py-12">
      <Seo title={`${page.title} - Verdanza CBD`} description={page.text} />
      <div className="page-intro">
        <h1>{page.title}</h1>
        <p>{page.text}</p>
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {page.points.map((point) => (
          <article key={point} className="feature-panel">
            <h2>{point}</h2>
          </article>
        ))}
      </div>
    </main>
  );
}
