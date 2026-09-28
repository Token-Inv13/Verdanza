// Public editorial entries only. No wallet data or service call.
type AdvantageBase = {
  id: "contest" | "loyalty" | "referral";
  eyebrow: string;
  title: string;
  navigationLabel: string;
  description: string;
};

export type AdvantageEntry = AdvantageBase & (
  | { status: "active"; to: string; cta: string;
      event: "advantages_contest_click" | "advantages_loyalty_click" | "advantages_referral_click" }
  | { status: "soon"; to?: never; cta?: never; event?: never }
);

export function getAdvantagesEntries(loyaltyEnabled: boolean, referralEnabled = false): AdvantageEntry[] {
  return [
    {
      id: "contest", eyebrow: "Concours", title: "Concours Verdanza",
      navigationLabel: "Concours",
      description: "Participer aux concours et découvrir les gains du moment.",
      status: "active", to: "/concours", cta: "Découvrir le concours",
      event: "advantages_contest_click",
    },
    {
      id: "loyalty", eyebrow: "Fidélité", title: "Mes avantages fidélité",
      navigationLabel: "Mes avantages fidélité",
      ...(loyaltyEnabled ? {
        status: "active" as const, to: "/compte/avantages", cta: "Voir mes avantages",
        description: "Consultez vos avantages dans votre espace client.",
        event: "advantages_loyalty_click" as const,
      } : {
        status: "soon" as const,
        description: "Un espace dédié à vos avantages fidélité, prochainement.",
      }),
    },
    {
      id: "referral", eyebrow: "Parrainage", title: "Parrainage Verdanza",
      navigationLabel: "Parrainage",
      ...(referralEnabled ? { status: "active" as const, to: "/compte/avantages", cta: "Voir mon parrainage",
        description: "Retrouvez votre invitation et vos avantages dans votre espace client.", event: "advantages_referral_click" as const }
        : { status: "soon" as const, description: "Le programme de parrainage Verdanza arrive prochainement." }),
    },
  ];
}

export function isAdvantagesPath(path: string) {
  return path === "/avantages" || path === "/compte/avantages" ||
    path === "/concours" || path.startsWith("/concours/");
}
