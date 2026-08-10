import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { ContactActions } from "../components/ContactActions";
import { Seo } from "../components/Seo";
import {
  effectiveLocalDeliveryMinimum,
  LOCAL_DELIVERY_MINIMUM,
  POSTAL_DELIVERY_ESTIMATE,
  POSTAL_DELIVERY_FEE,
  POSTAL_DELIVERY_MINIMUM,
  POSTAL_DELIVERY_NAME,
  POSTAL_DELIVERY_PREPARATION,
  POSTAL_DELIVERY_SIGNATURE,
  POSTAL_FREE_SHIPPING_THRESHOLD,
} from "../config/deliveryRules";
import { trackCtaClick } from "../lib/analytics";
import { getDeliveryZonesWithFallback } from "../services/deliveryZonesService";
import type { DeliveryZone } from "../types";

type DeliveryZonesState =
  | { status: "loading"; zones: DeliveryZone[] }
  | { status: "ready"; zones: DeliveryZone[] }
  | { status: "error"; zones: DeliveryZone[] };

const deliverySteps = [
  "Ajoutez vos produits au panier.",
  "Saisissez puis sélectionnez votre adresse afin qu’elle soit reconnue comme une adresse vérifiée.",
  "Verdanza calcule automatiquement si cette adresse se trouve dans le rayon de livraison locale.",
  "Si la livraison locale est disponible, elle est offerte et généralement réalisée en environ 1 h après confirmation.",
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

export function DeliveryPage({ mode }: { mode: "overview" | "local" | "postal" }) {
  if (mode === "overview") return <DeliveryOverviewPage />;
  if (mode === "local") return <LocalDeliveryPage />;
  return <PostalDeliveryPage />;
}

function DeliveryOverviewPage() {
  return (
    <main className="container-page py-12">
      <Seo
        title="Livraison CBD en France et Aix-en-Provence - Verdanza"
        description="Découvrez les modes de livraison Verdanza : livraison locale autour d'Aix-en-Provence et livraison postale en France."
        path="/livraison"
      />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: "Livraison", path: "/livraison", current: true },
        ]}
      />

      <div className="page-intro">
        <h1>Livraison Verdanza</h1>
        <p>
          Verdanza propose deux modes de livraison selon votre situation : livraison
          locale autour d'Aix-en-Provence ou livraison postale en France.
        </p>
      </div>

      <section className="mt-10 grid gap-5 lg:grid-cols-2">
        <DeliveryModeCard
          title="Livraison CBD à Aix-en-Provence"
          items={[
            "Livraison offerte",
            "Environ 1 h",
            "De 11 h à 1 h du matin",
            "Jusqu’à 15 km autour du centre d’Aix-en-Provence",
            "Minimum de commande : 20 €",
          ]}
          ctaLabel="Voir la livraison locale"
          ctaPath="/livraison-locale#zone-livraison"
          ctaId="delivery_overview_local"
        />
        <DeliveryModeCard
          title={`${POSTAL_DELIVERY_NAME} à domicile`}
          items={[
            `France métropolitaine, minimum ${formatCurrency(POSTAL_DELIVERY_MINIMUM)}.`,
            `${formatCurrency(POSTAL_DELIVERY_FEE)}, offerte dès ${formatCurrency(POSTAL_FREE_SHIPPING_THRESHOLD)} de sous-total éligible.`,
            POSTAL_DELIVERY_ESTIMATE,
            POSTAL_DELIVERY_SIGNATURE,
          ]}
          ctaLabel="Voir la livraison postale"
          ctaPath="/livraison-postale"
          ctaId="delivery_overview_postal"
        />
      </section>
    </main>
  );
}

