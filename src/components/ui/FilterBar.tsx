import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

export function FilterBar({ children, className = "" }: Props) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      {children}
    </div>
  );
}
