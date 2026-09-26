import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { HelpCircle, X } from "lucide-react";
import { ContactActions } from "./ContactActions";
import { useConsent } from "../context/ConsentContext";
import { trackContactHelpAction } from "../lib/analytics";
import { hasFloatingHelpCollision } from "../lib/floatingHelpCollision";

const interactiveSurfaceSelectorsByPath: Record<string, string[]> = {
  "/": ["[data-home-product-finder] button", "[data-home-product-finder] a"],
  "/fleurs-cbd": ["[data-category-product-filter] button"],
  "/resines-cbd": ["[data-category-product-filter] button"],
  "/fiches-produits": [
    "[data-product-selector-results]",
    "[data-product-sheet-category]",
  ],
};

export function FloatingContactButton({ suppressed = false }: { suppressed?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hiddenByInteractiveSurface, setHiddenByInteractiveSurface] = useState(true);
  const collisionRef = useRef(true);
  const consent = useConsent();
  const panelId = useId();
  const location = useLocation();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const previousPathRef = useRef(location.pathname);

  useLayoutEffect(() => {
    if (previousPathRef.current === location.pathname) return;
    previousPathRef.current = location.pathname;
    setIsOpen(false);
  }, [location.pathname]);

  const hiddenByConsent = !consent.hasDecision || consent.preferencesOpen;
  const isSuppressed = suppressed || hiddenByConsent || hiddenByInteractiveSurface;

  useLayoutEffect(() => {
    const selectors = [
      "[data-floating-help-suppress]",
      ...(interactiveSurfaceSelectorsByPath[location.pathname] ?? []),
    ];

    const observedTargets = new Set<HTMLElement>();
    let frame = 0;
    let targetsChanged = true;

    // Event bursts share one geometry read per frame; React only updates when
    // the collision changes, not for every scroll position.
    const scheduleMeasurement = () => {
      if (!frame) frame = window.requestAnimationFrame(measureCollision);
    };
    const resizeObserver = new ResizeObserver(scheduleMeasurement);

    const syncTargets = () => {
      const currentTargets = new Set(
        document.querySelectorAll<HTMLElement>(selectors.join(", ")),
      );

      for (const target of observedTargets) {
        if (currentTargets.has(target)) continue;
        resizeObserver.unobserve(target);
        observedTargets.delete(target);
      }

      for (const target of currentTargets) {
        if (observedTargets.has(target)) continue;
        observedTargets.add(target);
        resizeObserver.observe(target);
      }
    };

    function measureCollision() {
      frame = 0;
      if (targetsChanged) {
        targetsChanged = false;
        syncTargets();
      }
      const button = buttonRef.current;
      if (!button) return;
      const surfaces = [...observedTargets].filter((target) => {
        if (!target.getClientRects().length) return false;
        const style = window.getComputedStyle(target);
        return style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0";
      }).map((target) => target.getBoundingClientRect());
      const collision = hasFloatingHelpCollision(button.getBoundingClientRect(), surfaces, collisionRef.current);
      if (collision === collisionRef.current) return;
      collisionRef.current = collision;
      setHiddenByInteractiveSurface(collision);
      if (collision) {
        setIsOpen(false);
        if (wrapperRef.current?.contains(document.activeElement)) {
          (document.activeElement as HTMLElement | null)?.blur();
        }
      }
    }

    const mutationObserver = new MutationObserver(() => {
      targetsChanged = true;
      scheduleMeasurement();
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "data-floating-help-suppress"],
    });
    if (buttonRef.current) resizeObserver.observe(buttonRef.current);
    resizeObserver.observe(document.body);
    resizeObserver.observe(document.documentElement);
    window.addEventListener("scroll", scheduleMeasurement, { passive: true, capture: true });
    window.addEventListener("resize", scheduleMeasurement);
    window.visualViewport?.addEventListener("resize", scheduleMeasurement);
    window.visualViewport?.addEventListener("scroll", scheduleMeasurement);
    measureCollision();

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleMeasurement, true);
      window.removeEventListener("resize", scheduleMeasurement);
      window.visualViewport?.removeEventListener("resize", scheduleMeasurement);
      window.visualViewport?.removeEventListener("scroll", scheduleMeasurement);
    };
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!isSuppressed || !isOpen) return;
    setIsOpen(false);
  }, [isOpen, isSuppressed]);

  useEffect(() => {
    if (!isOpen || isSuppressed) return undefined;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (wrapperRef.current?.contains(target)) return;
      setIsOpen(false);
      buttonRef.current?.focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      buttonRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, isSuppressed]);

  function handleToggle() {
    setIsOpen((current) => {
      const next = !current;
      if (next) trackContactHelpAction("contact_help_open", "global_floating_button");
      return next;
    });
  }

  const needsProductPurchaseOffset = location.pathname.startsWith("/produits/");
  const positionClass = needsProductPurchaseOffset
    ? "bottom-[calc(env(safe-area-inset-bottom)+6rem)]"
    : "bottom-[calc(env(safe-area-inset-bottom)+0.75rem)]";

  return (
    <div
      ref={wrapperRef}
      className={`fixed ${positionClass} right-[max(0.75rem,env(safe-area-inset-right))] z-50 flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-3 sm:right-6${isSuppressed ? " invisible pointer-events-none" : ""}`}
      aria-hidden={isSuppressed || undefined}
      data-floating-help-footprint
      data-floating-help-collision={hiddenByInteractiveSurface ? "true" : "false"}
      data-floating-help-context-suppressed={suppressed || hiddenByConsent ? "true" : "false"}
    >
      {isOpen && !isSuppressed && (
        <section
          id={panelId}
          className="w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-champagne/40 bg-cream p-4 text-forest shadow-soft"
          aria-labelledby={`${panelId}-title`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id={`${panelId}-title`} className="font-display text-2xl leading-tight">
                Contacter Verdanza
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink/70">
                Une question sur une livraison, votre zone ou une commande ?
              </p>
            </div>
            <button
              type="button"
              className="icon-button h-10 min-w-10 px-0"
              onClick={() => {
                setIsOpen(false);
                buttonRef.current?.focus();
              }}
              aria-label="Fermer l'aide contact"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <ContactActions
            source="global_floating_button"
            variant="panel"
            className="mt-4"
            onAction={() => setIsOpen(false)}
          />
        </section>
      )}
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex h-12 min-h-12 w-12 shrink-0 items-center justify-center gap-2 rounded-full border border-champagne/40 bg-forest p-0 text-sm font-semibold text-ivory shadow-soft transition hover:bg-[#082f24] focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 sm:h-auto sm:w-auto sm:px-5 sm:py-3 motion-reduce:transition-none"
        disabled={isSuppressed}
        tabIndex={isSuppressed ? -1 : undefined}
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label={isOpen ? "Fermer l'aide Verdanza" : "Besoin d'aide ?"}
        data-testid="floating-contact-trigger"
      >
        <HelpCircle size={18} aria-hidden="true" />
        <span className="hidden sm:inline">Besoin d'aide ?</span>
      </button>
    </div>
  );
}
