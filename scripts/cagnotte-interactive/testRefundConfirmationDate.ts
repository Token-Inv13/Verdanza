import assert from "node:assert/strict";
import { cagnotteRefundDateTimeLocalToIso } from "../../src/lib/cagnotteAdminDate.js";
import { refundConfirmationDateTimeLocal } from "./refundConfirmationDate.js";

const paidAt = "2026-09-17T18:54:59.291Z";
const recordedAt = "2026-09-17T18:55:02.210Z";
const { localValue } = refundConfirmationDateTimeLocal({ paidAt });
const confirmedAt = cagnotteRefundDateTimeLocalToIso(localValue);

assert.equal(confirmedAt, "2026-09-17T18:55:01.000Z");
assert.ok(confirmedAt >= paidAt && confirmedAt <= recordedAt);

const exactPaidAt = "2026-09-17T18:55:05.000Z";
assert.equal(
  cagnotteRefundDateTimeLocalToIso(refundConfirmationDateTimeLocal({
    paidAt: exactPaidAt,
  }).localValue),
  exactPaidAt,
);

assert.throws(
  () => refundConfirmationDateTimeLocal({ paidAt: "date-invalide" }),
  /Date de paiement persistée invalide/,
);

console.log(
  `OK [Date remboursement interactive] course CI neutralisée : paidAt=${paidAt}, ` +
  `confirmedAt=${confirmedAt}, recordedAt=${recordedAt}`,
);
