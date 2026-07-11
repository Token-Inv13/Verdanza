import { Link } from "react-router-dom";
import { localDeliveryZones } from "../data/deliveryZones";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Seo } from "../components/Seo";
import {
  LOCAL_DELIVERY_MINIMUM,
  POSTAL_DELIVERY_MINIMUM,
  POSTAL_FREE_SHIPPING_THRESHOLD,
} from "../config/deliveryRules";

const localDeliveryLinks = [
  { to: "/fleurs-cbd", label: "Voir les fleurs CBD" },
  { to: "/resines-cbd", label: "Decouvrir les resines CBD" },
  { to: "/boutique", label: "Parcourir la boutique" },
  { to: "/livraison-postale", label: "Verifier la livraison postale" },
  { to: "/qualite-conformite", label: "Consulter les engagements qualite" },
  { to: "/faq", label: "Lire la FAQ" },
  { to: "/contact", label: "Contacter Verdanza" },
];

const deliverySteps = [
  "Choisir les produits disponibles dans la boutique.",
  "Verifier le panier, les quantites et le statut des references en arrivage.",
  "Renseigner les informations de livraison dans une zone couverte.",
  "Faire confirmer la commande selon le processus Verdanza avant la livraison.",
];

export function DeliveryPage({ mode }: { mode: "local" | "postal" }) {
  const isLocal = mode === "local";
  const path = isLocal ? "/livraison-express-aix" : "/livraison-postale";
  const title = isLocal ? "Livraison express Aix" : "Livraison postale";

  if (isLocal) {
    return <LocalDeliveryPage path={path} title={title} />;
  }

  return (
    <main className="container-page py-12">
      <Seo
        title="Livraison postale CBD en France | Verdanza"
        description="Livraison postale Verdanza disponible en France, avec minimum de commande et frais confirmes avant expedition."
        path={path}
      />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: title, path, current: true },
        ]}
      />
      <div className="page-intro">
        <h1>Livraison postale</h1>
        <p>
          Livraison postale disponible en France a partir de {POSTAL_DELIVERY_MINIMUM} EUR
          d'achat. Livraison postale offerte a partir de {POSTAL_FREE_SHIPPING_THRESHOLD} EUR.
        </p>
      </div>
      <section className="mt-10 rounded-lg border border-forest/10 bg-cream p-8">
        <h2 className="font-display text-3xl text-forest">Expedition suivie</h2>
        <p className="mt-4 max-w-3xl leading-7 text-ink/70">
          En dessous de {POSTAL_FREE_SHIPPING_THRESHOLD} EUR, les frais postaux sont
          confirmes avec vous apres validation de la commande.
        </p>
      </section>
    </main>
  );
}

