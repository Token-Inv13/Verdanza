import crypto from "node:crypto";
import type Stripe from "stripe";
import { FieldValue } from "firebase-admin/firestore";
import { parseCheckoutBody, priceCheckout, type CheckoutRequestBody, type PricedCheckout } from "./checkout.js";
import { omitUndefinedDeep } from "./firestoreSerialization.js";
import { stripeTestOrigin } from "./stripeTestConfig.js";
import { orderItemLineTotal } from "../../src/lib/orderLineDisplay.js";

export type TestPaymentStatus = "pending" | "payment_pending" | "paid" | "payment_failed" | "cancelled";
export type StripeTestOrder = {
  id: string;
  isTestOrder: true;
  fingerprint: string;
  accessTokenHash: string;
  amountCents: number;
  currency: "eur";
  paymentStatus: TestPaymentStatus;
  sessionId?: string;
  checkoutUrl?: string;
  paymentIntentId?: string;
  paidTransitions: number;
  createdMs: number;
  checkoutParams: Stripe.Checkout.SessionCreateParams;
  priced: PricedCheckout;
  checkoutInput: CheckoutRequestBody;
};

export const stripeTestEvents = ["checkout.session.completed", "checkout.session.expired", "payment_intent.payment_failed"] as const;
const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);

export function normalizeTestCheckout(value: unknown) {
  const parsed = parseCheckoutBody(value);
  if (parsed.cagnotteUse) throw new Error("test_cagnotte_unavailable");
  if (!validId(parsed.checkoutRequestId)) throw new Error("test_request_id_invalid");
  if (!parsed.customer.email.endsWith("@example.invalid")) throw new Error("synthetic_email_required");
  if (parsed.preferredPaymentMethod && parsed.preferredPaymentMethod !== "card_payment_link") throw new Error("test_card_required");
  if (parsed.items.length > 40 || parsed.company) throw new Error("test_request_invalid");
  // Allow-list the fingerprint: frontend totals, prices, payment status and test flags have no authority.
  const body: CheckoutRequestBody = {
    checkoutRequestId: parsed.checkoutRequestId,
    items: parsed.items.map((item) => ({ productId: String(item.productId), quantity: item.quantity,
      purchaseMode: item.purchaseMode === "fixed_price" ? "fixed_price" : "gram", fixedPriceOptionId: item.fixedPriceOptionId })),
    deliveryMethod: parsed.deliveryMethod, deliveryZone: parsed.deliveryZone,
    couponCode: parsed.couponCode, promotionSelections: parsed.promotionSelections, complianceAccepted: true,
    preferredPaymentMethod: "card_payment_link", customer: parsed.customer, customerMessage: parsed.customerMessage,
  };
  return { body, fingerprint: sha256(JSON.stringify(body)) };
}

export function checkoutLines(priced: PricedCheckout): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const amounts = priced.orderItems.map((item) => Math.round(orderItemLineTotal(item) * 100));
  const subtotal = amounts.reduce((sum, amount) => sum + amount, 0);
  const discount = Math.round(priced.discountAmount * 100);
  if (discount < 0 || discount > subtotal) throw new Error("test_discount_invalid");
  let remainder = discount;
  const discounts = amounts.map((amount) => {
    const part = subtotal ? Math.floor(discount * amount / subtotal) : 0;
    remainder -= part;
    return part;
  });
  for (let i = 0; remainder > 0 && i < discounts.length; i++) {
    const extra = Math.min(remainder, amounts[i] - discounts[i]);
    discounts[i] += extra;
    remainder -= extra;
  }
  const lines: Stripe.Checkout.SessionCreateParams.LineItem[] = priced.orderItems.map((item, index) => ({
    quantity: 1,
    price_data: { currency: "eur", unit_amount: amounts[index] - discounts[index], product_data: {
      name: `${item.name} — ${item.quantity} g`,
      description: `Produit CBD Verdanza. Simulation uniquement, sans vente ni expédition. Référence ${item.productId}.`,
    } },
  }));
  if (priced.deliveryFee > 0) lines.push({ quantity: 1, price_data: { currency: "eur", unit_amount: Math.round(priced.deliveryFee * 100), product_data: { name: "Livraison — simulation TEST" } } });
  if (lines.reduce((sum, line) => sum + (line.price_data?.unit_amount || 0), 0) !== Math.round(priced.total * 100)) throw new Error("test_total_mismatch");
  return lines;
}

