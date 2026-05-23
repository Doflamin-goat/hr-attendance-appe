import type { ReactNode } from "react";

type Props = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  bordered?: boolean;
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  bordered = true,
  className = "",
}: Props) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-6 py-12 rounded-2xl ${
        bordered ? "border border-dashed border-slate-200 bg-slate-50/50" : ""
      } ${className}`}
    >
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
