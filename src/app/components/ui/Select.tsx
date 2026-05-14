import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export const Select = forwardRef<HTMLSelectElement, Props>(function Select(
  { label, hint, error, className = "", id, children, ...rest },
  ref
) {
  const selectId = id || rest.name;
  const hasError = Boolean(error);

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={selectId}
          className="block text-sm font-medium text-slate-700 mb-1.5"
        >
          {label}
        </label>
      )}

      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          {...rest}
          className={`w-full h-10 appearance-none rounded-lg border bg-white pl-3 pr-9 text-sm text-slate-800 outline-none transition focus:ring-2 ${
            hasError
              ? "border-danger-600 focus:border-danger-600 focus:ring-danger-100"
              : "border-slate-300 focus:border-brand-500 focus:ring-brand-100"
          } ${className}`}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
      </div>

      {error ? (
        <p className="mt-1.5 text-xs text-danger-700">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
});
