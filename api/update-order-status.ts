import { createOrderStatusHandler } from "./_server/orderStatusRoute.js";
import { verifyFirebaseIdToken } from "./_server/adminAuth.js";
import { getAdminDb, getAdminProjectId } from "./_server/firebaseAdmin.js";
import { CAGNOTTE_SERVER_PROGRAM } from "./_server/cagnotteProgram.js";
import { CAGNOTTE_RESERVATION_PROGRAM } from "./_server/cagnotteReservations.js";
import { sendOrderStatusUpdateEmail } from "./_server/email.js";
import { processPurchaseAnalyticsOutbox } from "./_server/purchaseAnalytics.js";

export default createOrderStatusHandler({
  getDb: getAdminDb, verifyToken: verifyFirebaseIdToken,
  sendStatusEmail: sendOrderStatusUpdateEmail, processAnalytics: processPurchaseAnalyticsOutbox,
  accrualProgram: CAGNOTTE_SERVER_PROGRAM,
  reservationProgram: CAGNOTTE_RESERVATION_PROGRAM,
  getFirebaseProjectId: getAdminProjectId,
});
