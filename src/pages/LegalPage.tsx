import { Seo } from "../components/Seo";

export function LegalPage({ title }: { title: string }) {
  const contactEmail = import.meta.env.VITE_CONTACT_EMAIL as string | undefined;
  const sections = legalSections(title, contactEmail);
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

function legalSections(title: string, contactEmail?: string) {
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
          contactEmail
            ? `Contact professionnel : ${contactEmail}.`
            : "Contact professionnel : formulaire de contact du site Verdanza.",
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
        heading: "Commande et reglement",
        items: [
          "Les prix sont affiches au gramme et les disponibilites sont verifiees avant validation de la commande.",
          "Le reglement est confirme directement avec le client par telephone ou par email apres validation de commande.",
          "Une commande est enregistree apres verification du panier, du stock et des informations de livraison.",
        ],
      },
      {
        heading: "Livraison",
        items: [
          "Livraison postale disponible en France selon les informations indiquees avant validation de la commande.",
          "Livraison locale disponible autour d'Aix-en-Provence, 7j/7 de 11h a 01h, selon zone ouverte.",
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
          "Les donnees sont traitees par des prestataires techniques necessaires au fonctionnement du site et au suivi des commandes.",
          "Les donnees de reglement manuel sont utilisees uniquement pour le suivi de commande et la confirmation administrative.",
        ],
      },
      {
        heading: "Droits utilisateur",
        items: [
          contactEmail
            ? `Toute demande relative aux donnees personnelles peut etre transmise a ${contactEmail}.`
            : "Toute demande relative aux donnees personnelles peut etre transmise via le formulaire de contact du site.",
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
        contactEmail
          ? `Les demandes client sont traitees via ${contactEmail} ou le formulaire de contact du site.`
          : "Les demandes client sont traitees via le formulaire de contact du site.",
      ],
    },
    ...common,
  ];
}
