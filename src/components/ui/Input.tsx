import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, hint, error, leftIcon, rightIcon, className = "", id, ...rest },
  ref
) {
  const inputId = id || rest.name;
  const hasError = Boolean(error);

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-slate-700 mb-1.5"
        >
          {label}
        </label>
      )}

      <div className="relative">
        {leftIcon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            {leftIcon}
          </span>
        )}

        <input
          ref={ref}
          id={inputId}
          {...rest}
          className={`w-full h-10 rounded-lg border bg-white text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:ring-2 focus:ring-offset-0 ${
            leftIcon ? "pl-9" : "pl-3"
          } ${rightIcon ? "pr-9" : "pr-3"} ${
            hasError
              ? "border-danger-600 focus:border-danger-600 focus:ring-danger-100"
              : "border-slate-300 focus:border-brand-500 focus:ring-brand-100"
          } ${className}`}
        />

        {rightIcon && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
            {rightIcon}
          </span>
        )}
      </div>

      {error ? (
        <p className="mt-1.5 text-xs text-danger-700">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
});
