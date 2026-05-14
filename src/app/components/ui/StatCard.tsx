import type { ComponentType, ReactNode } from "react";

type Tone = "brand" | "success" | "warning" | "danger" | "neutral" | "info";
type Size = "md" | "sm";

type Props = {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: Tone;
  size?: Size;
  accent?: boolean;
  trend?: {
    direction: "up" | "down" | "flat";
    label: string;
  };
  className?: string;
};

const iconTones: Record<Tone, string> = {
  brand:   "bg-brand-50 text-brand-700 border border-brand-100",
  success: "bg-success-50 text-success-700 border border-success-100",
  warning: "bg-warning-50 text-warning-700 border border-warning-100",
  danger:  "bg-danger-50 text-danger-700 border border-danger-100",
  neutral: "bg-slate-100 text-slate-700 border border-slate-200",
  info:    "bg-sky-50 text-sky-700 border border-sky-100",
};

const accentBars: Record<Tone, string> = {
  brand:   "bg-brand-500",
  success: "bg-success-600",
  warning: "bg-warning-600",
  danger:  "bg-danger-600",
  neutral: "bg-slate-400",
  info:    "bg-sky-500",
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
  size = "md",
  accent = false,
  trend,
  className = "",
}: Props) {
  const isSm = size === "sm";
  const pad = isSm ? "p-4" : "p-5";
  const valueSize = isSm ? "text-2xl" : "text-[28px]";
  const iconBox = isSm ? "w-9 h-9 rounded-lg" : "w-10 h-10 rounded-lg";
  const iconSize = isSm ? "w-4 h-4" : "w-5 h-5";

  return (
    <div
      className={`relative bg-white rounded-xl border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-all overflow-hidden ${pad} ${className}`}
    >
      {accent && (
        <span
          aria-hidden="true"
          className={`absolute left-0 top-0 bottom-0 w-[3px] ${accentBars[tone]}`}
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
            {label}
          </p>
          <p
            className={`mt-2 font-semibold text-slate-900 leading-none tracking-tight ${valueSize}`}
          >
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
            className={`${iconBox} flex items-center justify-center flex-shrink-0 ${iconTones[tone]}`}
          >
            <Icon className={iconSize} />
          </div>
        )}
      </div>
    </div>
  );
}
