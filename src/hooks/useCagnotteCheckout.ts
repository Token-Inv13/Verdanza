import { useEffect, useMemo, useState } from "react";
import {
  CagnotteCheckoutController,
  CheckoutAttemptController,
  clearCheckoutAttemptMarker,
  getOrCreateCheckoutRequestId,
  readCheckoutAttemptMarker,
  rotateCheckoutAttempt,
  writeCheckoutAttemptMarker,
  type CagnotteCheckoutState,
  type CheckoutAttemptState,
} from "../services/cagnotteCheckoutService";
import { fetchCagnotte } from "../services/cagnotteService";
import type { CheckoutOrderResult, CreateCheckoutOrderInput } from "../services/ordersService";
import type { OrderQuote } from "../services/quoteService";

const initialCagnotteState: CagnotteCheckoutState = {
  identityKey: null,
  contextKey: "",
  walletPhase: "idle",
  wallet: null,
  walletErrorCode: null,
  selectionEnabled: false,
  amountInput: "",
  amountError: null,
  proposalPhase: "idle",
  proposal: null,
  acceptance: null,
  proposalErrorCode: null,
  fallbackPhase: "idle",
  fallbackQuote: null,
  fallbackAccepted: false,
  announcement: "",
};

export function useCagnotteCheckout(options: {
  enabled: boolean;
  identityKey: string | null;
  contextKey: string;
  read?: typeof fetchCagnotte;
}) {
  const [state, setState] = useState(initialCagnotteState);
  const controller = useMemo(() => new CagnotteCheckoutController(setState), []);

  useEffect(() => {
    controller.setIdentity(options.enabled ? options.identityKey : null);
  }, [controller, options.enabled, options.identityKey]);

  useEffect(() => {
    controller.setContext(options.contextKey);
  }, [controller, options.contextKey]);

  useEffect(() => {
    if (!options.enabled || !options.identityKey) return;
    void controller.loadWallet(() => (options.read ?? fetchCagnotte)({ scope: "self" }));
  }, [controller, options.enabled, options.identityKey, options.read]);

  return {
    state,
    setSelectionEnabled: (enabled: boolean) => controller.setSelectionEnabled(enabled),
    setAmountInput: (value: string) => controller.setAmountInput(value),
    requestProposal: (load: (requestedCents: number) => Promise<OrderQuote>) => controller.requestProposal(load),
    requestMaximum: (load: (requestedCents: number) => Promise<OrderQuote>) => controller.requestMaximum(load),
    acceptProposal: () => controller.acceptProposal(),
    revalidate: (load: (requestedCents: number) => Promise<OrderQuote>) => controller.revalidate(load),
    continueWithout: (load: () => Promise<OrderQuote>) => controller.continueWithout(load),
    acceptWithoutCagnotte: () => controller.acceptWithoutCagnotte(),
    refreshWallet: () => options.identityKey
      ? controller.loadWallet(() => (options.read ?? fetchCagnotte)({ scope: "self" }))
      : Promise.resolve(),
  };
}

const initialAttemptState: CheckoutAttemptState = {
  identityKey: null,
  phase: "idle",
  requestId: null,
  error: "",
  result: null,
};

export function useCheckoutAttempt(identityKey: string) {
  const [state, setState] = useState(initialAttemptState);
  const [requestId, setRequestId] = useState("");
  const controller = useMemo(() => new CheckoutAttemptController(setState, {
    mark: (identity, marker) => writeCheckoutAttemptMarker(identity, marker),
    complete: (identity) => clearCheckoutAttemptMarker(identity),
    refused: (identity) => setRequestId(rotateCheckoutAttempt(identity)),
  }), []);

  useEffect(() => {
    const marker = readCheckoutAttemptMarker(identityKey);
    const nextRequestId = marker?.requestId ?? getOrCreateCheckoutRequestId(identityKey);
    setRequestId(nextRequestId);
    controller.setIdentity(identityKey, marker);
  }, [controller, identityKey]);

  return {
    state,
    requestId,
    submit: (
      request: CreateCheckoutOrderInput,
      send: (request: CreateCheckoutOrderInput) => Promise<CheckoutOrderResult>,
    ) => controller.submit(requestId, request, send),
    retry: (send: (request: CreateCheckoutOrderInput) => Promise<CheckoutOrderResult>) => controller.retry(send),
  };
}
