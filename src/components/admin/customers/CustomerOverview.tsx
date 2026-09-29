import { available } from "../../../lib/adminCustomersV2";
import type { CustomerSummary } from "../../../types/adminCustomers";
import { Metric } from "./CustomerResource";
import { centsLabel, dateLabel } from "../../../lib/adminCustomersV2";
export function CustomerOverview({ summary }: { summary: CustomerSummary }) {
  const { customer, metrics } = summary;
  return <div className="space-y-5"><dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <Metric label="Email" value={available(customer.email)} /><Metric label="Téléphone" value={available(customer.phone)} /><Metric label="Compte créé" value={dateLabel(customer.createdAt)} />
    <Metric label="Statut" value={available(customer.status)} /><Metric label="Dernière commande connue dans le résumé" value={dateLabel(metrics.lastOrderAt)} /><Metric label="Dernière activité connue dans le résumé" value={dateLabel(summary.lastActivityAt)} />
    <Metric label="Nombre de commandes confirmées" value={metrics.count === null ? "Non disponible" : metrics.count} /><Metric label="Montant commandé" value={centsLabel(metrics.orderedCents)} /><Metric label="Montant payé hors cagnotte" value={centsLabel(metrics.paidCents)} /><Metric label="Montant remboursé hors cagnotte" value={centsLabel(metrics.refundedCents)} /><Metric label="Montant net hors cagnotte" value={centsLabel(metrics.netCents)} /><Metric label="Panier moyen commandé" value={centsLabel(metrics.averageCents)} />
    <Metric label="Cagnotte" value="Non disponible · consulter Fidélité" /><Metric label="Parrainage" value="Non disponible · consulter Parrainage" /><Metric label="Signaux internes" value={customer.tags.length ? customer.tags.join(" · ") : "Non disponible"} />
  </dl><p className="text-sm text-ink/65">{metrics.complete ? "Les métriques portent sur les commandes confirmées par UID, hors profils de test protégés." : "Historique partiel : les totaux globaux restent indisponibles. Consultez les pages de Commandes."} L’absence d’un récapitulatif de remboursement ne prouve pas un remboursement nul.</p><p className="text-sm text-ink/65">{summary.activityScope}</p>
    <dl className="grid gap-3 sm:grid-cols-2"><Metric label="Compteur historique de commandes (déclaré)" value={customer.historicalOrderCount === null ? "Non disponible" : customer.historicalOrderCount} /><Metric label="Montant historique déclaré (hors métriques vérifiées)" value={centsLabel(customer.historicalOrderedCents)} /></dl>
  </div>;
}
