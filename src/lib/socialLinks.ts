export const SOCIAL_LINKS = {
  instagram: {
    label: "Instagram",
    url: "https://www.instagram.com/verdanza.fr",
    ariaLabel: "Suivre Verdanza sur Instagram",
  },
  facebook: {
    label: "Facebook",
    url: "https://www.facebook.com/share/1CnCSyowXe/",
    ariaLabel: "Suivre Verdanza sur Facebook",
  },
} as const;

export function getActiveSocialLinks() {
  return Object.values(SOCIAL_LINKS).filter((link) => link.url.trim().length > 0);
}
