import { useEffect, useRef, useState, type ReactNode } from "react";
import { AdminDialog } from "./AdminDialog";

type AdminConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  summary?: ReactNode;
  warning?: ReactNode;
  children?: ReactNode;
  pending?: boolean;
  error?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function AdminConfirmDialog({
  open, title, description, summary, warning, children, pending = false, error,
  confirmLabel = "Confirmer et continuer", cancelLabel = "Annuler", confirmDisabled = false,
  onCancel, onConfirm,
}: AdminConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState("");
  const busy = pending || confirming;
  useEffect(() => {
    if (open) setLocalError("");
  }, [open]);

  async function confirm() {
    if (pending || inFlight.current || confirmDisabled) return;
    inFlight.current = true;
    setConfirming(true);
    setLocalError("");
    try {
      await onConfirm();
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "Confirmation impossible.");
    } finally {
      inFlight.current = false;
      setConfirming(false);
    }
  }

  return <AdminDialog open={open} title={title} description={description} size="medium"
    pending={busy} initialFocusRef={cancelRef} onClose={onCancel}
    footer={<>
      <button ref={cancelRef} type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
      <button type="button" className="btn-primary" disabled={busy || confirmDisabled} onClick={() => void confirm()}>
        {busy ? "En cours…" : confirmLabel}
      </button>
    </>}>
    <div className="space-y-4">
      {summary && <div className="rounded-xl border border-forest/10 bg-cream p-4 text-sm">{summary}</div>}
      {warning && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{warning}</div>}
      {children && <fieldset disabled={busy} className="min-w-0">{children}</fieldset>}
      {(error || localError) && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error || localError}</p>}
    </div>
  </AdminDialog>;
}
