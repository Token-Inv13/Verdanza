import type { OrderQuote } from "./quoteService";
import { REFERRAL_CHECKOUT_QUOTE_VERSION, type ReferralCheckoutAcceptance } from "../types/referralCheckout";

export type ReferralCheckoutState = {
  identityKey: string | null; contextKey: string; requested: boolean;
  phase: "idle" | "loading" | "ready" | "changed" | "invalidated" | "error" | "conflict";
  quote: OrderQuote | null; acceptance: ReferralCheckoutAcceptance | null; message: string;
};
export const emptyReferralCheckoutState = (): ReferralCheckoutState => ({ identityKey: null, contextKey: "", requested: false,
  phase: "idle", quote: null, acceptance: null, message: "" });

/** Transient consent only. No token, attribution storage, or client price calculation. */
export class ReferralCheckoutController {
  private state = emptyReferralCheckoutState();
  private generation = 0;
  constructor(private publish: (state: ReferralCheckoutState) => void) {}
  snapshot() { return this.state; }
  setIdentity(identityKey: string | null) {
    if (identityKey === this.state.identityKey) return;
    this.generation++;
    this.state = { ...emptyReferralCheckoutState(), identityKey, contextKey: this.state.contextKey };
    this.emit();
  }
  setContext(contextKey: string) {
    if (contextKey === this.state.contextKey) return;
    this.invalidate();
    this.state = { ...this.state, contextKey }; this.emit();
  }
  invalidate() {
    this.generation++;
    this.state = { ...this.state, quote: null, acceptance: null, phase: this.state.requested ? "invalidated" : "idle",
      message: this.state.requested ? "Les conditions ont changé. Vérifiez puis acceptez un nouveau devis." : "" }; this.emit();
  }
  conflict() {
    this.generation++;
    this.state = { ...this.state, requested: true, phase: "conflict", quote: null, acceptance: null,
      message: "Le parrainage et l’utilisation de votre cagnotte ne se cumulent pas. Choisissez votre avantage." }; this.emit();
  }
  continueWithout() {
    this.generation++;
    this.state = { ...this.state, requested: false, phase: "idle", quote: null, acceptance: null, message: "Commande sans remise parrainage." }; this.emit();
  }
  async requestQuote(load: () => Promise<OrderQuote>) {
    if (!this.state.identityKey) return null;
    const generation = ++this.generation;
    const previous = this.state.acceptance;
    this.state = { ...this.state, requested: true, phase: "loading", acceptance: null, message: "Vérification de votre avantage…" }; this.emit();
    try {
      const quote = await load();
      if (generation !== this.generation) return null;
      const referral = quote.referralUse;
      if (!referral || referral.quoteVersion !== REFERRAL_CHECKOUT_QUOTE_VERSION || typeof referral.applied !== "boolean" ||
        !Number.isFinite(quote.total) || quote.total < 0 ||
        (referral.applied && (referral.referralDiscountCents !== 500 || !/^[a-f0-9]{64}$/.test(referral.quoteFingerprint) ||
          [referral.productsBeforeReferralCents, referral.productsAfterReferralCents, referral.deliveryCents, referral.payableCents, referral.loyaltyEstimateCents]
            .some((v) => !Number.isSafeInteger(v) || v < 0))) ||
        (!referral.applied && !["priority_advantage", "below_threshold", "no_relation", "right_consumed", "right_reserved"].includes(referral.reason)))
        throw new Error("referral_quote_invalid");
      const unchanged = previous && referral.applied && previous.quoteVersion === referral.quoteVersion &&
        previous.quoteFingerprint === referral.quoteFingerprint && previous.acceptedReferralDiscountCents === referral.referralDiscountCents &&
        previous.acceptedPayableCents === referral.payableCents;
      this.state = { ...this.state, quote, acceptance: unchanged ? previous : null, phase: previous && !unchanged ? "changed" : "ready",
        message: previous && !unchanged ? "Le devis a changé. Acceptez les nouvelles conditions avant de créer la commande." : "" }; this.emit();
      return quote;
    } catch (error) {
      if (generation !== this.generation) return null;
      if (error && typeof error === "object" && "code" in error && error.code === "REFERRAL_CAGNOTTE_CONFLICT") { this.conflict(); return null; }
      this.state = { ...this.state, quote: null, acceptance: null, phase: "error",
        message: "Votre avantage ne peut pas être confirmé. Réessayez ou choisissez explicitement de continuer sans parrainage." }; this.emit();
      return null;
    }
  }
  accept() {
    const referral = this.state.quote?.referralUse;
    if (!referral?.applied || this.state.phase === "loading") return;
    this.state = { ...this.state, acceptance: { quoteVersion: referral.quoteVersion, quoteFingerprint: referral.quoteFingerprint,
      acceptedReferralDiscountCents: referral.referralDiscountCents, acceptedPayableCents: referral.payableCents }, message: "Avantage parrainage accepté." }; this.emit();
  }
  async revalidate(load: () => Promise<OrderQuote>) {
    if (!this.state.acceptance) return null;
    const quote = await this.requestQuote(load);
    return quote && this.state.acceptance ? { quote, acceptance: this.state.acceptance } : null;
  }
  private emit() { this.publish(this.state); }
}
