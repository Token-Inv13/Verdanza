import { useRef, useState } from "react";
import { CagnotteCheckoutController } from "../services/cagnotteCheckoutService";
import type { CheckoutAttempt, CheckoutDependencies, CheckoutSubmission } from "../checkout/checkoutDependencies";

// Guest-only test flow: no wallet request, Auth, public storage or business mutation.
export const useTestCagnotte: CheckoutDependencies["useCagnotteCheckout"] = () => {
  const disabled = () => { throw new Error("test_cagnotte_unavailable"); };
  return {
    state: new CagnotteCheckoutController(() => {}).snapshot(),
    setSelectionEnabled: disabled, setAmountInput: disabled, requestProposal: disabled,
    requestMaximum: disabled, acceptProposal: disabled, revalidate: disabled,
    continueWithout: disabled, acceptWithoutCagnotte: disabled, refreshWallet: disabled,
  };
};

export function useTestCheckoutAttempt(dependencies: CheckoutDependencies): CheckoutAttempt {
  const [requestId] = useState(() => dependencies.storage.requestId());
  const [state, setState] = useState<CheckoutAttempt["state"]>({
    identityKey: "stripe-test-guest", phase: "idle", requestId, error: "", result: null,
  });
  const busy = useRef(false);
  const previous = useRef<CheckoutSubmission | null>(null);
  async function submit(input: CheckoutSubmission) {
    if (busy.current) return null;
    busy.current = true;
    previous.current = input;
    setState((current) => ({ ...current, phase: "submitting", error: "" }));
    try {
      // The local adapter persists the token/fingerprint; retries reuse its idempotency key.
      return await dependencies.submitOrder(input);
    } catch (error) {
      setState((current) => ({ ...current, phase: "idle", error: "Le serveur test est indisponible. Réessayez la même tentative." }));
      busy.current = false;
      throw error;
    }
  }
  return { state, requestId, submit, retry: () => previous.current ? submit(previous.current) : Promise.resolve(null) };
}
