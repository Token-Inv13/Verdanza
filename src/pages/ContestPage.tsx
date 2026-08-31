import { FormEvent, useEffect, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, Gift, ShieldCheck } from "lucide-react";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Seo } from "../components/Seo";
import { publicSubmissionSecurityContext } from "../lib/publicSubmissionSecurity";
import { enterContest, getPublicContest } from "../services/contestsService";
import type { PublicContest } from "../types/contests";

export function ContestPage() {
  const formStartedAt = useRef(Date.now());
  const [contest, setContest] = useState<PublicContest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [company, setCompany] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [publicId, setPublicId] = useState("");
  const [, setClockTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getPublicContest()
      .then((nextContest) => {
        if (!cancelled) setContest(nextContest);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Concours indisponible.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setClockTick((value) => value + 1), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contest) return;
    setSubmitError("");
    setIsSubmitting(true);
    try {
      const result = await enterContest({
        contestId: contest.id,
        displayName,
        email,
        rulesAccepted,
        marketingConsent,
        company,
        submissionSecurity: publicSubmissionSecurityContext(formStartedAt.current),
      });
      setPublicId(result.publicId);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Participation impossible pour le moment.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main>
      <Seo
        title="Jeu-concours Verdanza"
        description="Participez gratuitement au jeu-concours Verdanza, sans obligation d'achat."
        path="/concours"
      />
      <section className="hero-section border-b border-forest/10">
        <div className="container-page py-12 sm:py-16 lg:py-20">
          <Breadcrumbs
            items={[
              { name: "Accueil", path: "/" },
              { name: "Jeu-concours", path: "/concours", current: true },
            ]}
          />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-champagne">
            Verdanza Weekly
          </p>
          <h1 className="mt-4 max-w-4xl font-display text-5xl leading-none text-forest sm:text-6xl lg:text-7xl">
            Un rendez-vous, une chance, un gagnant.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-ink/70 sm:text-lg">
            Participation gratuite, sans achat obligatoire. Une participation par personne et par
            concours.
          </p>
        </div>
      </section>

      <section className="container-page py-10 sm:py-14">
        {isLoading && <StatePanel title="Chargement du concours..." />}
        {loadError && <StatePanel title="Concours indisponible" description={loadError} tone="error" />}
        {!isLoading && !loadError && !contest && (
          <StatePanel
            title="Aucun concours ouvert pour le moment"
            description="Revenez bientôt pour le prochain rendez-vous Verdanza."
          />
        )}
        {contest && (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)] lg:items-start">
            <div className="grid gap-6">
              <article className="rounded-lg border border-forest/10 bg-ivory p-6 shadow-soft sm:p-8">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="tag">{contest.acceptingEntries ? "Ouvert" : "À venir"}</span>
                  <span className="text-sm text-ink/55">
                    {formatPeriod(contest.startAt, contest.endAt)}
                  </span>
                </div>
                <h2 className="mt-5 font-display text-4xl text-forest sm:text-5xl">
                  {contest.title}
                </h2>
                <p className="mt-4 whitespace-pre-line text-base leading-7 text-ink/70">
                  {contest.description}
                </p>
                <div className="mt-7 grid gap-4 sm:grid-cols-3">
                  <InfoCard icon={Gift} label="Lot" value={`${formatEuro(contest.prizeValue)} de bon Verdanza`} />
                  <InfoCard icon={CalendarDays} label="Tirage prévu" value={formatDateTime(contest.drawAt)} />
                  <InfoCard
                    icon={Clock3}
                    label={contest.acceptingEntries ? "Clôture dans" : "Ouverture dans"}
                    value={countdown(contest.acceptingEntries ? contest.endAt : contest.startAt)}
                  />
                </div>
              </article>

              <article className="rounded-lg border border-forest/10 bg-cream p-6 sm:p-8">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-1 shrink-0 text-champagne" aria-hidden="true" />
                  <div>
                    <h2 className="font-display text-3xl text-forest">Conditions essentielles</h2>
                    <p className="mt-3 whitespace-pre-line text-sm leading-6 text-ink/70">
                      {contest.eligibilityConditions}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-ink/70">
                      Aucun consentement publicitaire n’est nécessaire pour participer.
                    </p>
                    {contest.rulesUrl ? (
                      <a
                        className="mt-4 inline-flex font-semibold text-forest underline decoration-champagne underline-offset-4"
                        href={contest.rulesUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Consulter le règlement complet
                      </a>
                    ) : (
                      <a
                        className="mt-4 inline-flex font-semibold text-forest underline decoration-champagne underline-offset-4"
                        href="#reglement-concours"
                      >
                        Consulter le règlement complet
                      </a>
                    )}
                  </div>
                </div>
              </article>

              {contest.rulesText && (
                <article id="reglement-concours" className="rounded-lg border border-forest/10 bg-ivory p-6 sm:p-8">
                  <h2 className="font-display text-3xl text-forest">Règlement</h2>
                  <p className="mt-4 whitespace-pre-line text-sm leading-7 text-ink/70">
                    {contest.rulesText}
                  </p>
                </article>
              )}
            </div>

            <aside className="rounded-lg border border-champagne/30 bg-ivory p-6 shadow-soft sm:p-8 lg:sticky lg:top-28">
              {publicId ? (
                <div role="status" aria-live="polite" className="text-center">
                  <CheckCircle2 className="mx-auto text-forest" size={42} aria-hidden="true" />
                  <h2 className="mt-4 font-display text-4xl text-forest">Participation confirmée</h2>
                  <p className="mt-3 text-sm leading-6 text-ink/65">
                    Conservez votre identifiant de participation. Il ne permet pas d’accéder à vos
                    données personnelles.
                  </p>
                  <p className="mt-5 rounded-md border border-champagne/40 bg-cream px-4 py-3 font-mono text-lg font-semibold tracking-wide text-forest">
                    {publicId}
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit}>
                  <h2 className="font-display text-4xl text-forest">Participer</h2>
                  <p className="mt-2 text-sm leading-6 text-ink/60">
                    Deux informations suffisent. Le consentement newsletter reste facultatif.
                  </p>
                  <label className="mt-6 grid gap-2 text-sm font-semibold text-forest">
                    Prénom ou pseudo
                    <input
                      className="input-field"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      maxLength={80}
                      autoComplete="given-name"
                      required
                    />
                  </label>
                  <label className="mt-4 grid gap-2 text-sm font-semibold text-forest">
                    Adresse e-mail
                    <input
                      className="input-field"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      maxLength={254}
                      autoComplete="email"
                      required
                    />
                  </label>
                  <label className="mt-5 flex items-start gap-3 text-sm leading-6 text-ink/70">
                    <input
                      className="mt-1 h-4 w-4 accent-forest"
                      type="checkbox"
                      checked={rulesAccepted}
                      onChange={(event) => setRulesAccepted(event.target.checked)}
                      required
                    />
                    <span>J’accepte le règlement du concours et ses conditions d’éligibilité.</span>
                  </label>
                  <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-ink/70">
                    <input
                      className="mt-1 h-4 w-4 accent-forest"
                      type="checkbox"
                      checked={marketingConsent}
                      onChange={(event) => setMarketingConsent(event.target.checked)}
                    />
                    <span>
                      Je souhaite recevoir les actualités et offres Verdanza. Facultatif, décoché par
                      défaut.
                    </span>
                  </label>
                  <label className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
                    Entreprise
                    <input
                      value={company}
                      onChange={(event) => setCompany(event.target.value)}
                      tabIndex={-1}
                      autoComplete="off"
                    />
                  </label>
                  {submitError && (
                    <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                      {submitError}
                    </p>
                  )}
                  <button
                    className="btn-primary mt-6 w-full"
                    type="submit"
                    disabled={!contest.acceptingEntries || isSubmitting}
                  >
                    {isSubmitting
                      ? "Enregistrement..."
                      : contest.acceptingEntries
                        ? "Valider ma participation"
                        : "Participation bientôt ouverte"}
                  </button>
                  <p className="mt-4 text-xs leading-5 text-ink/50">
                    Une participation par e-mail et par concours. Vos informations ne sont jamais
                    publiées dans la liste des participants.
                  </p>
                </form>
              )}
            </aside>
          </div>
        )}
      </section>
    </main>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Gift;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-forest/10 bg-cream p-4">
      <Icon size={19} className="text-champagne" aria-hidden="true" />
      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-forest/60">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-5 text-forest">{value}</p>
    </div>
  );
}

function StatePanel({
  title,
  description,
  tone = "default",
}: {
  title: string;
  description?: string;
  tone?: "default" | "error";
}) {
  return (
    <div className={`rounded-lg border p-8 text-center ${tone === "error" ? "border-red-200 bg-red-50" : "border-forest/10 bg-ivory"}`}>
      <h2 className="font-display text-4xl text-forest">{title}</h2>
      {description && <p className="mt-3 text-sm text-ink/65">{description}</p>}
    </div>
  );
}

function formatEuro(value: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatPeriod(startAt: string, endAt: string) {
  return `Du ${formatDateTime(startAt)} au ${formatDateTime(endAt)}`;
}

function countdown(target: string) {
  const remaining = Math.max(0, Date.parse(target) - Date.now());
  if (!remaining) return "Terminé";
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return days > 0 ? `${days} j ${hours} h ${minutes} min` : `${hours} h ${minutes} min ${seconds} s`;
}
