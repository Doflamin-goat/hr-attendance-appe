import type { HTMLAttributes, ReactNode } from "react";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  icon?: ReactNode;
};

const tones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
  brand:   "bg-brand-50 text-brand-700 border-brand-100",
  success: "bg-success-50 text-success-700 border-success-100",
  warning: "bg-warning-50 text-warning-700 border-warning-100",
  danger:  "bg-danger-50 text-danger-700 border-danger-100",
  info:    "bg-sky-50 text-sky-700 border-sky-100",
};

export function Badge({ tone = "neutral", icon, className = "", children, ...rest }: Props) {
  return (
    <span
      {...rest}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}
