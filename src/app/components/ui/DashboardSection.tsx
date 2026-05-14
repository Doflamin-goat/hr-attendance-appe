import type { ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function DashboardSection({
  eyebrow,
  title,
  description,
  actions,
  children,
  className = "",
}: Props) {
  return (
    <section className={`space-y-3 ${className}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-700 mb-1">
              {eyebrow}
            </p>
          )}
          <h2 className="text-base font-semibold text-slate-900 tracking-tight">
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </section>
  );
}
