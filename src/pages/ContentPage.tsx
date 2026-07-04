import { Seo } from "../components/Seo";

const content = {
  quality: {
    title: "Qualite & conformite",
    text: "Verdanza privilegie une selection courte, tracable et conforme, reservee aux adultes.",
    points: [
      "THC conforme selon analyse fournisseur",
      "Produits reserves aux personnes majeures",
      "Produits naturels selectionnes avec exigence",
      "Aucune promesse medicale",
    ],
  },
  about: {
    title: "A propos",
    text: "Verdanza est une marque inspiree par la Provence, construite autour d'une experience vegetale sobre, premium et transparente.",
    points: [
      "Selection CBD premium",
      "Service local a Aix-en-Provence",
      "Livraison express locale 7j/7 de 11h a 01h",
      "Design naturel et haut de gamme",
    ],
  },
  faq: {
    title: "FAQ",
    text: "Reponses pratiques sur les produits, la conformite, la livraison et le paiement.",
    points: [
      "Les produits sont-ils reserves aux majeurs ? Oui.",
      "Le THC est-il conforme ? Les fiches indiquent un taux inferieur a 0,3 %.",
      "La livraison express couvre-t-elle toute la France ? Non, elle est locale autour d'Aix-en-Provence.",
      "Le paiement Stripe est-il actif ? Oui, le paiement est traite par Stripe Checkout.",
    ],
  },
  contact: {
    title: "Contact",
    text: "Contactez Verdanza pour toute question produit, commande ou livraison locale.",
    points: [
      "Email support : a configurer sur le domaine verdanza.fr",
      "Telephone ou WhatsApp : A completer avant lancement",
      "Adresse legale : A completer avant lancement",
      "Horaires livraison locale : 7j/7 de 11h a 01h",
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
