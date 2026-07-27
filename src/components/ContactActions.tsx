import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Mail, MessageSquare, Phone } from "lucide-react";
import { verdanzaPublicContact, verdanzaSmsHref } from "../config/publicContact";
import { trackContactHelpAction, type ContactHelpSource } from "../lib/analytics";

type ContactActionsVariant = "full" | "compact" | "panel";

export function ContactActions({
  source,
  variant = "full",
  showContactLink = true,
  contactLabel = "Nous écrire",
  contactPath = verdanzaPublicContact.contactPath,
  phoneLabel,
  className = "",
  onAction,
}: {
  source: ContactHelpSource;
  variant?: ContactActionsVariant;
  showContactLink?: boolean;
  contactLabel?: string;
  contactPath?: string;
  phoneLabel?: string;
  className?: string;
  onAction?: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const isPanel = variant === "panel";
  const isCompact = variant === "compact";
  const buttonClass = isPanel
    ? "inline-flex min-h-11 w-full items-center justify-start gap-3 rounded-md border border-forest/10 bg-ivory px-4 py-3 text-sm font-semibold text-forest transition hover:border-champagne focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2"
    : isCompact
      ? "btn-secondary min-h-11 px-3 py-2"
      : "btn-secondary";

  useEffect(() => {
    if (!copyStatus) return undefined;
    statusRef.current?.focus();
    const timeout = window.setTimeout(() => setCopyStatus(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  async function handleCopy() {
    const copied = await copyPhoneNumber();
    setCopyStatus(copied ? "Numéro copié" : "Copie indisponible, numéro affiché ci-dessus.");
    trackContactHelpAction("contact_phone_copy", source);
  }

  function handleAction(eventName: "contact_phone_click" | "contact_sms_click" | "contact_form_click") {
    trackContactHelpAction(eventName, source);
    onAction?.();
  }

  return (
    <div className={className}>
      <div
        className={
          isPanel
            ? "grid gap-2"
            : isCompact
              ? "flex flex-wrap gap-2"
              : "flex flex-wrap gap-3"
        }
      >
        <a
          className={buttonClass}
          href={verdanzaPublicContact.phoneHref}
          onClick={() => handleAction("contact_phone_click")}
        >
          <Phone size={17} aria-hidden="true" />
          <span>{phoneLabel || `Appeler ${verdanzaPublicContact.displayPhone}`}</span>
        </a>
        <a
          className={buttonClass}
          href={verdanzaSmsHref}
          onClick={() => handleAction("contact_sms_click")}
        >
          <MessageSquare size={17} aria-hidden="true" />
          <span>Envoyer un SMS</span>
        </a>
        <button type="button" className={buttonClass} onClick={() => void handleCopy()}>
          <Copy size={17} aria-hidden="true" />
          <span>Copier le numéro</span>
        </button>
        {showContactLink && contactPath.startsWith("#") && (
          <a
            className={buttonClass}
            href={contactPath}
            onClick={() => handleAction("contact_form_click")}
          >
            <Mail size={17} aria-hidden="true" />
            <span>{contactLabel}</span>
          </a>
        )}
        {showContactLink && !contactPath.startsWith("#") && (
          <Link
            className={buttonClass}
            to={contactPath}
            onClick={() => handleAction("contact_form_click")}
          >
            <Mail size={17} aria-hidden="true" />
            <span>{contactLabel}</span>
          </Link>
        )}
      </div>
      <p
        ref={statusRef}
        className="mt-3 text-sm font-medium text-forest"
        role="status"
        aria-live="polite"
        tabIndex={-1}
      >
        {copyStatus}
      </p>
    </div>
  );
}

async function copyPhoneNumber() {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(verdanzaPublicContact.displayPhone);
      return true;
    } catch {
      // Fall through to the textarea fallback.
    }
  }

  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = verdanzaPublicContact.displayPhone;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
