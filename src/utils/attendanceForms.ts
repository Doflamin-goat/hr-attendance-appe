export type HalfDayPeriod = "morning" | "afternoon";

export function durationMinutes(from: string, to: string) {
  const toMinutes = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : NaN;
  };
  const result = toMinutes(to) - toMinutes(from);
  return result > 0 ? result : 0;
}

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `${hours} hour${hours === 1 ? "" : "s"}${remaining ? ` ${remaining} minute${remaining === 1 ? "" : "s"}` : ""}`;
}

export function halfDayRange(date: string, period: HalfDayPeriod) {
  const day = new Date(`${date}T00:00:00`).getDay();
  if (day === 0) return null;
  if (day === 6) return period === "morning" ? ["07:00", "11:00"] : ["11:00", "15:15"];
  return period === "morning" ? ["08:00", "12:00"] : ["13:00", "17:00"];
}

export function formatTime12Hour(value: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return value;
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
}

export function classifyGeneratedHalfDay(date: string, hours: number, minutes: number, seconds: number) {
  const day = new Date(`${date}T00:00:00`).getDay();
  if (day === 0) return null;
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  const start = day === 6 ? 11 * 3600 : 12 * 3600;
  const end = day === 6 ? start : 13 * 3600;
  if (totalSeconds < start || totalSeconds > end) return null;
  const [scheduledStart, scheduledEnd] = halfDayRange(date, "afternoon")!;
  return { period: "afternoon" as const, scheduledStart, scheduledEnd };
}

export function generatedUndertimeMinutes(date: string, hours: number, minutes: number, seconds: number) {
  const day = new Date(`${date}T00:00:00`).getDay();
  if (day === 0) return 0;
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  const threshold = day === 6 ? 11 * 3600 : 13 * 3600;
  return totalSeconds > threshold ? Math.floor((totalSeconds - threshold) / 60) : 0;
}

export function activeEmployeeOptions<T extends { fullName: string; employmentStatus: string; isDeleted: boolean }>(employees: T[]) {
  return employees.filter((employee) => employee.employmentStatus === "active" && !employee.isDeleted);
}

export function countUndertimeRecords(
  employeeName: string,
  generated: Array<{ name: string; isDeleted?: boolean }>,
  manual: Array<{ name: string; isDeleted?: boolean }>,
) {
  const key = employeeName.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  return [...generated, ...manual].filter(
    (record) =>
      !record.isDeleted &&
      record.name.trim().toLocaleLowerCase().replace(/\s+/g, " ") === key,
  ).length;
}
