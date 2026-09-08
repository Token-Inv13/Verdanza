import { createOrderStatusHandler } from "./_server/orderStatusRoute.js";
import { verifyFirebaseIdToken } from "./_server/adminAuth.js";
import { getAdminDb } from "./_server/firebaseAdmin.js";
import { sendOrderStatusUpdateEmail } from "./_server/email.js";
import { processPurchaseAnalyticsOutbox } from "./_server/purchaseAnalytics.js";

export default createOrderStatusHandler({
  getDb: getAdminDb, verifyToken: verifyFirebaseIdToken,
  sendStatusEmail: sendOrderStatusUpdateEmail, processAnalytics: processPurchaseAnalyticsOutbox,
});
