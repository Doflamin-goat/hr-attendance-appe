function dateParts(value: string): [number, number, number] | null {
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  const local = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:\s|$)/);
  if (!local) return null;
  const year = Number(local[3]);
  return [year < 100 ? 2000 + year : year, Number(local[1]), Number(local[2])];
}

export function attendanceDateValue(value: string) {
  const parts = dateParts(value);
  if (!parts) return Number.POSITIVE_INFINITY;
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

export function attendanceTimeValue(value?: string) {
  if (!value) return 0;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return Number.POSITIVE_INFINITY;
  let hour = Number(match[1]);
  const period = match[4]?.toUpperCase();
  if (period) hour = hour % 12 + (period === "PM" ? 12 : 0);
  return hour * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
}

export function sortAttendanceDetailRecords<T extends { name: string; date: string; timeIn?: string }>(items: T[]) {
  return items.map((item, index) => ({ item, index })).sort((a, b) =>
    a.item.name.localeCompare(b.item.name) ||
    attendanceDateValue(a.item.date) - attendanceDateValue(b.item.date) ||
    attendanceTimeValue(a.item.timeIn) - attendanceTimeValue(b.item.timeIn) ||
    a.index - b.index
  ).map(({ item }) => item);
}

export function toExcelCalendarDate(value: string): Date | string {
  const parts = dateParts(value);
  return parts ? new Date(parts[0], parts[1] - 1, parts[2]) : value;
}

export function computeExcelColumnWidth(values: unknown[], minimum = 12, maximum = 38, padding = 2) {
  const longest = values.reduce<number>((length, value) => {
    const visible = value instanceof Date ? "09/25/2026" : value == null ? "" : String(value);
    return Math.max(length, visible.length);
  }, 0);
  return Math.min(maximum, Math.max(minimum, longest + padding));
}
