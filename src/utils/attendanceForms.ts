export type HalfDayPeriod = "morning" | "afternoon";
export type UploadedAttendanceClassification =
  | { kind: "on_time" }
  | { kind: "late"; minutes: number; seconds: number; totalSeconds: number }
  | { kind: "undertime"; from: string; to: string; minutes: number }
  | { kind: "half_day"; period: "morning"; scheduledStart: string; scheduledEnd: string }
  | { kind: "unchanged" };

export function classifyUploadedTimeIn(date: string, hours: number, minutes: number, seconds: number): UploadedAttendanceClassification {
  const day = new Date(`${date}T00:00:00`).getDay();
  const minuteOfDay = hours * 60 + minutes;
  const secondOfDay = minuteOfDay * 60 + seconds;
  const result = (startMinutes: number, graceEnd: number, lateEnd: number, morningEnd: number, halfStart: number, halfEnd: number, halfScheduleEnd: number, afternoonStart: number, shiftEnd: number) => {
    if (minuteOfDay >= startMinutes && minuteOfDay <= graceEnd) return { kind: "on_time" } as const;
    if (minuteOfDay > graceEnd && minuteOfDay <= lateEnd) {
      const totalSeconds = secondOfDay - startMinutes * 60;
      return { kind: "late", minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60, totalSeconds } as const;
    }
    if (minuteOfDay > lateEnd && minuteOfDay <= morningEnd) return { kind: "undertime", from: minutesToTime(startMinutes), to: minutesToTime(minuteOfDay), minutes: minuteOfDay - startMinutes } as const;
    if (minuteOfDay >= halfStart && minuteOfDay <= halfEnd) return { kind: "half_day", period: "morning", scheduledStart: minutesToTime(startMinutes), scheduledEnd: minutesToTime(halfScheduleEnd) } as const;
    if (minuteOfDay > halfEnd && minuteOfDay <= shiftEnd) return { kind: "undertime", from: minutesToTime(afternoonStart), to: minutesToTime(minuteOfDay), minutes: minuteOfDay - afternoonStart } as const;
    return { kind: "unchanged" } as const;
  };
  if (day >= 1 && day <= 5) return result(480, 485, 539, 710, 711, 780, 720, 780, 1020);
  if (day === 6) return result(420, 425, 479, 650, 651, 660, 660, 660, 915);
  return { kind: "unchanged" };
}

function minutesToTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function parseAttendanceDateTime(value: string | number | Date) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 1) return null;
    const wholeDays = Math.floor(value);
    const dayFraction = value - wholeDays;
    const utc = new Date(Date.UTC(1899, 11, 30 + wholeDays));
    const seconds = Math.round(dayFraction * 86400);
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

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

export function formatTime12HourWithOptionalSeconds(value: string) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return value;
  const seconds = match[3] && match[3] !== "00" ? `:${match[3]}` : "";
  return `${hour % 12 || 12}:${match[2]}${seconds} ${hour >= 12 ? "PM" : "AM"}`;
}

export function halfDayMatchesScope(workDate: string, monthScope: string, dayScope: string) {
  return matchesDateScope(workDate, monthScope, dayScope);
}

export function normalizeAttendanceDate(value: string) {
  const trimmed = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (usMatch) {
    return `${usMatch[3]}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
  }

  return "";
}

export function matchesDateScope(dateValue: string, monthScope: string, dayScope: string) {
  const normalized = normalizeAttendanceDate(dateValue);
  if (!normalized) return false;
  if (dayScope !== "all") return normalized === normalizeAttendanceDate(dayScope);
  if (monthScope !== "all") return normalized.slice(0, 7) === monthScope;
  return true;
}

export function attendanceRecordRange(date: string, timeIn: string) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(timeIn.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  const meridiem = match[4]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  const result = classifyUploadedTimeIn(date, hour, minute, second);
  return result.kind === "undertime" ? result : null;
}

export function classifyGeneratedHalfDay(date: string, hours: number, minutes: number, seconds: number) {
  const result = classifyUploadedTimeIn(date, hours, minutes, seconds);
  return result.kind === "half_day" ? { period: result.period, scheduledStart: result.scheduledStart, scheduledEnd: result.scheduledEnd } : null;
}

export function generatedUndertimeMinutes(date: string, hours: number, minutes: number, seconds: number) {
  const result = classifyUploadedTimeIn(date, hours, minutes, seconds);
  return result.kind === "undertime" ? result.minutes : 0;
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
