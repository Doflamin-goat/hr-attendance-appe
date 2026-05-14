import { forwardRef, type TextareaHTMLAttributes } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export const Textarea = forwardRef<HTMLTextAreaElement, Props>(function Textarea(
  { label, hint, error, className = "", id, ...rest },
  ref
) {
  const fieldId = id || rest.name;
  const hasError = Boolean(error);

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={fieldId}
          className="block text-sm font-medium text-slate-700 mb-1.5"
        >
          {label}
        </label>
      )}

      <textarea
        ref={ref}
        id={fieldId}
        rows={4}
        {...rest}
        className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:ring-2 resize-y ${
          hasError
            ? "border-danger-600 focus:border-danger-600 focus:ring-danger-100"
            : "border-slate-300 focus:border-brand-500 focus:ring-brand-100"
        } ${className}`}
      />

      {error ? (
        <p className="mt-1.5 text-xs text-danger-700">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
});
