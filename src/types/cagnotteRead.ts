export type CagnotteWalletStatus = "active" | "not_created";

export type CagnotteHistoryLabel =
  | "Gain en attente"
  | "Gain devenu disponible"
  | "Gain annulé"
  | "Ajustement de fidélité après retour"
  | "Régularisation des avantages"
  | "Gain affecté à une régularisation"
  | "Cagnotte réservée"
  | "Cagnotte utilisée"
  | "Cagnotte libérée"
  | "Cagnotte restituée après retour"
  | "Gain corrigé après rectification administrative"
  | "Restitution corrigée après rectification administrative";

export type CagnotteHistoryDetail = {
  compartment: "pending" | "available" | "reserved" | "regularization";
  deltaCents: number;
};

export type CagnotteHistoryItem = {
  occurredAt: string;
  label: CagnotteHistoryLabel;
  amountCents: number;
  details: readonly CagnotteHistoryDetail[];
};

export type CagnotteReadResponse = {
  currency: "EUR";
  capabilities: {
    /** The current response is an authenticated wallet read. */
    canReadWallet: true;
    /** Server configuration, independent from the displayed balance. */
    canRequestReservation: boolean;
    /** Server configuration, independent from credit use. */
    canAccrueLoyalty: boolean;
  };
  wallet: {
    status: CagnotteWalletStatus;
    availableCents: number;
    pendingCents: number;
    reservedCents: number;
    regularizationCents: number;
  };
  history: {
    items: readonly CagnotteHistoryItem[];
    nextCursor: string | null;
    completeness: "timestamped_movements_only";
    limitation: "Les mouvements antérieurs sans horodatage ne peuvent pas être affichés. L’historique visible peut être incomplet.";
  };
  freshness: {
    readAt: string;
    consistency: "wallet_and_page";
    refreshStartsAtFirstPage: true;
  };
};

export type CagnotteReadScope = "self" | "admin";