function PostalDeliveryPage() {
  return (
    <main className="container-page py-12">
      <Seo
        title="Livraison postale CBD en France - Verdanza"
        description="Livraison Colissimo à domicile en France métropolitaine : frais fixes, suivi inclus, délai estimé et franco connus avant validation."
        path="/livraison-postale"
      />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: "Livraison postale", path: "/livraison-postale", current: true },
        ]}
      />
      <div className="page-intro">
        <h1>{POSTAL_DELIVERY_NAME} à domicile</h1>
        <p>
          Livraison en France métropolitaine avec suivi inclus. Les frais et le total
          exact de la commande sont affichés avant validation.
        </p>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Minimum postal" value={formatCurrency(POSTAL_DELIVERY_MINIMUM)} />
        <SummaryCard label="Frais Colissimo" value={formatCurrency(POSTAL_DELIVERY_FEE)} />
        <SummaryCard
          label="Livraison offerte"
          value={`Dès ${formatCurrency(POSTAL_FREE_SHIPPING_THRESHOLD)} de sous-total éligible`}
        />
        <SummaryCard label="Délai estimé" value="2 à 3 jours ouvrés" />
      </section>

      <section className="mt-10 rounded-lg border border-forest/10 bg-cream p-6 sm:p-8">
        <h2 className="font-display text-3xl text-forest">Fonctionnement</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            "Ajoutez vos produits au panier.",
            `Sélectionnez ${POSTAL_DELIVERY_NAME} : ${formatCurrency(POSTAL_DELIVERY_FEE)}, ou offerte dès ${formatCurrency(POSTAL_FREE_SHIPPING_THRESHOLD)} de sous-total éligible.`,
            "Vérifiez les frais et le total exact calculés par le serveur avant de valider.",
            "Recevez le suivi Colissimo après la prise en charge du colis.",
          ].map((step, index) => (
            <article key={step} className="rounded-md border border-forest/10 bg-ivory p-4">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-champagne">
                Étape {index + 1}
              </span>
              <p className="mt-2 text-sm leading-6 text-ink/70">{step}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-10 rounded-lg border border-forest/10 bg-ivory p-6 sm:p-8">
        <h2 className="font-display text-3xl text-forest">Délais et modalités</h2>
        <div className="mt-4 grid gap-3 text-sm leading-6 text-ink/70">
          <p>{POSTAL_DELIVERY_PREPARATION}</p>
          <p>{POSTAL_DELIVERY_ESTIMATE}</p>
          <p>Acheminement : environ 2 jours ouvrables après prise en charge.</p>
          <p>{POSTAL_DELIVERY_SIGNATURE}</p>
        </div>
      </section>

      <section className="mt-10 rounded-lg border border-champagne/30 bg-cream p-6 sm:p-8">
        <h2 className="font-display text-3xl text-forest">Alternative locale</h2>
        <p className="mt-4 max-w-3xl leading-7 text-ink/70">
          Si vous êtes autour d'Aix-en-Provence, la livraison locale peut être disponible selon
          votre zone d'adresse.
        </p>
        <Link
          className="btn-secondary mt-6 inline-flex"
          to="/livraison-locale"
          onClick={() =>
            trackCtaClick({
              ctaId: "postal_delivery_local_delivery",
              ctaLocation: "postal_delivery_page",
              destinationPath: "/livraison-locale",
              ctaCategory: "delivery",
            })
          }
        >
          Voir la livraison locale
        </Link>
      </section>
    </main>
  );
}

