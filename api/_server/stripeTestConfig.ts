import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import Stripe from "stripe";

export const stripeTestProject = "demo-verdanza-stripe";
export const stripeTestOrigin = "http://127.0.0.1:5195";

// This first phase is deliberately local-only. Never fall back to Admin production.
export function assertStripeTestEnvironment(env = process.env) {
  if (env.STRIPE_TEST_ENABLED !== "true" || env.VERCEL || env.VERCEL_ENV || env.NODE_ENV === "production") {
    throw new Error("stripe_test_local_only");
  }
  if (env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8085") {
    throw new Error("stripe_test_emulator_required");
  }
  if (!/^sk_test_[A-Za-z0-9]+$/.test(env.STRIPE_TEST_SECRET_KEY || "")) {
    throw new Error("stripe_test_key_required");
  }
}

export function getStripeTestDb() {
  assertStripeTestEnvironment();
  const app = getApps().find((entry) => entry.name === stripeTestProject)
    || initializeApp({ projectId: stripeTestProject }, stripeTestProject);
  return getFirestore(app);
}

export function getStripeTestClient() {
  assertStripeTestEnvironment();
  return new Stripe(process.env.STRIPE_TEST_SECRET_KEY!, { maxNetworkRetries: 2 });
}
