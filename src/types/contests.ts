export type ContestStatus =
  | "draft"
  | "scheduled"
  | "active"
  | "closed"
  | "drawing"
  | "winner_pending"
  | "completed"
  | "cancelled";

export type ContestPrizeType = "store_credit";

export type Contest = {
  id: string;
  sequenceNumber: number;
  title: string;
  slug: string;
  description: string;
  prizeValue: number;
  prizeType: ContestPrizeType;
  startAt: string;
  endAt: string;
  drawAt: string;
  status: ContestStatus;
  rulesUrl?: string;
  rulesText?: string;
  eligibilityConditions: string;
  prizeExpirationDays: number;
  entryCount: number;
  currentDrawId?: string;
  winnerEntryId?: string;
  prizeId?: string;
  createdBy: string;
  updatedBy: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PublicContest = Pick<
  Contest,
  | "id"
  | "title"
  | "slug"
  | "description"
  | "prizeValue"
  | "prizeType"
  | "startAt"
  | "endAt"
  | "drawAt"
  | "status"
  | "rulesUrl"
  | "rulesText"
  | "eligibilityConditions"
> & {
  acceptingEntries: boolean;
};

export type ContestEntryStatus = "eligible" | "invalidated";

export type ContestEntry = {
  id: string;
  publicId: string;
  contestId: string;
  displayName: string;
  email: string;
  emailNormalized: string;
  emailHash: string;
  rulesAccepted: true;
  marketingConsent: boolean;
  status: ContestEntryStatus;
  source: "web";
  enteredAt?: string;
  invalidatedAt?: string;
  invalidationReason?: string;
};

export type ContestDrawWinnerStatus = "pending" | "validated" | "invalidated";

export type ContestDraw = {
  id: string;
  drawId: string;
  contestId: string;
  drawNumber: number;
  eligibleEntryCount: number;
  eligibleEntryIds: string[];
  snapshotHash: string;
  winnerEntryId: string;
  winnerPublicId: string;
  winnerStatus: ContestDrawWinnerStatus;
  drawnAt?: string;
  algorithmVersion: string;
  performedBy: string;
  invalidatedAt?: string;
  invalidatedBy?: string;
  invalidationReason?: string;
  validatedAt?: string;
  validatedBy?: string;
};

export type ContestPrizeStatus =
  | "pending"
  | "issued"
  | "claimed"
  | "redeemed"
  | "expired"
  | "cancelled";

export type ContestPrize = {
  id: string;
  contestId: string;
  drawId: string;
  winnerEntryId: string;
  winnerPublicId: string;
  winnerDisplayName: string;
  winnerEmail: string;
  winnerEmailHash: string;
  value: number;
  type: ContestPrizeType;
  couponId: string;
  code: string;
  status: ContestPrizeStatus;
  claimTokenHash: string;
  claimTokenLastFour: string;
  invitationVersion: number;
  invitationRotatedAt?: string;
  createdAt?: string;
  expiresAt: string;
  claimedAt?: string;
  redeemedAt?: string;
  orderId?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  expiredAt?: string;
  emailDelivery?: {
    status: "sent" | "skipped" | "failed";
    reason?: string;
    providerId?: string;
    attemptedAt: string;
  };
};

export type ContestAuditAction =
  | "contest_created"
  | "contest_updated"
  | "status_changed"
  | "contest_closed"
  | "snapshot_created"
  | "draw_completed"
  | "winner_selected"
  | "winner_validated"
  | "winner_invalidated"
  | "redraw_requested"
  | "prize_created"
  | "prize_claimed"
  | "prize_redeemed"
  | "prize_expired"
  | "prize_cancelled"
  | "prize_invitation_rotated"
  | "prize_invitation_sent"
  | "prize_invitation_failed";

export type ContestAuditLog = {
  id: string;
  action: ContestAuditAction;
  contestId: string;
  drawId?: string;
  prizeId?: string;
  actorType: "admin" | "winner" | "system" | "checkout";
  actorId: string;
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

export type ContestInput = Pick<
  Contest,
  | "title"
  | "slug"
  | "description"
  | "prizeValue"
  | "prizeType"
  | "startAt"
  | "endAt"
  | "drawAt"
  | "rulesUrl"
  | "rulesText"
  | "eligibilityConditions"
  | "prizeExpirationDays"
>;
