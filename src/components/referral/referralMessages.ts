export function referralMessage(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "Votre session a expiré. Reconnectez-vous pour continuer.",
    sponsor_ineligible: "Votre lien sera disponible après une première commande personnelle payée et livrée.",
    referral_code_unknown: "Cette invitation n’est pas valide. Vérifiez le lien transmis par votre proche.",
    referral_code_invalid: "Cette invitation n’est pas valide. Vérifiez le lien transmis par votre proche.",
    self_referral: "Vous ne pouvez pas utiliser votre propre invitation.",
    referee_already_paid: "Cet avantage est réservé à une première commande produits.",
    referral_relation_consumed: "Votre avantage de première commande a déjà été utilisé.",
    referral_email_claimed: "Cette adresse est déjà associée à un avantage de première commande.",
    referral_checkout_reserved: "Une commande utilise déjà cette invitation. Terminez ou annulez cette commande avant de la modifier.",
    referral_history_inconclusive: "Nous ne pouvons pas confirmer votre éligibilité pour le moment. Contactez Verdanza si besoin.",
    referee_email_unverified: "Vérifiez l’adresse email de votre compte avant d’associer cette invitation.",
    referral_program_disabled: "Le parrainage n’est pas disponible pour le moment.",
  };
  return messages[code] || "Le parrainage est temporairement indisponible. Réessayez plus tard.";
}
