import { Seo } from "../components/Seo";

export function LegalPage({ title }: { title: string }) {
  const sections = legalSections(title);
  return (
    <main className="container-page py-12">
      <Seo title={`${title} - Verdanza CBD`} description={`${title} Verdanza.`} />
      <div className="page-intro">
        <h1>{title}</h1>
        <p>
          Informations de conformite Verdanza pour les commandes, la livraison,
          la confidentialite et les produits CBD reserves aux adultes.
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

function legalSections(title: string) {
  const common = [
    {
      heading: "Conformite CBD",
      items: [
        "Vente reservee aux personnes majeures.",
        "Produits issus du chanvre avec un taux de THC inferieur a 0,3 %.",
        "Les produits ne remplacent pas un traitement medical et ne font l'objet d'aucune promesse therapeutique.",
        "Tenir hors de portee des enfants. Deconseille aux femmes enceintes ou allaitantes.",
      ],
    },
  ];

  if (title.includes("Mentions")) {
    return [
      {
        heading: "Editeur",
        items: [
          "Editeur du site : Verdanza.",
          "Contact professionnel : formulaire de contact du site Verdanza.",
          "Les informations d'identification legale de l'editeur doivent etre confirmees par l'exploitant avant ouverture commerciale complete.",
        ],
      },
      {
        heading: "Hebergement",
        items: [
          "Application hebergee par Vercel Inc., 340 S Lemon Ave #4133, Walnut, CA 91789, Etats-Unis.",
        ],
      },
      ...common,
    ];
  }

  if (title.includes("Conditions")) {
    return [
      {
        heading: "Commande et paiement",
        items: [
          "Les prix sont affiches au gramme et les stocks sont geres dans l'administration.",
          "Le paiement est traite par Stripe Checkout. Verdanza ne stocke pas les donnees de carte bancaire.",
          "Une commande est confirmee apres validation du paiement et verification du stock.",
        ],
      },
      {
        heading: "Livraison",
        items: [
          "Livraison express locale autour d'Aix-en-Provence, 7j/7 de 11h a 01h, selon zones configurees.",
          "Livraison hors zone non ouverte au lancement local, sauf confirmation directe par Verdanza.",
        ],
      },
      ...common,
    ];
  }

  if (title.includes("confidentialite")) {
    return [
      {
        heading: "Donnees collectees",
        items: [
          "Les donnees de compte, commande, livraison et contact sont utilisees pour executer la commande et assurer le suivi client.",
          "Firebase Auth et Firestore sont utilises pour l'authentification, les commandes et l'administration.",
          "Stripe traite les donnees de paiement. Verdanza ne stocke pas les numeros de carte.",
        ],
      },
      {
        heading: "Droits utilisateur",
        items: [
          "Toute demande relative aux donnees personnelles peut etre transmise via le formulaire de contact du site.",
        ],
      },
      ...common,
    ];
  }

  return [
    {
      heading: "Retours et annulation",
      items: [
        "Les demandes de retour sont examinees au cas par cas selon les produits, leur etat et les obligations applicables.",
        "Les produits ouverts, alteres ou impropres a la remise en vente peuvent etre exclus du retour selon la politique finale.",
        "Les demandes client sont traitees via le formulaire de contact du site.",
      ],
    },
    ...common,
  ];
}
