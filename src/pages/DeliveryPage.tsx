import { Link } from "react-router-dom";
import { localDeliveryZones } from "../data/deliveryZones";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Seo } from "../components/Seo";
import { trackCtaClick } from "../lib/analytics";
import {
  LOCAL_DELIVERY_MINIMUM,
  POSTAL_DELIVERY_MINIMUM,
  POSTAL_FREE_SHIPPING_THRESHOLD,
} from "../config/deliveryRules";

const localDeliveryLinks = [
  { to: "/fleurs-cbd", label: "Voir les fleurs CBD" },
  { to: "/resines-cbd", label: "Découvrir les résines CBD" },
  { to: "/boutique", label: "Parcourir la boutique" },
  { to: "/livraison-postale", label: "Vérifier la livraison postale" },
  { to: "/qualite-conformite", label: "Consulter les engagements qualité" },
  { to: "/faq", label: "Lire la FAQ" },
  { to: "/contact", label: "Contacter Verdanza" },
];

const deliverySteps = [
  "Choisir les produits disponibles dans la boutique.",
  "Vérifier le panier, les quantités et le statut des références en arrivage.",
  "Renseigner les informations de livraison dans une zone couverte.",
  "Faire confirmer la commande selon le processus Verdanza avant la livraison.",
];

function ctaCategoryForPath(path: string) {
  if (path.startsWith("/livraison")) return "delivery";
  if (path === "/boutique") return "shop_navigation";
  if (path === "/fleurs-cbd" || path === "/resines-cbd") return "category_navigation";
  if (path === "/qualite-conformite") return "quality";
  if (path === "/faq") return "support";
  if (path === "/contact") return "contact";
  return "navigation";
}

function ctaIdForPath(prefix: string, path: string) {
  return `${prefix}_${path.replace(/^\/+/, "").replace(/[^a-z0-9]+/gi, "_") || "home"}`;
}

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
        description="Livraison postale Verdanza disponible en France, avec minimum de commande et frais confirmés avant expédition."
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
          Livraison postale disponible en France à partir de {POSTAL_DELIVERY_MINIMUM} EUR
          d'achat. Livraison postale offerte à partir de {POSTAL_FREE_SHIPPING_THRESHOLD} EUR.
        </p>
      </div>
      <section className="mt-10 rounded-lg border border-forest/10 bg-cream p-8">
        <h2 className="font-display text-3xl text-forest">Expédition suivie</h2>
        <p className="mt-4 max-w-3xl leading-7 text-ink/70">
          En dessous de {POSTAL_FREE_SHIPPING_THRESHOLD} EUR, les frais postaux sont
          confirmés avec vous après validation de la commande.
        </p>
      </section>
    </main>
  );
}

function LocalDeliveryPage({ path, title }: { path: string; title: string }) {
  const firstZone = localDeliveryZones[0];
  const deliveryHours = firstZone?.estimatedDelay || "Selon les disponibilités du créneau";
  const zoneNames = localDeliveryZones.map((zone) => zone.name).join(", ");

  return (
    <main className="container-page py-12">
      <Seo
        title="Livraison CBD à Aix-en-Provence et alentours | Verdanza"
        description={`Livraison locale Verdanza à Aix-en-Provence et zones configurées, minimum ${LOCAL_DELIVERY_MINIMUM} EUR, horaires ${deliveryHours}, selon disponibilité des créneaux.`}
        path={path}
      />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: title, path, current: true },
        ]}
      />
      <div className="page-intro">
        <h1>Livraison de CBD à Aix-en-Provence et alentours</h1>
        <p>
          Verdanza propose une livraison locale dans les zones configurées autour
          d'Aix-en-Provence. Le minimum de commande est de {LOCAL_DELIVERY_MINIMUM} EUR,
          les horaires proviennent des règles de livraison, et chaque créneau dépend des
          disponibilités avant validation.
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
          <p>La commande doit être confirmée avant préparation et livraison.</p>
        </article>
        <article className="feature-panel">
          <h2>Adultes</h2>
          <p>Les produits CBD de la boutique sont réservés aux personnes majeures.</p>
        </article>
      </section>

      <section className="mt-12">
        <div className="section-heading mb-5">
          <div>
            <h2>Zones desservies autour d'Aix-en-Provence</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/65">
              Les zones ci-dessous viennent de la configuration de livraison locale. Elles
              indiquent les frais, minimums et délais estimés sans garantir un créneau à chaque
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
                  <dt className="font-semibold text-forest">Délai estimé</dt>
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
            France peut être consultée séparément avec ses propres conditions.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              className="btn-primary"
              to="/boutique"
              onClick={() =>
                trackCtaClick({
                  ctaId: "local_delivery_choose_products",
                  ctaLocation: "delivery_page",
                  destinationPath: "/boutique",
                  ctaCategory: "shop_navigation",
                })
              }
            >
              Choisir les produits
            </Link>
            <Link
              className="btn-secondary"
              to="/livraison-postale"
              onClick={() =>
                trackCtaClick({
                  ctaId: "local_delivery_postal_delivery",
                  ctaLocation: "delivery_page",
                  destinationPath: "/livraison-postale",
                  ctaCategory: "delivery",
                })
              }
            >
              Vérifier la livraison postale
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
              onClick={() =>
                trackCtaClick({
                  ctaId: ctaIdForPath("delivery_link", link.to),
                  ctaLocation: "delivery_useful_links",
                  destinationPath: link.to,
                  ctaCategory: ctaCategoryForPath(link.to),
                })
              }
            >
              {link.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-3xl text-forest">Questions fréquentes</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {[
            {
              question: "Quelles zones sont desservies autour d'Aix-en-Provence ?",
              answer: `Les zones affichées sur cette page sont les zones locales configurées : ${zoneNames}.`,
            },
            {
              question: "Quel est le minimum de commande ?",
              answer: `Le minimum local configuré est de ${LOCAL_DELIVERY_MINIMUM} EUR d'achat.`,
            },
            {
              question: "Quels sont les horaires de livraison ?",
              answer: deliveryHours,
            },
            {
              question: "La livraison est-elle toujours garantie ?",
              answer:
                "Non. La zone, le créneau, les disponibilités produits et la validation de commande doivent être confirmés avant livraison.",
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
