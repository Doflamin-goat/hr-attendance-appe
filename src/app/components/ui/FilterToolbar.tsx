import { CalendarRange, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "./Button";
import { Select } from "./Select";

type Option = { value: string; label: string };

type Props = {
  monthValue: string;
  dayValue: string;
  monthOptions: Option[];
  dayOptions: Option[];
  scopeLabel: string;
  onChangeMonth: (value: string) => void;
  onChangeDay: (value: string) => void;
  onReset: () => void;
  canReset: boolean;
  className?: string;
};

export function FilterToolbar({
  monthValue,
  dayValue,
  monthOptions,
  dayOptions,
  scopeLabel,
  onChangeMonth,
  onChangeDay,
  onReset,
  canReset,
  className = "",
}: Props) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
        <div className="flex items-center gap-2 text-slate-700 lg:pb-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-600">
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">
            Filters
          </span>
        </div>

        <div className="hidden lg:block h-9 w-px bg-slate-200" />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-1 lg:items-end lg:gap-3">
          <div className="min-w-0 lg:w-56">
            <label className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 mb-1">
              Month
            </label>
            <Select
              aria-label="Filter by month"
              value={monthValue}
              onChange={(e) => onChangeMonth(e.target.value)}
            >
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="min-w-0 lg:w-60">
            <label className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 mb-1">
              Date
            </label>
            <Select
              aria-label="Filter by date"
              value={dayValue}
              onChange={(e) => onChangeDay(e.target.value)}
            >
              {dayOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 lg:ml-auto lg:pb-1">
          <div className="hidden md:flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
            <CalendarRange className="w-3.5 h-3.5 text-slate-500" />
            <div className="text-xs">
              <span className="text-slate-500">Showing </span>
              <span className="font-semibold text-slate-900">{scopeLabel}</span>
            </div>
          </div>

          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={onReset}
            disabled={!canReset}
          >
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
}
