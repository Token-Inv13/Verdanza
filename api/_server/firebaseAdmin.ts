import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

function getServiceAccount() {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (encoded) {
    const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
      project_id: string;
      client_email: string;
      private_key: string;
    };
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    };
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    return {
      projectId,
      clientEmail,
      privateKey,
    };
  }

  return null;
}

export function getAdminDb() {
  ensureAdminApp();
  return getFirestore();
}

export function getAdminStorageBucket() {
  ensureAdminApp();
  return getStorage().bucket();
}

function ensureAdminApp() {
  if (!getApps().length) {
    const serviceAccount = getServiceAccount();
    const storageBucket =
      process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET;
    initializeApp({
      credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
      storageBucket,
    });
  }
}
