import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

type FirebaseAdminEnvironment = Readonly<Record<string, string | undefined>>;

type FirebaseAdminServiceAccount = Readonly<{
  projectId: string;
  clientEmail: string;
  privateKey: string;
}>;

export type FirebaseAdminCredentialMethod =
  | "service_account_base64"
  | "service_account_fields"
  | "application_default_unresolved"
  | "preexisting_app_unresolved";

export type FirebaseAdminIdentityProof = Readonly<{
  event: "firebase_admin_identity_configured";
  credentialMethod: FirebaseAdminCredentialMethod;
  projectId: string | null;
  clientEmail: string | null;
  deploymentReference: string | null;
  commit: string | null;
}>;

type FirebaseAdminCredentialSource = Readonly<{
  credentialMethod: Exclude<FirebaseAdminCredentialMethod, "preexisting_app_unresolved">;
  projectId: string | null;
  clientEmail: string | null;
  serviceAccount: FirebaseAdminServiceAccount | null;
}>;

export type FirebaseAdminInitializerDependencies<TApp extends object, TCredential> = Readonly<{
  getApps: () => readonly TApp[];
  cert: (serviceAccount: FirebaseAdminServiceAccount) => TCredential;
  applicationDefault: () => TCredential;
  initializeApp: (options: { credential: TCredential; storageBucket?: string }) => TApp;
  log: (event: FirebaseAdminIdentityProof["event"], payload: FirebaseAdminIdentityProof) => void;
}>;

export class FirebaseAdminCredentialConfigurationError extends Error {
  readonly code = "firebase_admin_credential_invalid";

  constructor() {
    super("Configuration Firebase Admin invalide.");
    this.name = "FirebaseAdminCredentialConfigurationError";
  }
}

const FIREBASE_ADMIN_IDENTITY_EVENT = "firebase_admin_identity_configured" as const;
const identityProofApps = new WeakSet<object>();

function resolveCredentialSource(environment: FirebaseAdminEnvironment): FirebaseAdminCredentialSource {
  const encoded = environment.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (encoded) {
    const parsed = parseEncodedServiceAccount(encoded);
    const serviceAccount = {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    };
    return {
      credentialMethod: "service_account_base64",
      projectId: serviceAccount.projectId,
      clientEmail: serviceAccount.clientEmail,
      serviceAccount,
    };
  }

  const projectId = environment.FIREBASE_PROJECT_ID;
  const clientEmail = environment.FIREBASE_CLIENT_EMAIL;
  const privateKey = environment.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    const serviceAccount = { projectId, clientEmail, privateKey };
    return {
      credentialMethod: "service_account_fields",
      projectId,
      clientEmail,
      serviceAccount,
    };
  }

  return {
    credentialMethod: "application_default_unresolved",
    projectId: null,
    clientEmail: null,
    serviceAccount: null,
  };
}

export function getAdminDb() {
  ensureAdminApp();
  return getFirestore();
}

export function getAdminAuth() {
  return getAuth(ensureAdminApp());
}

/** Resolved credential/project identity only. Never logs or returns credential material. */
export function getAdminProjectId(): string | null {
  const source = resolveCredentialSource(process.env);
  if (source.projectId) return source.projectId;
  return process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || null;
}

export function getAdminStorageBucket() {
  ensureAdminApp();
  return getStorage().bucket();
}

function ensureAdminApp() {
  return initializeFirebaseAdminApp(
    process.env,
    {
      getApps,
      cert,
      applicationDefault,
      initializeApp: ({ credential, storageBucket }) => initializeApp({ credential, storageBucket }),
      log: (event, payload) => console.info(event, payload),
    },
    identityProofApps,
  );
}

export function initializeFirebaseAdminApp<TApp extends object, TCredential>(
  environment: FirebaseAdminEnvironment,
  dependencies: FirebaseAdminInitializerDependencies<TApp, TCredential>,
  emittedApps: WeakSet<object>,
): TApp {
  const existingApp = dependencies.getApps()[0];
  if (existingApp) {
    emitIdentityProof(
      existingApp,
      {
        credentialMethod: "preexisting_app_unresolved",
        projectId: null,
        clientEmail: null,
      },
      environment,
      dependencies.log,
      emittedApps,
    );
    return existingApp;
  }

  const source = resolveCredentialSource(environment);
  const credential = source.serviceAccount
    ? dependencies.cert(source.serviceAccount)
    : dependencies.applicationDefault();
  const storageBucket = environment.FIREBASE_STORAGE_BUCKET || environment.VITE_FIREBASE_STORAGE_BUCKET;
  const app = dependencies.initializeApp({ credential, storageBucket });
  emitIdentityProof(app, source, environment, dependencies.log, emittedApps);
  return app;
}

function parseEncodedServiceAccount(encoded: string) {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Record<string, unknown>;
    if (
      typeof parsed.project_id !== "string" ||
      typeof parsed.client_email !== "string" ||
      typeof parsed.private_key !== "string" ||
      !parsed.project_id ||
      !parsed.client_email ||
      !parsed.private_key
    ) {
      throw new FirebaseAdminCredentialConfigurationError();
    }
    return {
      project_id: parsed.project_id,
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    };
  } catch {
    throw new FirebaseAdminCredentialConfigurationError();
  }
}

function emitIdentityProof<TApp extends object>(
  app: TApp,
  identity: Pick<FirebaseAdminIdentityProof, "credentialMethod" | "projectId" | "clientEmail">,
  environment: FirebaseAdminEnvironment,
  log: FirebaseAdminInitializerDependencies<TApp, unknown>["log"],
  emittedApps: WeakSet<object>,
) {
  if (emittedApps.has(app)) return;
  emittedApps.add(app);

  try {
    const payload: FirebaseAdminIdentityProof = {
      event: FIREBASE_ADMIN_IDENTITY_EVENT,
      credentialMethod: identity.credentialMethod,
      projectId: safeProjectId(identity.projectId),
      clientEmail: safeClientEmail(identity.clientEmail),
      deploymentReference: safeDeploymentReference(
        environment.VERCEL_DEPLOYMENT_ID || environment.VERCEL_URL,
      ),
      commit: safeCommit(environment.VERCEL_GIT_COMMIT_SHA),
    };
    log(FIREBASE_ADMIN_IDENTITY_EVENT, payload);
  } catch {
    // A private diagnostic must never change Firebase initialization behavior.
  }
}

function safeProjectId(value: string | null) {
  return safeField(value, 128, /^[a-z0-9][a-z0-9.:-]*$/i);
}

function safeClientEmail(value: string | null) {
  return safeField(value, 254, /^[^@\s]+@[^@\s]+$/);
}

function safeDeploymentReference(value: string | undefined) {
  return safeField(value ?? null, 253, /^[a-z0-9][a-z0-9._:/-]*$/i);
}

function safeCommit(value: string | undefined) {
  return safeField(value ?? null, 64, /^[a-f0-9]{7,64}$/i);
}

function safeField(value: string | null, maxLength: number, pattern: RegExp) {
  if (!value || value !== value.trim() || value.length > maxLength || !pattern.test(value)) return null;
  return value;
}
