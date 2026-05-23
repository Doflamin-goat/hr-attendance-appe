import { useEffect } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "./Button";

type Tone = "danger" | "warning" | "primary";

type Props = {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const iconTones: Record<Tone, string> = {
  danger: "bg-danger-50 text-danger-700 border border-danger-100",
  warning: "bg-warning-50 text-warning-700 border border-warning-100",
  primary: "bg-brand-50 text-brand-700 border border-brand-100",
};

const buttonVariant: Record<Tone, "primary" | "danger" | "warning"> = {
  danger: "danger",
  warning: "warning",
  primary: "primary",
};

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel, loading]);

  if (!open) return null;

  return (
    <div
      className="ui-overlay-in fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="ui-modal-in w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${iconTones[tone]}`}
            >
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-900">
                {title}
              </h3>
              {description && (
                <p className="mt-1 text-sm text-slate-600 leading-5">
                  {description}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="text-slate-400 hover:text-slate-600 transition disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 mt-6 bg-slate-50 border-t border-slate-200">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={buttonVariant[tone]}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
