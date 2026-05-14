import { CalendarRange, RotateCcw } from "lucide-react";
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
      className={`flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:flex-wrap ${className}`}
    >
      <div className="flex items-center gap-2 text-slate-500 px-1">
        <CalendarRange className="w-4 h-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">
          Filters
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-1 sm:min-w-0">
        <div className="w-full sm:w-52">
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

        <div className="w-full sm:w-60">
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

      <div className="flex items-center justify-between gap-2 sm:ml-auto">
        <div className="text-xs text-slate-500">
          <span className="font-medium text-slate-500">Scope:</span>{" "}
          <span className="font-semibold text-slate-900">{scopeLabel}</span>
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
  );
}
