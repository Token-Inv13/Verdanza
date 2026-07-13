type CatalogNoticeVariant = "shop" | "flowers" | "resins";

const noticeContent: Record<CatalogNoticeVariant, { title: string; text: string }> = {
  shop: {
    title: "De nouvelles références arrivent bientôt",
    text: "Des produits CBD sélectionnés avec soin seront ajoutés progressivement à la boutique.",
  },
  flowers: {
    title: "De nouvelles fleurs arrivent bientôt",
    text: "Des références sélectionnées avec soin seront ajoutées progressivement.",
  },
  resins: {
    title: "De nouvelles résines arrivent bientôt",
    text: "Des références sélectionnées avec soin seront ajoutées progressivement.",
  },
};

export function CatalogNotice({ variant = "shop" }: { variant?: CatalogNoticeVariant }) {
  const content = noticeContent[variant];

  return (
    <aside className="mt-4 rounded-md border border-champagne/25 bg-cream px-3.5 py-3 shadow-sm sm:px-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h2 className="font-display text-lg leading-tight text-forest sm:text-xl">
            {content.title}
          </h2>
          <p className="mt-1 text-sm leading-5 text-ink/65">{content.text}</p>
        </div>
        <span className="inline-flex shrink-0 rounded-full border border-forest/10 bg-ivory px-2 py-0.5 text-xs font-semibold text-forest">
          Bientôt
        </span>
      </div>
    </aside>
  );
}
