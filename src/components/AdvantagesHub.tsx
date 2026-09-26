import { ArrowUpRight, Gift, Sparkles, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import { getAdvantagesEntries, type AdvantageEntry } from "../lib/advantages";

const entryIcons = { contest: Gift, loyalty: Sparkles, referral: UsersRound };

export function AdvantagesHub({ loyaltyEnabled, onEntryClick }: {
  loyaltyEnabled: boolean;
  onEntryClick?: (entry: Extract<AdvantageEntry, { status: "active" }>) => void;
}) {
  return (
    <section className="advantages-hub__entries" aria-label="Les avantages Verdanza" data-advantages-entries>
      {getAdvantagesEntries(loyaltyEnabled).map((entry) => <AdvantageSurface key={entry.id} entry={entry} onEntryClick={onEntryClick} />)}
    </section>
  );
}

function AdvantageSurface({ entry, onEntryClick }: {
  entry: AdvantageEntry;
  onEntryClick?: (entry: Extract<AdvantageEntry, { status: "active" }>) => void;
}) {
  const Icon = entryIcons[entry.id];
  return (
    <article className={`advantage-surface advantage-surface--${entry.id}`} data-advantage={entry.id}
      data-status={entry.status} aria-labelledby={`advantage-${entry.id}-title`}>
      <div className="advantage-surface__meta">
        <p className="advantage-surface__eyebrow">{entry.eyebrow}</p>
        <span className={`advantage-surface__status advantage-surface__status--${entry.status}`}>
          <span aria-hidden="true" />{entry.status === "active" ? "Actif" : "Bientôt"}
        </span>
      </div>
      <Icon className="advantage-surface__icon" aria-hidden="true" />
      <h2 id={`advantage-${entry.id}-title`}>{entry.title}</h2>
      <p className="advantage-surface__description">{entry.description}</p>
      {entry.status === "active" ? (
        <Link to={entry.to} className="advantage-surface__link" data-floating-help-suppress onClick={() => onEntryClick?.(entry)}>
          {entry.cta}<ArrowUpRight size={17} aria-hidden="true" />
        </Link>
      ) : null}
    </article>
  );
}
