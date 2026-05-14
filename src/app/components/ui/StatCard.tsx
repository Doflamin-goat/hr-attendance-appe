import type { ComponentType, ReactNode } from "react";

type Tone = "brand" | "success" | "warning" | "danger" | "neutral" | "info";

type Props = {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: Tone;
  trend?: {
    direction: "up" | "down" | "flat";
    label: string;
  };
  className?: string;
};

const iconTones: Record<Tone, string> = {
  brand:   "bg-brand-50 text-brand-700",
  success: "bg-success-50 text-success-700",
  warning: "bg-warning-50 text-warning-700",
  danger:  "bg-danger-50 text-danger-700",
  neutral: "bg-slate-100 text-slate-700",
  info:    "bg-sky-50 text-sky-700",
};

const trendTones: Record<"up" | "down" | "flat", string> = {
  up:   "text-success-700",
  down: "text-danger-700",
  flat: "text-slate-500",
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "brand",
  trend,
  className = "",
}: Props) {
  return (
    <div
      className={`bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-start justify-between gap-4 ${className}`}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p className="mt-2 text-3xl font-semibold text-slate-900 leading-none">
          {value}
        </p>
        {(hint || trend) && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            {trend && (
              <span className={`font-medium ${trendTones[trend.direction]}`}>
                {trend.label}
              </span>
            )}
            {hint && <span className="text-slate-500">{hint}</span>}
          </div>
        )}
      </div>

      {Icon && (
        <div
          className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${iconTones[tone]}`}
        >
          <Icon className="w-5 h-5" />
        </div>
      )}
    </div>
  );
}
