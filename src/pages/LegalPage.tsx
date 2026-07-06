import { Seo } from "../components/Seo";

export function LegalPage({ title }: { title: string }) {
  const contactEmail =
    (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) ||
    "contact@verdanza.fr";
  const sections = legalSections(title, contactEmail);
  return (
    <main className="container-page py-12">
      <Seo title={`${title} - Verdanza CBD`} description={`${title} Verdanza.`} />
      <div className="page-intro">
        <h1>{title}</h1>
        <p>
          Informations de conformité Verdanza pour les commandes, la livraison,
          la confidentialité et les produits CBD réservés aux adultes.
        </p>
      </div>
      <div className="mt-10 grid gap-4">
        {sections.map((section) => (
          <section
            key={section.heading}
            className="rounded-lg border border-forest/10 bg-cream p-6 leading-7 text-ink/70"
          >
            <h2 className="font-display text-3xl text-forest">{section.heading}</h2>
            {section.items.map((item) => (
              <p key={item} className="mt-3">
                {item}
              </p>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}

function legalSections(title: string, contactEmail?: string) {
  const common = [
    {
      heading: "Conformité CBD",
      items: [
        "Vente réservée aux personnes majeures.",
        "Produits issus du chanvre avec un taux de THC inférieur à 0,3 %.",
        "Les produits ne remplacent pas un traitement médical et ne font l'objet d'aucune promesse thérapeutique.",
        "Tenir hors de portée des enfants. Déconseillé aux femmes enceintes ou allaitantes.",
      ],
    },
  ];

  if (title.includes("Mentions")) {
    return [
      {
        heading: "Éditeur",
        items: [
          "Éditeur du site : Verdanza.",
          `Contact professionnel : ${contactEmail}.`,
          "Les informations d'identification légale de l'éditeur doivent être confirmées par l'exploitant avant ouverture commerciale complète.",
        ],
      },
      {
        heading: "Hébergement",
        items: [
          "Application hébergée par Vercel Inc., 340 S Lemon Ave #4133, Walnut, CA 91789, États-Unis.",
        ],
      },
      ...common,
    ];
  }

  if (title.includes("Conditions")) {
    return [
      {
        heading: "Commande et règlement",
        items: [
          "Les prix sont affichés au gramme et les disponibilités sont vérifiées avant validation de la commande.",
          "Le règlement est confirmé directement avec le client par téléphone ou par email après validation de commande.",
          "Une commande est enregistrée après vérification du panier, du stock et des informations de livraison.",
        ],
      },
      {
        heading: "Livraison",
        items: [
          "Livraison postale disponible en France selon les informations indiquées avant validation de la commande.",
          "Livraison locale disponible autour d'Aix-en-Provence, 7j/7 de 11h à 01h, selon zone ouverte.",
        ],
      },
      ...common,
    ];
  }

  if (title.includes("Confidentialité") || title.includes("confidentialite")) {
    return [
      {
        heading: "Données collectées",
        items: [
          "Les données de compte, commande, livraison et contact sont utilisées pour exécuter la commande et assurer le suivi client.",
          "Les données sont traitées par des prestataires techniques nécessaires au fonctionnement du site et au suivi des commandes.",
          "Les données de règlement manuel sont utilisées uniquement pour le suivi de commande et la confirmation administrative.",
        ],
      },
      {
        heading: "Droits utilisateur",
        items: [
          `Toute demande relative aux données personnelles peut être transmise à ${contactEmail}.`,
        ],
      },
      ...common,
    ];
  }

  return [
    {
      heading: "Retours et annulation",
      items: [
        "Les demandes de retour sont examinées au cas par cas selon les produits, leur état et les obligations applicables.",
        "Les produits ouverts, altérés ou impropres à la remise en vente peuvent être exclus du retour selon la politique finale.",
        `Les demandes client sont traitées via ${contactEmail} ou le formulaire de contact du site.`,
      ],
    },
    ...common,
  ];
}
