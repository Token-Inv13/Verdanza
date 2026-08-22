import { useEffect, useState } from "react";
import { CheckCircle2, Gift, Hourglass, ShoppingBag } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Seo } from "../components/Seo";
import { getContestPrize } from "../services/contestsService";
import type { ContestPrize } from "../types/contests";

type PrizeView = Awaited<ReturnType<typeof getContestPrize>>;

export function ContestPrizePage() {
  const { token = "" } = useParams();
  const [data, setData] = useState<PrizeView | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getContestPrize(token)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Gain indisponible.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="container-page py-12 sm:py-16">
      <Seo
        title="Mon gain concours - Verdanza"
        description="Consultation sécurisée d'un gain Verdanza."
        path={`/concours/gain/${token}`}
        noindex
      />
      <div className="mx-auto max-w-2xl rounded-lg border border-champagne/30 bg-ivory p-6 shadow-soft sm:p-10">
        {isLoading && <PrizeState icon={Hourglass} title="Vérification de votre gain..." />}
        {error && <PrizeState icon={Gift} title="Gain indisponible" description={error} />}
        {data && (
          <>
            <CheckCircle2 className="text-forest" size={42} aria-hidden="true" />
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-champagne">
              {data.contest.title}
            </p>
            <h1 className="mt-3 font-display text-5xl leading-tight text-forest">
              Félicitations {data.prize.winnerDisplayName}
            </h1>
            <p className="mt-4 text-base leading-7 text-ink/70">
              Votre gain est un bon Verdanza de <strong>{formatEuro(data.prize.value)}</strong>.
            </p>
            <div className="mt-7 rounded-lg border border-forest/10 bg-cream p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-forest/60">Code personnel</p>
              <p className="mt-2 break-all font-mono text-xl font-semibold tracking-wide text-forest">
                {data.prize.code}
              </p>
              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-ink/50">État</dt>
                  <dd className="font-semibold text-forest">{prizeStatusLabel(data.prize.status)}</dd>
                </div>
                <div>
                  <dt className="text-ink/50">Date limite</dt>
                  <dd className="font-semibold text-forest">{formatDate(data.prize.expiresAt)}</dd>
                </div>
              </dl>
            </div>
            {data.prize.status !== "expired" && data.prize.status !== "cancelled" && (
              <Link className="btn-primary mt-7 w-full sm:w-auto" to="/boutique">
                <ShoppingBag size={18} aria-hidden="true" /> Utiliser mon bon
              </Link>
            )}
            <p className="mt-5 text-xs leading-5 text-ink/50">
              Utilisez ce code avec la même adresse e-mail que celle de votre participation. Le bon
              est personnel et utilisable une seule fois.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function PrizeState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Gift;
  title: string;
  description?: string;
}) {
  return (
    <div className="py-8 text-center" role="status">
      <Icon className="mx-auto text-champagne" size={40} aria-hidden="true" />
      <h1 className="mt-4 font-display text-4xl text-forest">{title}</h1>
      {description && <p className="mt-3 text-sm text-ink/65">{description}</p>}
    </div>
  );
}

function prizeStatusLabel(status: ContestPrize["status"]) {
  const labels: Record<ContestPrize["status"], string> = {
    pending: "En préparation",
    issued: "Émis",
    claimed: "Réclamé",
    redeemed: "Utilisé",
    expired: "Expiré",
    cancelled: "Annulé",
  };
  return labels[status];
}

function formatEuro(value: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date(value));
}
