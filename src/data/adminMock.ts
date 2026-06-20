import type { AdminMetric } from "../types";

export const adminMetrics: AdminMetric[] = [
  { label: "CA du jour", value: "486 €", detail: "Mock Phase 1" },
  { label: "CA mensuel", value: "8 240 €", detail: "Objectif a connecter" },
  { label: "Commandes du jour", value: "12", detail: "3 locales" },
  { label: "En attente", value: "5", detail: "Paiement ou preparation" },
  { label: "A preparer", value: "7", detail: "Stocks reserves mockes" },
  { label: "Livraisons locales", value: "4", detail: "Aix et alentours" },
  { label: "Ruptures", value: "1", detail: "A verifier" },
  { label: "Panier moyen", value: "42 €", detail: "Simulation" },
];

export const mockOrders = [
  {
    id: "VDZ-1007",
    customer: "Client test",
    customerEmail: "client@example.com",
    customerPhone: "0600000000",
    paymentStatus: "mock",
    orderStatus: "preparing",
    delivery: "Livraison express Aix",
    items: [],
    total: "54,70 €",
  },
  {
    id: "VDZ-1008",
    customer: "Commande postale",
    customerEmail: "postale@example.com",
    customerPhone: "0600000001",
    paymentStatus: "mock",
    orderStatus: "paid",
    delivery: "Colissimo suivi",
    items: [],
    total: "38,40 €",
  },
  {
    id: "VDZ-1009",
    customer: "Client local",
    customerEmail: "local@example.com",
    customerPhone: "0600000002",
    paymentStatus: "mock",
    orderStatus: "pending",
    delivery: "Venelles",
    items: [],
    total: "72,90 €",
  },
];
