import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type AdminDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "medium" | "large" | "xl";
  pending?: boolean;
  closeOnOverlay?: boolean;
  initialFocusRef?: RefObject<HTMLElement>;
  onClose: () => void;
};

const sizes = { medium: "max-w-xl", large: "max-w-4xl", xl: "max-w-6xl" };
// One stack also keeps a confirmation above its editor without releasing the page.
const dialogs: HTMLElement[] = [];
const background = new Map<HTMLElement, { inert: boolean; ariaHidden: string | null }>();
let previousOverflow = "";

function syncBackground() {
  const top = dialogs[dialogs.length - 1];
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (!background.has(child)) background.set(child, { inert: child.inert, ariaHidden: child.getAttribute("aria-hidden") });
    child.inert = child !== top;
    if (child !== top) child.setAttribute("aria-hidden", "true");
    else child.removeAttribute("aria-hidden");
  }
}

function focusableElements(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>(
    'a[href], button, input, select, textarea, [tabindex]',
  )).filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") &&
    !element.closest("[inert]") && element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== "hidden");
}

export function AdminDialog({
  open, title, description, children, footer, size = "large", pending = false,
  closeOnOverlay = true, initialFocusRef, onClose,
}: AdminDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const optionsRef = useRef({ pending, onClose, initialFocusRef });
  useLayoutEffect(() => {
    optionsRef.current = { pending, onClose, initialFocusRef };
  });

  useLayoutEffect(() => {
    if (!open || !rootRef.current || !panelRef.current) return;
    const root = rootRef.current;
    const panel = panelRef.current;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const trigger = active && !root.contains(active) ? active : returnFocusRef.current;
    returnFocusRef.current = trigger;
    if (dialogs.length === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    dialogs.push(root);
    const initial = optionsRef.current.initialFocusRef?.current;
    (initial && panel.contains(initial) && !initial.matches(":disabled") ? initial : titleRef.current || panel).focus();
    syncBackground();

    function handleKey(event: KeyboardEvent) {
      if (dialogs[dialogs.length - 1] !== root) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!optionsRef.current.pending) optionsRef.current.onClose();
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements(panel);
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
      } else if (event.shiftKey && (active === first || !elements.includes(active as HTMLElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    function containFocus(event: FocusEvent) {
      if (dialogs[dialogs.length - 1] === root && !panel.contains(event.target as Node)) {
        (focusableElements(panel)[0] || panel).focus();
      }
    }
    document.addEventListener("keydown", handleKey, true);
    document.addEventListener("focusin", containFocus, true);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      document.removeEventListener("focusin", containFocus, true);
      dialogs.splice(dialogs.indexOf(root), 1);
      if (dialogs.length) syncBackground();
      else {
        document.body.style.overflow = previousOverflow;
        background.forEach(({ inert, ariaHidden }, element) => {
          element.inert = inert;
          if (ariaHidden === null) element.removeAttribute("aria-hidden");
          else element.setAttribute("aria-hidden", ariaHidden);
        });
        background.clear();
      }
      // Wait for the commit to re-enable a trigger disabled during the operation.
      queueMicrotask(() => {
        if (!dialogs.includes(root) && trigger?.isConnected && !trigger.closest("[inert]")) trigger.focus();
      });
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/60 p-2 backdrop-blur-sm sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget && closeOnOverlay && !pending) onClose();
      }}>
      <section ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined} aria-busy={pending} tabIndex={-1}
        className={`flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-2xl bg-ivory text-ink shadow-2xl sm:max-h-[calc(100dvh-3rem)] ${sizes[size]}`}>
        <header className="flex shrink-0 items-start justify-between gap-4 bg-forest px-5 py-5 text-ivory sm:px-8">
          <div className="min-w-0">
            <h2 ref={titleRef} id={titleId} tabIndex={-1} className="break-words font-display text-3xl outline-none">{title}</h2>
            {description && <div id={descriptionId} className="mt-2 text-sm leading-6 text-ivory/75">{description}</div>}
          </div>
          <button type="button" aria-label="Fermer la fenêtre" disabled={pending} onClick={onClose}
            className="shrink-0 rounded-lg border border-ivory/35 p-2 hover:bg-ivory/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne disabled:cursor-wait disabled:opacity-50">
            <X size={19} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8">{children}</div>
        {footer && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-forest/10 bg-ivory px-5 py-4 sm:px-8">{footer}</footer>}
      </section>
    </div>, document.body,
  );
}
