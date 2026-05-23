import type { ReactNode } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";

type Tone = "success" | "error" | "warning" | "info";

type Props = {
  tone: Tone;
  title?: string;
  message: ReactNode;
  onDismiss?: () => void;
  className?: string;
};

const tones: Record<
  Tone,
  { wrap: string; icon: ReactNode; defaultTitle: string }
> = {
  success: {
    wrap: "border-success-100 bg-success-50 text-success-700",
    icon: <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />,
    defaultTitle: "Success",
  },
  error: {
    wrap: "border-danger-100 bg-danger-50 text-danger-700",
    icon: <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />,
    defaultTitle: "Something went wrong",
  },
  warning: {
    wrap: "border-warning-100 bg-warning-50 text-warning-700",
    icon: <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />,
    defaultTitle: "Heads up",
  },
  info: {
    wrap: "border-brand-100 bg-brand-50 text-brand-700",
    icon: <Info className="w-5 h-5 mt-0.5 flex-shrink-0" />,
    defaultTitle: "Notice",
  },
};

export function AlertMessage({
  tone,
  title,
  message,
  onDismiss,
  className = "",
}: Props) {
  const t = tones[tone];

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${t.wrap} ${className}`}
    >
      {t.icon}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title ?? t.defaultTitle}</p>
        <p className="text-sm mt-0.5 leading-5">{message}</p>
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-current opacity-70 hover:opacity-100 transition"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