function LocalDeliveryPage() {
  const [state, setState] = useState<DeliveryZonesState>({
    status: "loading",
    zones: [],
  });

  useEffect(() => {
    let mounted = true;

    getDeliveryZonesWithFallback()
      .then(({ zones }) => {
        if (!mounted) return;
        setState({ status: "ready", zones });
      })
      .catch(() => {
        if (!mounted) return;
        setState({ status: "error", zones: [] });
      });

    return () => {
      mounted = false;
    };
  }, []);

  const localZones = useMemo(() => {
    const localZones = state.zones
      .filter((zone) => zone.method === "local_express" && zone.isActive && !zone.isArchived)
      .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));

    return localZones;
  }, [state.zones]);

  const referenceZone = localZones.find((zone) => isOpenZone(zone)) || localZones[0];
  const minimum = effectiveLocalDeliveryMinimum(
    referenceZone?.minimumOrderAmount ?? referenceZone?.minimumOrder ?? LOCAL_DELIVERY_MINIMUM,
  );
  const localZoneStatus = referenceZone && isOpenZone(referenceZone) ? "Ouverte" : "Fermée";

  return (
    <main className="container-page py-12">
      <Seo
        title="Livraison CBD Aix-en-Provence et alentours | Verdanza"
        description="Livraison locale de CBD à Aix-en-Provence et alentours, offerte dans un rayon jusqu’à 15 km dès 20 € de commande, selon disponibilité."
        path="/livraison-locale"
      />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: "Livraison CBD Aix-en-Provence", path: "/livraison-locale", current: true },
        ]}
      />

      <div className="page-intro">
        <h1>Livraison CBD à Aix-en-Provence et alentours</h1>
        <p>
          Verdanza propose une livraison locale offerte autour d’Aix-en-Provence, dans un
          rayon allant jusqu’à 15 km du centre-ville. L’éligibilité dépend de l’adresse exacte
          et de la disponibilité au moment de la commande.
        </p>
      </div>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Zone locale" value="Jusqu’à 15 km" />
        <SummaryCard label="Minimum de commande" value={formatCurrency(minimum)} />
        <SummaryCard label="Frais de livraison" value="Offerte" />
        <SummaryCard label="Disponibilité" value="Selon créneaux" />
      </section>

      <section className="mt-10 rounded-lg border border-forest/10 bg-cream p-6 sm:p-8">
        <h2 className="font-display text-3xl text-forest">
          Comment fonctionne la livraison CBD à Aix ?
        </h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {deliverySteps.map((step, index) => (
            <article key={step} className="rounded-md border border-forest/10 bg-ivory p-4">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-champagne">
                Étape {index + 1}
              </span>
              <p className="mt-2 text-sm leading-6 text-ink/70">{step}</p>
            </article>
          ))}
        </div>
        <p className="mt-5 max-w-3xl text-sm leading-6 text-ink/65">
          Le règlement est confirmé après validation de la commande. Un lien de paiement
          peut être envoyé par email si nécessaire.
        </p>
      </section>

      <section id="zone-livraison" className="mt-12 scroll-mt-24">
        <h2 className="font-display text-3xl text-forest">
          Zone de livraison autour d’Aix-en-Provence
        </h2>
        <p className="mt-4 max-w-3xl leading-7 text-ink/70">
          La zone couvre les adresses situées jusqu’à 15 km du centre d’Aix-en-Provence.
          Elle est déterminée par la distance réelle de l’adresse sélectionnée, et non par
          le seul nom de la commune ou du quartier. Une adresse en limite de rayon doit donc
          être vérifiée dans le panier.
        </p>

        <div className="mt-6 rounded-lg border border-forest/10 bg-cream p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h3 className="font-display text-2xl leading-tight text-forest">
              Aix-en-Provence et alentours · rayon jusqu’à 15 km
            </h3>
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                localZoneStatus === "Ouverte"
                  ? "border-forest/15 bg-forest/5 text-forest"
                  : "border-champagne/40 bg-cream text-ink/65"
              }`}
            >
              {localZoneStatus}
            </span>
          </div>
          <p className="text-sm font-medium leading-6 text-forest">
            Livraison locale offerte · minimum {formatCurrency(minimum)}
          </p>
          <p className="mt-2 text-sm leading-6 text-ink/70">De 11 h à 1 h du matin</p>
          <p className="mt-2 text-sm leading-6 text-ink/70">
            Délai généralement d’environ 1 h après confirmation, selon disponibilité.
          </p>
          <ContactActions
            source="local_delivery_page"
            variant="compact"
            showContactLink={false}
            phoneLabel="Appeler Verdanza"
            className="mt-4"
          />
        </div>

        {state.status === "loading" && (
          <div className="rounded-lg border border-forest/10 bg-ivory p-6 text-sm text-ink/65">
            Chargement des zones de livraison locale...
          </div>
        )}

        {state.status === "error" && (
          <div className="rounded-lg border border-forest/10 bg-ivory p-6 text-sm text-ink/65">
            Les informations de livraison locale sont temporairement indisponibles. Vous
            pouvez consulter la livraison postale ou réessayer plus tard.
          </div>
        )}

        {state.status === "ready" && !referenceZone && (
          <div className="rounded-lg border border-forest/10 bg-ivory p-6 text-sm text-ink/65">
            La livraison locale n'est pas ouverte actuellement. Vous pouvez utiliser la
            livraison postale ou revenir plus tard.
          </div>
        )}
      </section>

      <section className="mt-12 rounded-lg border border-forest/10 bg-ivory p-6 sm:p-8">
        <h2 className="font-display text-3xl text-forest">Conditions et disponibilité</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <article className="rounded-md border border-forest/10 bg-cream p-5">
            <h3 className="font-display text-2xl text-forest">Avant la commande</h3>
            <p className="mt-3 text-sm leading-6 text-ink/70">
              Le sous-total éligible doit atteindre {formatCurrency(LOCAL_DELIVERY_MINIMUM)}.
              Saisissez une adresse complète puis sélectionnez-la dans les suggestions : cette
              étape permet la vérification automatique du rayon.
            </p>
          </article>
          <article className="rounded-md border border-forest/10 bg-cream p-5">
            <h3 className="font-display text-2xl text-forest">Au moment de la validation</h3>
            <p className="mt-3 text-sm leading-6 text-ink/70">
              L’ouverture de la zone et les créneaux disponibles sont contrôlés au moment de
              la commande. Une adresse éligible au rayon ne garantit pas qu’un créneau soit
              encore disponible.
            </p>
          </article>
        </div>
        <Link
          className="btn-primary mt-6 inline-flex"
          to="/boutique"
          onClick={() =>
            trackCtaClick({
              ctaId: "local_delivery_conditions_shop",
              ctaLocation: "local_delivery_conditions",
              destinationPath: "/boutique",
              ctaCategory: "shop_navigation",
            })
          }
        >
          Choisir mes produits
        </Link>
      </section>

      <section className="mt-12 rounded-lg border border-champagne/30 bg-cream p-6 sm:p-8">
        <h2 className="font-display text-3xl text-forest">
          Livraison locale ou livraison postale : quelle différence ?
        </h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <article className="rounded-md border border-forest/10 bg-ivory p-5">
            <h3 className="font-display text-2xl text-forest">Livraison locale</h3>
            <p className="mt-3 text-sm leading-6 text-ink/70">
              Réservée aux adresses éligibles dans le rayon jusqu’à 15 km, avec un minimum de
              {` ${formatCurrency(LOCAL_DELIVERY_MINIMUM)}`}. Elle est offerte et dépend des
              créneaux disponibles.
            </p>
          </article>
          <article className="rounded-md border border-forest/10 bg-ivory p-5">
            <h3 className="font-display text-2xl text-forest">Livraison postale</h3>
            <p className="mt-3 text-sm leading-6 text-ink/70">
              Disponible en France métropolitaine dès {formatCurrency(POSTAL_DELIVERY_MINIMUM)}
              de commande. Les frais sont de {formatCurrency(POSTAL_DELIVERY_FEE)} et la
              livraison est offerte dès {formatCurrency(POSTAL_FREE_SHIPPING_THRESHOLD)} de
              sous-total éligible.
            </p>
          </article>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            className="btn-primary"
            to="/boutique"
            onClick={() =>
              trackCtaClick({
                ctaId: "local_delivery_shop",
                ctaLocation: "local_delivery_page",
                destinationPath: "/boutique",
                ctaCategory: "shop_navigation",
              })
            }
          >
            Voir la boutique
          </Link>
          <Link
            className="btn-secondary"
            to="/livraison-postale"
            onClick={() =>
              trackCtaClick({
                ctaId: "local_delivery_postal",
                ctaLocation: "local_delivery_page",
                destinationPath: "/livraison-postale",
                ctaCategory: "delivery",
              })
            }
          >
            Voir la livraison postale
          </Link>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-3xl text-forest">
          Questions fréquentes sur la livraison CBD à Aix-en-Provence
        </h2>
        <div className="mt-5 grid gap-3">
          {[
            {
              question: "Comment savoir si mon adresse est éligible ?",
              answer:
                "Dans le panier, saisissez votre adresse complète puis sélectionnez la suggestion correspondante. La distance avec le centre d’Aix-en-Provence est alors vérifiée automatiquement.",
            },
            {
              question: "La livraison locale couvre-t-elle toute la commune d’Aix ?",
              answer:
                "L’éligibilité repose sur un rayon allant jusqu’à 15 km autour du centre d’Aix-en-Provence. Selon sa position exacte, une adresse peut donc être incluse ou non.",
            },
            {
              question: "La livraison locale est-elle gratuite ?",
              answer: `Oui. Elle est offerte pour toute commande locale éligible atteignant le minimum de ${formatCurrency(LOCAL_DELIVERY_MINIMUM)}.`,
            },
            {
              question: "Que faire si la livraison locale n’est pas disponible ?",
              answer: `Vous pouvez choisir la livraison postale en France métropolitaine dès ${formatCurrency(POSTAL_DELIVERY_MINIMUM)} de commande. Elle coûte ${formatCurrency(POSTAL_DELIVERY_FEE)} et devient offerte dès ${formatCurrency(POSTAL_FREE_SHIPPING_THRESHOLD)}.`,
            },
          ].map((item) => (
            <details key={item.question} className="rounded-lg border border-forest/10 bg-ivory p-5">
              <summary className="cursor-pointer font-semibold text-forest">
                {item.question}
              </summary>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-ink/70">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-3xl text-forest">Liens utiles</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { to: "/boutique", label: "Parcourir la boutique" },
            { to: "/livraison-postale", label: "Livraison postale" },
            { to: "/qualite-conformite", label: "Qualité & conformité" },
            { to: "/contact", label: "Contact" },
          ].map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="rounded-md border border-forest/10 bg-ivory px-4 py-3 text-sm font-semibold text-forest transition hover:border-champagne hover:bg-cream"
              onClick={() =>
                trackCtaClick({
                  ctaId: ctaIdForPath("local_delivery_link", link.to),
                  ctaLocation: "local_delivery_useful_links",
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
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="feature-panel">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-champagne">
        {label}
      </p>
      <p className="mt-3 font-display text-3xl leading-tight text-forest">{value}</p>
    </article>
  );
}

function DeliveryModeCard({
  title,
  items,
  ctaLabel,
  ctaPath,
  ctaId,
}: {
  title: string;
  items: string[];
  ctaLabel: string;
  ctaPath: string;
  ctaId: string;
}) {
  return (
    <article className="feature-panel flex h-full flex-col">
      <h2 className="font-display text-3xl leading-tight text-forest">{title}</h2>
      <ul className="mt-5 space-y-3 text-sm leading-6 text-ink/70">
        {items.map((item) => (
          <li key={item} className="flex gap-3">
            <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-champagne" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <div className="mt-6">
        <Link
          className="btn-primary inline-flex"
          to={ctaPath}
          onClick={() =>
            trackCtaClick({
              ctaId,
              ctaLocation: "delivery_overview_page",
              destinationPath: ctaPath,
              ctaCategory: "delivery",
            })
          }
        >
          {ctaLabel}
        </Link>
      </div>
    </article>
  );
}

function isOpenZone(zone: DeliveryZone) {
  return zone.isActive && zone.isOpen !== false && (zone.status || "open") === "open";
}

function formatCurrency(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 EUR";
  return `${value.toFixed(2).replace(".", ",")} EUR`;
}