function LocalDeliveryPage({ path, title }: { path: string; title: string }) {
  const firstZone = localDeliveryZones[0];
  const deliveryHours = firstZone?.estimatedDelay || "Selon les disponibilites du creneau";
  const zoneNames = localDeliveryZones.map((zone) => zone.name).join(", ");

  return (
    <main className="container-page py-12">
      <Seo
        title="Livraison CBD a Aix-en-Provence et alentours | Verdanza"
        description={`Livraison locale Verdanza a Aix-en-Provence et zones configurees, minimum ${LOCAL_DELIVERY_MINIMUM} EUR, horaires ${deliveryHours}, selon disponibilite des creneaux.`}
        path={path}
      />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: title, path, current: true },
        ]}
      />
      <div className="page-intro">
        <h1>Livraison de CBD a Aix-en-Provence et alentours</h1>
        <p>
          Verdanza propose une livraison locale dans les zones configurees autour
          d'Aix-en-Provence. Le minimum de commande est de {LOCAL_DELIVERY_MINIMUM} EUR,
          les horaires proviennent des regles de livraison, et chaque creneau depend des
          disponibilites avant validation.
        </p>
      </div>

      <section className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <article className="feature-panel">
          <h2>Minimum</h2>
          <p>{LOCAL_DELIVERY_MINIMUM} EUR d'achat minimum pour une livraison locale.</p>
        </article>
        <article className="feature-panel">
          <h2>Horaires</h2>
          <p>{deliveryHours}.</p>
        </article>
        <article className="feature-panel">
          <h2>Validation</h2>
          <p>La commande doit etre confirmee avant preparation et livraison.</p>
        </article>
        <article className="feature-panel">
          <h2>Adultes</h2>
          <p>Les produits CBD de la boutique sont reserves aux personnes majeures.</p>
        </article>
      </section>

      <section className="mt-12">
        <div className="section-heading mb-5">
          <div>
            <h2>Zones desservies autour d'Aix-en-Provence</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/65">
              Les zones ci-dessous viennent de la configuration de livraison locale. Elles
              indiquent les frais, minimums et delais estimes sans garantir un creneau a chaque
              instant.
            </p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {localDeliveryZones.map((zone) => (
            <article key={zone.id} className="feature-panel">
              <h3 className="font-display text-2xl leading-tight text-forest">{zone.name}</h3>
              <dl className="mt-4 space-y-2 text-sm leading-6 text-ink/70">
                <div>
                  <dt className="font-semibold text-forest">Minimum</dt>
                  <dd>{formatCurrency(zone.minimumOrderAmount || zone.minimumOrder)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-forest">Frais</dt>
                  <dd>{formatCurrency(zone.fee)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-forest">Delai estime</dt>
                  <dd>{zone.estimatedDelay}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-12 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <article className="rounded-lg border border-forest/10 bg-cream p-6 sm:p-8">
          <h2 className="font-display text-3xl text-forest">Comment commander</h2>
          <ol className="mt-5 space-y-3 text-sm leading-6 text-ink/70">
            {deliverySteps.map((step, index) => (
              <li key={step}>
                <span className="font-semibold text-forest">{index + 1}.</span> {step}
              </li>
            ))}
          </ol>
        </article>
        <article className="rounded-lg border border-forest/10 bg-ivory p-6 sm:p-8">
          <h2 className="font-display text-3xl text-forest">Livraison locale ou postale</h2>
          <p className="mt-4 leading-7 text-ink/70">
            Si votre adresse n'entre pas dans une zone locale active, la livraison postale en
            France peut etre consultee separement avec ses propres conditions.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link className="btn-primary" to="/boutique">
              Choisir les produits
            </Link>
            <Link className="btn-secondary" to="/livraison-postale">
              Verifier la livraison postale
            </Link>
          </div>
        </article>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-3xl text-forest">Liens utiles</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {localDeliveryLinks.map((link) => (
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

      <section className="mt-12">
        <h2 className="font-display text-3xl text-forest">Questions frequentes</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {[
            {
              question: "Quelles zones sont desservies autour d'Aix-en-Provence ?",
              answer: `Les zones affichees sur cette page sont les zones locales configurees : ${zoneNames}.`,
            },
            {
              question: "Quel est le minimum de commande ?",
              answer: `Le minimum local configure est de ${LOCAL_DELIVERY_MINIMUM} EUR d'achat.`,
            },
            {
              question: "Quels sont les horaires de livraison ?",
              answer: deliveryHours,
            },
            {
              question: "La livraison est-elle toujours garantie ?",
              answer:
                "Non. La zone, le creneau, les disponibilites produits et la validation de commande doivent etre confirmes avant livraison.",
            },
            {
              question: "Que faire lorsque mon adresse n'est pas dans la zone locale ?",
              answer:
                "Vous pouvez consulter la livraison postale en France ou contacter Verdanza avant de valider votre commande.",
            },
          ].map((item) => (
            <article key={item.question} className="rounded-lg border border-forest/10 bg-ivory p-5">
              <h3 className="font-display text-2xl leading-tight text-forest">
                {item.question}
              </h3>
              <p className="mt-3 text-sm leading-6 text-ink/70">{item.answer}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function formatCurrency(value: number) {
  if (value === 0) return "0 EUR";
  return `${value.toFixed(2).replace(".", ",")} EUR`;
}
