import type { ReactNode } from "react";

type Props = {
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  endMeta?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  actions,
  meta,
  endMeta,
  className = "",
}: Props) {
  return (
    <div
      className={`flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between ${className}`}
    >
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold tracking-tight text-slate-900 leading-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-sm text-slate-500 leading-relaxed max-w-2xl">
            {description}
          </p>
        )}
        {meta && <div className="mt-3">{meta}</div>}
      </div>

      {(endMeta || actions) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap lg:justify-end">
          {endMeta && (
            <div className="flex items-center">{endMeta}</div>
          )}
          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
      )}
    </div>
  );
}