export async function createTestCheckout(db: FirebaseFirestore.Firestore, stripe: Stripe, input: unknown, accessToken: string) {
  if (!/^[a-f0-9]{64}$/.test(accessToken)) throw new Error("test_access_token_invalid");
  const { body, fingerprint } = normalizeTestCheckout(input);
  const id = body.checkoutRequestId!;
  const ref = db.collection("stripeTestOrders").doc(id);
  let order = (await ref.get()).data() as StripeTestOrder | undefined;
  if (!order) {
    const priced = await priceCheckout(db, body);
    const amountCents = Math.round(priced.total * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents < 50 || amountCents > 100000) throw new Error("test_amount_invalid");
    const createdMs = Date.now();
    const draft: StripeTestOrder = {
      id, isTestOrder: true, fingerprint, accessTokenHash: sha256(accessToken), amountCents, currency: "eur",
      paymentStatus: "pending", paidTransitions: 0, createdMs, priced, checkoutInput: body,
      checkoutParams: {
        mode: "payment", payment_method_types: ["card"], line_items: checkoutLines(priced),
        client_reference_id: id, metadata: { orderId: id, isTestOrder: "true" },
        payment_intent_data: { metadata: { orderId: id, isTestOrder: "true" } },
        expires_at: Math.floor(createdMs / 1000) + 3600,
        success_url: `${stripeTestOrigin}/stripe-test/success?order_id=${id}`,
        cancel_url: `${stripeTestOrigin}/stripe-test/cancel?order_id=${id}`,
      },
    };
    order = await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) return existing.data() as StripeTestOrder;
      tx.create(ref, omitUndefinedDeep(draft));
      return draft;
    });
  }
  if (order.fingerprint !== fingerprint || order.accessTokenHash !== sha256(accessToken)) throw new Error("test_request_conflict");
  if (order.checkoutUrl && order.sessionId) {
    const existing = await stripe.checkout.sessions.retrieve(order.sessionId);
    assertTestSession(order, existing);
    if (existing.status !== "open") throw new Error("test_session_not_open");
    return { orderId: id, url: order.checkoutUrl, paymentStatus: order.paymentStatus };
  }
  // Prevent a new charge if an interrupted request is retried after Stripe's idempotency retention.
  if (Date.now() - order.createdMs > 45 * 60 * 1000) throw new Error("test_creation_expired");
  const session = await stripe.checkout.sessions.create(order.checkoutParams, { idempotencyKey: `verdanza-test-${id}` });
  assertTestSession(order, session);
  if (!session.url?.startsWith("https://checkout.stripe.com/")) throw new Error("test_checkout_url_invalid");
  await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() as StripeTestOrder;
    if (fresh.sessionId && fresh.sessionId !== session.id) throw new Error("test_session_conflict");
    tx.update(ref, { sessionId: session.id, checkoutUrl: session.url,
      ...(fresh.paymentStatus === "pending" ? { paymentStatus: "payment_pending" } : {}) });
  });
  return { orderId: id, url: session.url, paymentStatus: "payment_pending" };
}

export function assertTestSession(order: StripeTestOrder, session: Stripe.Checkout.Session) {
  if (session.livemode !== false || !session.id.startsWith("cs_test_") || session.mode !== "payment"
    || session.metadata?.isTestOrder !== "true" || session.metadata.orderId !== order.id
    || session.client_reference_id !== order.id || session.currency !== order.currency
    || session.amount_total !== order.amountCents) throw new Error("test_session_mismatch");
}

export async function readTestOrder(db: FirebaseFirestore.Firestore, id: string, token: string) {
  if (!validId(id)) throw new Error("test_order_missing");
  const order = (await db.collection("stripeTestOrders").doc(id).get()).data() as StripeTestOrder | undefined;
  if (!order || order.isTestOrder !== true || order.accessTokenHash !== sha256(token)) throw new Error("test_order_missing");
  return { orderId: id, isTestOrder: true, paymentStatus: order.paymentStatus, amountCents: order.amountCents,
    currency: order.currency, paidTransitions: order.paidTransitions };
}

// Only this signed-webhook path can set paid. No browser-return route changes state.
export async function handleTestStripeEvent(db: FirebaseFirestore.Firestore, stripe: Stripe, event: Stripe.Event) {
  if (event.livemode !== false) throw new Error("live_event_rejected");
  if (!stripeTestEvents.includes(event.type as typeof stripeTestEvents[number])) return { ignored: true };
  const object = event.data.object as Stripe.Checkout.Session | Stripe.PaymentIntent;
  const id = object.metadata?.orderId;
  if (object.metadata?.isTestOrder !== "true" || !validId(id)) return { ignored: true };
  const orderRef = db.collection("stripeTestOrders").doc(id);
  const snapshot = await orderRef.get();
  if (!snapshot.exists) throw new Error("test_order_missing");
  const order = snapshot.data() as StripeTestOrder;
  let session: Stripe.Checkout.Session;
  if (object.object === "checkout.session") {
    session = await stripe.checkout.sessions.retrieve(object.id);
  } else {
    if (!order.sessionId) throw new Error("test_session_not_persisted");
    session = await stripe.checkout.sessions.retrieve(order.sessionId);
  }
  assertTestSession(order, session);
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (object.object === "payment_intent" && (object.id !== paymentIntentId || object.livemode !== false || object.amount !== order.amountCents || object.currency !== order.currency)) throw new Error("test_intent_mismatch");
  const eventRef = db.collection("stripeTestEvents").doc(event.id);
  return db.runTransaction(async (tx) => {
    const [eventSnapshot, freshSnapshot] = await Promise.all([tx.get(eventRef), tx.get(orderRef)]);
    if (eventSnapshot.exists) return { duplicate: true };
    const fresh = freshSnapshot.data() as StripeTestOrder;
    if (fresh.sessionId && fresh.sessionId !== session.id) throw new Error("test_session_conflict");
    let status = fresh.paymentStatus;
    if (event.type === "checkout.session.completed" && session.payment_status === "paid" && session.status === "complete") status = "paid";
    else if (status !== "paid" && session.status === "expired") status = "cancelled";
    else if (status !== "paid" && event.type === "payment_intent.payment_failed" && session.status === "open") status = "payment_failed";
    tx.update(orderRef, { paymentStatus: status, sessionId: session.id,
      ...(paymentIntentId ? { paymentIntentId } : {}),
      ...(status === "paid" && fresh.paymentStatus !== "paid" ? { paidTransitions: FieldValue.increment(1), paidAt: FieldValue.serverTimestamp() } : {}) });
    tx.create(eventRef, { orderId: id, type: event.type, processedAt: FieldValue.serverTimestamp() });
    return { processed: true, paymentStatus: status };
  });
}
