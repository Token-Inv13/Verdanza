import { Firestore } from "firebase-admin/firestore";

// Offline validation only: dedicated emulator port, never the user's manual-test instance.
export function createStripeTestFixtureDb() {
  if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === "production") throw new Error("test_local_only");
  // The SDK prefers this variable over host. Reject a conflicting inherited target.
  if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:18087") {
    throw new Error("test_fixture_emulator_conflict");
  }
  return new Firestore({ projectId: "demo-verdanza-stripe", host: "127.0.0.1:18087", ssl: false });
}
