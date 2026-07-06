export type AdminPaymentLink = {
  id: string;
  label: string;
  url: string;
  active: boolean;
  note?: string;
  sortOrder: number;
};

export const adminPaymentLinks: AdminPaymentLink[] = [
  {
    id: "cb-link-1",
    label: "Lien CB 1",
    url: "https://buy.stripe.com/9B65kFgpB62UciT2MW7N601",
    active: true,
    sortOrder: 1,
  },
  {
    id: "cb-link-2",
    label: "Lien CB 2",
    url: "https://buy.stripe.com/cNibJ3ddpdvm2Ij5Z87N602",
    active: true,
    sortOrder: 2,
  },
  {
    id: "cb-link-3",
    label: "Lien CB 3",
    url: "https://buy.stripe.com/cNi8wR0qD8b2dmX2MW7N603",
    active: true,
    sortOrder: 3,
  },
  {
    id: "cb-link-4",
    label: "Lien CB 4",
    url: "https://buy.stripe.com/fZu28tb5h9f63MnfzI7N604",
    active: true,
    sortOrder: 4,
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
