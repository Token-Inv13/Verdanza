import React from "react";
import {
  financingDisplayItems,
  financingNotices,
  formatFinancingCents,
  type OrderFinancingPresentation,
} from "../../lib/orderFinancing.js";

export function OrderFinancingSummary({
  presentation,
  title = "Financement de la commande",
  showOrdinary = false,
  context = "order",
}: {
  presentation: OrderFinancingPresentation;
  title?: string;
  showOrdinary?: boolean;
  context?: "order" | "document";
}) {
  if (presentation.kind === "ordinary" && !showOrdinary) return null;
  const items = financingDisplayItems(presentation, context);
  const notices = financingNotices(presentation);

  return (
    <section
      className="rounded-md border border-forest/10 bg-cream p-3 text-sm leading-6 text-ink/70"
      data-order-financing={presentation.verification}
    >
      <strong className="block text-forest">{title}</strong>
      {presentation.verification === "required" ? (
        <p className="mt-2 text-amber-800">
          Vérification nécessaire : les données persistées ne permettent pas de présenter un montant hors cagnotte fiable.
        </p>
      ) : (
        <dl className="mt-2 grid gap-1">
          {items.map((item) => (
            <div key={item.label} className="grid grid-cols-[minmax(0,1fr)_max-content] items-start gap-x-4">
              <dt className="min-w-0">{item.label}</dt>
              <dd className="whitespace-nowrap text-right font-semibold text-forest">{formatFinancingCents(item.cents)}</dd>
            </div>
          ))}
        </dl>
      )}
      {notices.map((notice) => (
        <p key={notice} className="mt-2 text-xs leading-5 text-ink/60">
          {notice}
        </p>
      ))}
    </section>
  );
}
