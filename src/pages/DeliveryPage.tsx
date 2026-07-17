import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Seo } from "../components/Seo";
import {
  LOCAL_DELIVERY_MINIMUM,
  POSTAL_DELIVERY_MINIMUM,
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
  "Choisissez vos produits dans la boutique.",
  "Sélectionnez une zone locale ouverte au moment de la commande.",
  "Validez votre demande : Verdanza confirme la disponibilité, le règlement et le créneau.",
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
  if (mode === "local") return <LocalDeliveryPage />;
  return <PostalDeliveryPage />;
}

function PostalDeliveryPage() {
  return (
    <main className="container-page py-12">
      <Seo
        title="Livraison postale CBD en France | Verdanza"
        description="Livraison postale Verdanza disponible en France, avec minimum de commande et frais confirmés avant expédition."
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
          Livraison postale disponible en France à partir de {POSTAL_DELIVERY_MINIMUM} EUR
          d'achat. Elle est offerte à partir de {POSTAL_FREE_SHIPPING_THRESHOLD} EUR. En
          dessous de {POSTAL_FREE_SHIPPING_THRESHOLD} EUR, les frais postaux sont confirmés
          avec vous après validation de la commande.
        </p>
      </div>
      <section className="mt-8 rounded-lg border border-forest/10 bg-cream p-6 sm:p-8">
        <h2 className="font-display text-3xl text-forest">Expédition suivie</h2>
        <p className="mt-4 max-w-3xl leading-7 text-ink/70">
          Après confirmation de la commande, Verdanza vous indique les modalités
          d'expédition et le suivi selon le mode choisi.
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
  const deliveryHours = referenceZone?.estimatedDelay || "Selon les disponibilités du jour";

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
          disponibilités. Si votre zone est ouverte, vous pourrez la sélectionner au moment
          de la commande.
        </p>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <SummaryCard label="Minimum local" value={formatCurrency(minimum)} />
        <SummaryCard label="Horaires" value={deliveryHours} />
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

      <section className="mt-12">
        <div className="section-heading mb-5">
          <div>
            <h2>Zones actuellement ouvertes</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/65">
              Ces zones proviennent de la configuration de livraison. Elles peuvent évoluer
              selon les créneaux et l'organisation du jour.
            </p>
          </div>
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
          <dt className="font-semibold text-forest">Horaires / délai</dt>
          <dd>{zone.estimatedDelay || "Selon disponibilité"}</dd>
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
