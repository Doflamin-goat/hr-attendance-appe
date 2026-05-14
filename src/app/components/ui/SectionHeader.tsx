import type { ReactNode } from "react";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

type Props = {
  icon?: ReactNode;
  iconTone?: Tone;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
};

const iconTones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  brand: "bg-brand-50 text-brand-700",
  success: "bg-success-50 text-success-700",
  warning: "bg-warning-50 text-warning-700",
  danger: "bg-danger-50 text-danger-700",
  info: "bg-sky-50 text-sky-700",
};

export function SectionHeader({
  icon,
  iconTone = "neutral",
  title,
  description,
  actions,
  className = "",
}: Props) {
  return (
    <div
      className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${iconTones[iconTone]}`}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900 truncate">
            {title}
          </h2>
          {description && (
            <p className="text-sm text-slate-500 mt-0.5">{description}</p>
          )}
        </div>
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
