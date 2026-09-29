export async function getFirebaseIdToken() { return "local-marketing-token"; }
export function useAuth() { return { user: { uid: "fixture-admin" }, adminUser: { id: "fixture-admin", isActive: true } }; }
export const db = null;
export const app = null;
export const isFirebaseConfigured = false;
export const firebaseConfig = {};
export async function getFirebaseStorage() { return null; }
export async function getFirebaseAnalytics() { return null; }
export async function getCurrentFirebaseUser() { return { uid: "fixture-admin", getIdToken: getFirebaseIdToken }; }
export async function loadFirebaseAuthApi(): Promise<never> { throw new Error("Unexpected fixture Auth access"); }
