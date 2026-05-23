import type { HTMLAttributes, ReactNode } from "react";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

type Props = HTMLAttributes<HTMLDivElement> & {
  title?: string;
  description?: string;
  icon?: ReactNode;
  iconTone?: Tone;
  actions?: ReactNode;
  footer?: ReactNode;
  padded?: boolean;
  density?: "comfortable" | "compact";
};

const iconTones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  brand: "bg-brand-50 text-brand-700",
  success: "bg-success-50 text-success-700",
  warning: "bg-warning-50 text-warning-700",
  danger: "bg-danger-50 text-danger-700",
  info: "bg-sky-50 text-sky-700",
};

export function DashboardCard({
  title,
  description,
  icon,
  iconTone = "brand",
  actions,
  footer,
  padded = true,
  density = "comfortable",
  className = "",
  children,
  ...rest
}: Props) {
  const showHeader = Boolean(title || description || icon || actions);
  const bodyPad =
    density === "compact" ? "px-4 py-3" : "px-5 py-4";
  const headerPad =
    density === "compact" ? "px-4 pt-4 pb-3" : "px-5 pt-5 pb-3";

  return (
    <div
      {...rest}
      className={`bg-white rounded-xl border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden ${className}`}
    >
      {showHeader && (
        <div
          className={`flex items-start justify-between gap-3 flex-col sm:flex-row ${headerPad}`}
        >
          <div className="flex items-start gap-3 min-w-0">
            {icon && (
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${iconTones[iconTone]}`}
              >
                {icon}
              </div>
            )}
            <div className="min-w-0">
              {title && (
                <h3 className="text-[15px] font-semibold text-slate-900 leading-snug truncate">
                  {title}
                </h3>
              )}
              {description && (
                <p className="mt-0.5 text-xs text-slate-500 leading-snug">
                  {description}
                </p>
              )}
            </div>
          </div>

          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
      )}

      <div className={padded ? bodyPad : ""}>{children}</div>

      {footer && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-sm text-slate-600">
          {footer}
        </div>
      )}
    </div>
  );
}
