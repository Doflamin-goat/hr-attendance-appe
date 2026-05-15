import { Badge } from "./Badge";

export type StatusKind =
  | "active"
  | "inactive"
  | "unregistered"
  | "late"
  | "absent"
  | "exempted"
  | "undertime"
  | "memo"
  | "app"
  | "wais";

type Props = {
  kind: StatusKind;
  label?: string;
  className?: string;
};

const config: Record<
  StatusKind,
  { tone: "neutral" | "brand" | "success" | "warning" | "danger" | "info"; label: string }
> = {
  active:       { tone: "success", label: "Active" },
  inactive:     { tone: "neutral", label: "Inactive" },
  unregistered: { tone: "warning", label: "Unregistered" },
  late:         { tone: "warning", label: "Late" },
  absent:       { tone: "danger",  label: "Absent" },
  exempted:     { tone: "success", label: "Exempted" },
  undertime:    { tone: "info",    label: "Undertime" },
  memo:         { tone: "danger",  label: "Memo Required" },
  app:          { tone: "brand",   label: "APP" },
  wais:         { tone: "info",    label: "WAIS" },
};

export function StatusBadge({ kind, label, className }: Props) {
  const c = config[kind];
  return (
    <Badge tone={c.tone} className={className}>
      {label ?? c.label}
    </Badge>
  );
}
