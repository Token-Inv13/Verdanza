import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

function findHashTarget(hash: string) {
  const rawId = hash.replace(/^#/, "");
  if (!rawId) return null;

  const id = safelyDecodeHash(rawId);
  return document.getElementById(id) ?? document.getElementsByName(id)[0] ?? null;
}

function safelyDecodeHash(hash: string) {
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

export function ScrollToTop() {
  const { hash, pathname, search } = useLocation();

  useLayoutEffect(() => {
    if (hash) {
      window.requestAnimationFrame(() => {
        const target = findHashTarget(hash);
        if (target) {
          target.scrollIntoView({ block: "start", behavior: "auto" });
          return;
        }

        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      });
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [hash, pathname, search]);

  return null;
}
