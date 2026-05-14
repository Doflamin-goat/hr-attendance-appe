import type { HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  padded?: boolean;
};

export function Card({ padded = true, className = "", children, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${
        padded ? "p-6" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

type CardHeaderProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
};

export function CardHeader({ icon, title, description, actions, className = "" }: CardHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 flex-col sm:flex-row ${className}`}>
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center flex-shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {description && (
            <p className="text-sm text-slate-500 mt-0.5">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
