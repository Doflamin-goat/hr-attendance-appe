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

/** Match a biometric employee label to one Employee Master name when the
 * source contains a single-character spelling error (for example Rolan/Roldan).
 * The candidate must have the same token count and only one near-match token. */
export function attendanceNameMatchesEmployee(input: string, candidate: string) {
  const tokens = (value: string) => value.toLocaleLowerCase().replace(/[.,]/g, " ").trim().split(/\s+/).filter(Boolean);
  const left = tokens(input);
  const right = tokens(candidate);
  if (left.length !== right.length || left.length === 0) return false;
  let differences = 0;
  const distanceAtMostOne = (a: string, b: string) => {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0; let j = 0; let edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i += 1; j += 1; continue; }
      edits += 1;
      if (edits > 1) return false;
      if (a.length > b.length) i += 1;
      else if (b.length > a.length) j += 1;
      else { i += 1; j += 1; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  };
  left.forEach((token, index) => { if (!distanceAtMostOne(token, right[index])) differences += 1; });
  return differences <= 1;
}

const ATTENDANCE_FILE_DATE = /\battendance\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\b/i;
const ATTENDANCE_MONTHS = new Map([
  ["january", 0], ["february", 1], ["march", 2], ["april", 3], ["may", 4], ["june", 5],
  ["july", 6], ["august", 7], ["september", 8], ["october", 9], ["november", 10], ["december", 11],
]);

export function attendanceDateFromFileName(fileName: string) {
  const match = ATTENDANCE_FILE_DATE.exec(fileName);
  if (!match) return null;
  const month = ATTENDANCE_MONTHS.get(match[1].toLocaleLowerCase());
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month == null || !Number.isInteger(day) || !Number.isInteger(year)) return null;
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day ? date.getTime() : null;
}

export type UploadedAttendanceFileSortShape = {
  id?: string;
  fileName: string;
  uploadedAt: string;
  attendanceDates?: string[];
};

export function sortUploadedAttendanceFiles<T extends UploadedAttendanceFileSortShape>(files: T[]) {
  const attendanceTime = (file: T) => {
    const fromName = attendanceDateFromFileName(file.fileName);
    if (fromName != null) return fromName;
    const dates = (file.attendanceDates ?? []).map((value) => Date.parse(`${value.slice(0, 10)}T00:00:00`)).filter(Number.isFinite);
    return dates.length > 0 ? Math.max(...dates) : null;
  };
  return [...files].sort((a, b) => {
    const aAttendance = attendanceTime(a);
    const bAttendance = attendanceTime(b);
    if (aAttendance != null && bAttendance != null && aAttendance !== bAttendance) return bAttendance - aAttendance;
    if (aAttendance != null && bAttendance == null) return -1;
    if (aAttendance == null && bAttendance != null) return 1;
    const uploadedDifference = new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    if (Number.isFinite(uploadedDifference) && uploadedDifference !== 0) return uploadedDifference;
    return String(b.id ?? "").localeCompare(String(a.id ?? ""));
  });
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

export type DateFilterValue = "all" | string;

function calendarParts(value: string) {
  const normalized = normalizeAttendanceDate(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return { year: String(year), month: String(month).padStart(2, "0"), date: normalized, time: new Date(year, month - 1, day).getTime() };
}

export function matchesDateFilters(value: string, year: DateFilterValue, month: DateFilterValue, exactDate: DateFilterValue) {
  const parts = calendarParts(value);
  if (!parts) return false;
  return (year === "all" || parts.year === year) && (month === "all" || parts.month === month) && (exactDate === "all" || parts.date === normalizeAttendanceDate(exactDate));
}

export function dateFilterYears(values: string[]) {
  return [...new Set(values.map(calendarParts).filter(Boolean).map((item) => item!.year))].sort((a, b) => b.localeCompare(a));
}

export function dateFilterMonths(values: string[], year: DateFilterValue = "all") {
  return [...new Set(values.map(calendarParts).filter((item) => item && (year === "all" || item.year === year)).map((item) => item!.month))].sort();
}

export function dateFilterDates(values: string[], year: DateFilterValue = "all", month: DateFilterValue = "all") {
  return [...new Set(values.map(calendarParts).filter((item) => item && (year === "all" || item.year === year) && (month === "all" || item.month === month)).map((item) => item!.date))].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
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
