import { config } from "dotenv";
import { getAdminDb } from "../api/_server/firebaseAdmin.js";

config({ path: ".env.local", quiet: true });

type ServiceAccountJson = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

export function requireConfirmationFlag(commandName: string) {
  if (!process.argv.includes("--yes")) {
    console.error(`${commandName} refuse de s'executer sans le flag --yes.`);
    console.error(`Relancer avec: npm run ${commandName} -- --yes`);
    process.exit(1);
  }
}

export function requireFirebaseAdminProjectId() {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (encoded) {
    try {
      const parsed = JSON.parse(
        Buffer.from(encoded, "base64").toString("utf8"),
      ) as ServiceAccountJson;
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return parsed.project_id;
      }
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 est invalide.");
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    return projectId;
  }

  throw new Error(
    "Variables Firebase Admin absentes. Fournir FIREBASE_SERVICE_ACCOUNT_BASE64 ou FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.",
  );
}

export function getRequiredAdminDb() {
  const projectId = requireFirebaseAdminProjectId();
  return {
    db: getAdminDb(),
    projectId,
  };
}

export function assertValidEmail(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL invalide.");
  }
}
