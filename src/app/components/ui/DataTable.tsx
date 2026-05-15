import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";

export type Column<T> = {
  key: string;
  header: ReactNode;
  className?: string;
  headerClassName?: string;
  align?: "left" | "right" | "center";
  render: (row: T, index: number) => ReactNode;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: ReactNode;
  className?: string;
  dense?: boolean;
  stickyHeader?: boolean;
  maxHeight?: string;
};

const alignClass = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyTitle = "No records found",
  emptyDescription,
  emptyIcon,
  className = "",
  dense = false,
  stickyHeader = false,
  maxHeight,
}: Props<T>) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        bordered={false}
        className="py-16"
      />
    );
  }

  const cellPad = dense ? "px-4 py-2.5" : "px-5 py-3.5";
  const scrollStyle = maxHeight ? { maxHeight } : undefined;

  return (
    <div
      className={`overflow-x-auto ${stickyHeader ? "overflow-y-auto" : ""} ${className}`}
      style={scrollStyle}
    >
      <table className="min-w-full text-sm border-collapse">
        <thead
          className={`bg-slate-50 border-y border-slate-200 ${
            stickyHeader ? "sticky top-0 z-10" : ""
          }`}
        >
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`${cellPad} text-xs font-semibold uppercase tracking-wide text-slate-500 ${
                  alignClass[c.align ?? "left"]
                } ${c.headerClassName ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, idx) => (
            <tr
              key={rowKey(row, idx)}
              className="hover:bg-brand-50/30 transition-colors"
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`${cellPad} text-slate-700 ${
                    alignClass[c.align ?? "left"]
                  } ${c.className ?? ""}`}
                >
                  {c.render(row, idx)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
