import { useEffect } from "react";
import { acquireBodyScrollLock, ensureBodyScrollUnlocked } from "../lib/bodyScrollLock";

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) {
      ensureBodyScrollUnlocked();
      return undefined;
    }

    return acquireBodyScrollLock();
  }, [locked]);
}
