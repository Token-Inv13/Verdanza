export type WithdrawalDetails = {
  name: string;
  email: string;
  contract: string;
  items: string;
};

export type WithdrawalReceipt = WithdrawalDetails & {
  id: string;
  submittedAt: string;
  text: string;
};

export function withdrawalStatement(details: WithdrawalDetails) {
  return `Je vous notifie ma rétractation du contrat suivant : ${details.contract}. Produits concernés : ${details.items || "totalité de la commande"}.`;
}

export function withdrawalReceiptText(details: WithdrawalDetails, submittedAt: string, id: string) {
  return [
    "Verdanza — accusé de réception de rétractation",
    `Référence de déclaration : ${id}`,
    `Date et heure d’envoi (UTC) : ${submittedAt}`,
    `Nom et prénom : ${details.name}`,
    `E-mail pour l’accusé de réception : ${details.email}`,
    withdrawalStatement(details),
    "Votre déclaration a été transmise à Verdanza. L’adresse de retour vous sera communiquée directement. Cet accusé constate la déclaration et ne constitue pas une confirmation de remboursement.",
    "Politique de retour : https://verdanza.fr/retours",
    "Contact : contact@verdanza.fr",
  ].join("\n\n");
}
