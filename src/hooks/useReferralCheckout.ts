import { useEffect, useMemo, useState } from "react";
import { ReferralCheckoutController, emptyReferralCheckoutState } from "../services/referralCheckoutController";

export function useReferralCheckout(enabled: boolean, identityKey: string | null, contextKey: string) {
  const [state, setState] = useState(emptyReferralCheckoutState);
  const controller = useMemo(() => new ReferralCheckoutController(setState), []);
  useEffect(() => { controller.setIdentity(enabled ? identityKey : null); }, [controller, enabled, identityKey]);
  useEffect(() => { controller.setContext(contextKey); }, [controller, contextKey]);
  const current = state.identityKey === (enabled ? identityKey : null) && state.contextKey === contextKey;
  return { state: current ? state : { ...emptyReferralCheckoutState(), requested: state.requested && enabled && Boolean(identityKey), phase: "invalidated" as const }, controller };
}
