export const publishedBlogArticleSlugs = [
  "calibre-fleurs-cbd-taille-tetes",
  "origine-variete-lot-cbd-differences",
  "signes-alteration-fleurs-resines-cbd",
  "infusions-feuilles-chanvre-reglement-ue-2027",
  "etiquette-numero-lot-cbd-tracabilite",
  "aspect-resine-cbd-texture-couleur",
  "aspect-fleur-cbd-couleur-structure",
  "terpenes-profils-aromatiques-cbd",
  "cbd-conduite-france",
  "denominations-cbd-cbn-cbg",
  "conserver-fleurs-resines-cbd",
  "comment-lire-analyse-cbd",
  "fleur-cbd-ou-resine-cbd-differences",
  "choisir-fleur-cbd-profil-aromatique",
  "indoor-greenhouse-hydroponique-differences",
] as const;

export type PublishedBlogArticleSlug = (typeof publishedBlogArticleSlugs)[number];

export function isPublishedBlogArticleSlug(value: string): value is PublishedBlogArticleSlug {
  return (publishedBlogArticleSlugs as readonly string[]).includes(value);
}
