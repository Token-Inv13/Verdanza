import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { ContactActions } from "../components/ContactActions";
import { Seo } from "../components/Seo";
import {
  LOCAL_DELIVERY_MINIMUM,
  POSTAL_DELIVERY_MINIMUM,
  POSTAL_FREE_SHIPPING_THRESHOLD,
} from "../config/deliveryRules";
import { trackCtaClick } from "../lib/analytics";
import { getDeliveryZonesWithFallback } from "../services/deliveryZonesService";
import { formatLocalDeliveryEstimate } from "../lib/deliveryEstimate";
import type { DeliveryZone } from "../types";

type DeliveryZonesState =
  | { status: "loading"; zones: DeliveryZone[] }
  | { status: "ready"; zones: DeliveryZone[] }
  | { status: "error"; zones: DeliveryZone[] };

const deliverySteps = [
  "Ajoutez vos produits au panier.",
  "Vérifiez votre adresse, puis sélectionnez votre adresse. Verdanza vérifie automatiquement votre éligibilité à la livraison locale.",
  "Si la livraison locale est disponible, elle est offerte et généralement effectuée en environ 1 h après confirmation.",
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
          title="Livraison express à Aix-en-Provence"
          items={[
            "Livraison offerte",
            "Environ 1 h",
            "De 11 h à 1 h du matin",
            "Jusqu’à 15 km autour du centre d’Aix-en-Provence",
            "Minimum de commande : 20 €",
          ]}
          ctaLabel="Vérifier mon adresse"
          ctaPath="/panier"
          ctaId="delivery_overview_local"
        />
        <DeliveryModeCard
          title="Livraison postale en France"
          items={[
            `Disponible en France à partir de ${formatCurrency(POSTAL_DELIVERY_MINIMUM)} d'achat.`,
            `Livraison offerte à partir de ${formatCurrency(POSTAL_FREE_SHIPPING_THRESHOLD)}.`,
            "Frais et suivi confirmés après validation de la commande.",
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
        description="Consultez les conditions de livraison postale Verdanza en France : minimum de commande, livraison offerte et confirmation après validation."
        path="/livraison-postale"
      />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: "Livraison postale", path: "/livraison-postale", current: true },
        ]}
      />
      <div className="page-intro">
        <h1>Livraison postale</h1>
        <p>
          Verdanza propose une livraison postale en France, avec confirmation des
          modalités après validation de la commande.
        </p>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <SummaryCard label="Minimum postal" value={formatCurrency(POSTAL_DELIVERY_MINIMUM)} />
        <SummaryCard
          label="Livraison offerte"
          value={`À partir de ${formatCurrency(POSTAL_FREE_SHIPPING_THRESHOLD)} d'achat`}
        />
        <SummaryCard label="Suivi" value="Selon le mode choisi" />
      </section>

      <section className="mt-10 rounded-lg border border-forest/10 bg-cream p-6 sm:p-8">
        <h2 className="font-display text-3xl text-forest">Fonctionnement</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {[
            "Ajoutez vos produits au panier.",
            "Sélectionnez la livraison postale au moment de la commande.",
            "Après validation, Verdanza confirme les modalités d'expédition et le règlement.",
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

      <section className="mt-10 rounded-lg border border-champagne/30 bg-cream p-6 sm:p-8">
        <h2 className="font-display text-3xl text-forest">Alternative locale</h2>
        <p className="mt-4 max-w-3xl leading-7 text-ink/70">
          Si vous êtes autour d'Aix-en-Provence, la livraison locale peut être
          disponible selon les zones ouvertes.
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

  const { openZones, closedZones } = useMemo(() => {
    const localZones = state.zones
      .filter((zone) => zone.method === "local_express" && zone.isActive && !zone.isArchived)
      .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));

    return {
      openZones: localZones.filter((zone) => isOpenZone(zone)),
      closedZones: localZones.filter((zone) => !isOpenZone(zone)),
    };
  }, [state.zones]);

  const referenceZone = openZones[0] || closedZones[0];
  const minimum = openZones.length
    ? Math.min(
        ...openZones.map((zone) =>
          Number(zone.minimumOrderAmount ?? zone.minimumOrder ?? LOCAL_DELIVERY_MINIMUM),
        ),
      )
    : LOCAL_DELIVERY_MINIMUM;
  const deliveryEstimate = formatLocalDeliveryEstimate(referenceZone);

  useEffect(() => {
    if (window.location.hash !== "#zones-ouvertes") return undefined;
    const timeout = window.setTimeout(() => {
      document.getElementById("zones-ouvertes")?.scrollIntoView({ block: "start" });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [state.status, openZones.length]);

  return (
    <main className="container-page py-12">
      <Seo
        title="Livraison locale CBD à Aix-en-Provence - Verdanza"
        description="Consultez les zones ouvertes, horaires et conditions de livraison locale Verdanza autour d'Aix-en-Provence."
        path="/livraison-locale"
      />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: "Livraison locale Aix-en-Provence", path: "/livraison-locale", current: true },
        ]}
      />

      <div className="page-intro">
        <h1>Livraison locale Aix-en-Provence</h1>
        <p>
          Les zones de livraison locale sont mises à jour par Verdanza selon les
          disponibilités. Si votre adresse est éligible, la livraison locale peut être
          confirmée automatiquement au moment de la commande.
        </p>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <SummaryCard label="Minimum local" value={formatCurrency(minimum)} />
        <SummaryCard label="Délai estimatif" value={deliveryEstimate} />
        <SummaryCard label="Zones ouvertes" value={`${openZones.length}`} />
      </section>

      <section className="mt-10 rounded-lg border border-forest/10 bg-cream p-6 sm:p-8">
        <h2 className="font-display text-3xl text-forest">Fonctionnement</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {deliverySteps.map((step, index) => (
            <article key={step} className="rounded-md border border-forest/10 bg-ivory p-4">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-champagne">
                Etape {index + 1}
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

      <section id="zones-ouvertes" className="mt-12 scroll-mt-24">
        <div className="section-heading mb-5">
          <div>
            <h2>Zones actuellement ouvertes</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/65">
              Les zones ci-dessous sont ouvertes à la livraison locale. Elles peuvent évoluer
              selon les disponibilités du jour. {deliveryEstimate}
            </p>
          </div>
        </div>

        <div className="mb-6 rounded-lg border border-champagne/30 bg-cream p-5">
          <h3 className="font-display text-2xl leading-tight text-forest">
            Vous avez un doute sur votre zone de livraison ?
          </h3>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-ink/70">
            Contactez-nous pour vérifier si la livraison express est disponible
            à votre adresse.
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

        {state.status === "ready" && openZones.length === 0 && (
          <div className="rounded-lg border border-forest/10 bg-ivory p-6 text-sm text-ink/65">
            La livraison locale n'est pas ouverte actuellement. Vous pouvez utiliser la
            livraison postale ou revenir plus tard.
          </div>
        )}

        {openZones.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {openZones.map((zone) => (
              <DeliveryZoneCard key={zone.id} zone={zone} statusLabel="Ouverte" />
            ))}
          </div>
        )}
      </section>

      {closedZones.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-3xl text-forest">
            Zones temporairement indisponibles
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {closedZones.map((zone) => (
              <DeliveryZoneCard key={zone.id} zone={zone} statusLabel="Fermée" subdued />
            ))}
          </div>
        </section>
      )}

      <section className="mt-12 rounded-lg border border-champagne/30 bg-cream p-6 sm:p-8">
        <h2 className="font-display text-3xl text-forest">Livraison postale en alternative</h2>
        <p className="mt-4 max-w-3xl leading-7 text-ink/70">
          La livraison postale est disponible en France à partir de {POSTAL_DELIVERY_MINIMUM} EUR
          d'achat et offerte à partir de {POSTAL_FREE_SHIPPING_THRESHOLD} EUR.
        </p>
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

function DeliveryZoneCard({
  zone,
  statusLabel,
  subdued = false,
}: {
  zone: DeliveryZone;
  statusLabel: "Ouverte" | "Fermée";
  subdued?: boolean;
}) {
  return (
    <article className={`feature-panel ${subdued ? "opacity-75" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-2xl leading-tight text-forest">{zone.name}</h3>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
            statusLabel === "Ouverte"
              ? "border-forest/15 bg-forest/5 text-forest"
              : "border-champagne/40 bg-cream text-ink/65"
          }`}
        >
          {statusLabel}
        </span>
      </div>
      <dl className="mt-4 space-y-2 text-sm leading-6 text-ink/70">
        <div>
          <dt className="font-semibold text-forest">Minimum</dt>
          <dd>{formatCurrency(Number(zone.minimumOrderAmount ?? zone.minimumOrder ?? 0))}</dd>
        </div>
        <div>
          <dt className="font-semibold text-forest">Frais</dt>
          <dd>{formatCurrency(Number(zone.fee || 0))}</dd>
        </div>
        <div>
          <dt className="font-semibold text-forest">Délai estimatif</dt>
          <dd>{formatLocalDeliveryEstimate(zone)}</dd>
        </div>
      </dl>
      {zone.customerMessage && (
        <p className="mt-4 rounded-md bg-cream px-4 py-3 text-sm leading-6 text-ink/65">
          {zone.customerMessage}
        </p>
      )}
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
