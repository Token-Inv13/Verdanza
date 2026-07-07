type CatalogNoticeVariant = "shop" | "flowers" | "resins";

const noticeContent: Record<CatalogNoticeVariant, { title: string; text: string }> = {
  shop: {
    title: "Notre sélection s’enrichit bientôt",
    text: "De nouvelles références CBD sont en cours de sélection. Chaque produit est choisi avec attention pour compléter la gamme Verdanza avec des fleurs et résines conformes, qualitatives et soigneusement sélectionnées.",
  },
  flowers: {
    title: "De nouvelles fleurs CBD arrivent prochainement",
    text: "La sélection reste volontairement courte afin de proposer uniquement des références conformes, fraîches et soigneusement choisies.",
  },
  resins: {
    title: "De nouvelles résines CBD seront ajoutées prochainement",
    text: "Chaque référence est sélectionnée avec attention pour garantir une gamme claire, conforme et qualitative.",
  },
};

export function CatalogNotice({ variant = "shop" }: { variant?: CatalogNoticeVariant }) {
  const content = noticeContent[variant];

  return (
    <aside className="mt-8 rounded-lg border border-champagne/30 bg-cream px-5 py-5 shadow-sm sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-champagne">
            Catalogue Verdanza
          </p>
          <h2 className="mt-2 font-display text-3xl leading-tight text-forest">
            {content.title}
          </h2>
          <p className="mt-3 text-sm leading-6 text-ink/70">{content.text}</p>
        </div>
        <span className="inline-flex w-fit rounded-full border border-forest/10 bg-ivory px-3 py-1 text-xs font-semibold text-forest">
          Bientôt
        </span>
      </div>
    </aside>
  );
}
