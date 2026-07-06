export type AdminPaymentLink = {
  id: string;
  label: string;
  amount: number;
  currency: "EUR";
  url: string;
  active: boolean;
  note?: string;
  sortOrder: number;
};

export const adminPaymentLinks: AdminPaymentLink[] = [
  {
    id: "cb-10",
    label: "Paiement CB 10 €",
    amount: 10,
    currency: "EUR",
    url: "https://buy.stripe.com/9B65kFgpB62UciT2MW7N601",
    active: true,
    sortOrder: 10,
  },
  {
    id: "cb-20",
    label: "Paiement CB 20 €",
    amount: 20,
    currency: "EUR",
    url: "https://buy.stripe.com/cNi8wR0qD8b2dmX2MW7N603",
    active: true,
    sortOrder: 20,
  },
  {
    id: "cb-30",
    label: "Paiement CB 30 €",
    amount: 30,
    currency: "EUR",
    url: "https://buy.stripe.com/fZu28tb5h9f63MnfzI7N604",
    active: true,
    sortOrder: 30,
  },
  {
    id: "cb-50",
    label: "Paiement CB 50 €",
    amount: 50,
    currency: "EUR",
    url: "https://buy.stripe.com/cNibJ3ddpdvm2Ij5Z87N602",
    active: true,
    sortOrder: 50,
  },
];

export function activeAdminPaymentLinks() {
  return adminPaymentLinks
    .filter((link) => link.active)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function findActiveAdminPaymentLink(url: string) {
  return activeAdminPaymentLinks().find((link) => link.url === url);
}
