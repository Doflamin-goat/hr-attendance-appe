export const ANNUAL_LEAVE_ENTITLEMENT_MINUTES = 5 * 8 * 60;
export const LEAVE_WORKDAY_MINUTES = 8 * 60;

type WorkSchedule = {
  start: number;
  end: number;
  unpaidBreaks: Array<{ start: number; end: number }>;
};

function scheduleForDate(date: string): WorkSchedule | null {
  const day = new Date(`${date}T00:00:00`).getDay();
  if (day === 0) return null;
  if (day === 6) return { start: 7 * 60, end: 15 * 60 + 15, unpaidBreaks: [] };
  return {
    start: 8 * 60,
    end: 17 * 60,
    unpaidBreaks: [{ start: 12 * 60, end: 13 * 60 }],
  };
}

function parseTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function overlap(start: number, end: number, rangeStart: number, rangeEnd: number) {
  return Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart));
}

export function calculateLeaveDuration(date: string, startTime: string, endTime: string) {
  const schedule = scheduleForDate(date);
  const requestedStart = parseTime(startTime);
  const requestedEnd = parseTime(endTime);
  if (!schedule) return { minutes: 0, error: "Sunday has no configured work schedule." };
  if (requestedStart === null || requestedEnd === null) return { minutes: 0, error: "Enter valid start and end times." };
  if (requestedEnd <= requestedStart) return { minutes: 0, error: "End time must be later than start time." };

  const effectiveStart = Math.max(requestedStart, schedule.start);
  const effectiveEnd = Math.min(requestedEnd, schedule.end);
  let minutes = Math.max(0, effectiveEnd - effectiveStart);
  for (const unpaidBreak of schedule.unpaidBreaks) {
    minutes -= overlap(effectiveStart, effectiveEnd, unpaidBreak.start, unpaidBreak.end);
  }
  if (minutes <= 0) return { minutes: 0, error: "The selected range contains no chargeable working time." };
  return { minutes, error: null };
}

export function formatLeaveMinutes(totalMinutes: number) {
  const safe = Math.max(0, Math.round(totalMinutes));
  const days = Math.floor(safe / LEAVE_WORKDAY_MINUTES);
  const afterDays = safe % LEAVE_WORKDAY_MINUTES;
  const hours = Math.floor(afterDays / 60);
  const minutes = afterDays % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  return parts.join(" ") || "0 minutes";
}

export function formatLeaveRequestDuration(date: string, startTime: string, endTime: string, durationMinutes: number) {
  const day = new Date(`${date}T00:00:00`).getDay();
  if (day === 6 && startTime.slice(0, 5) === "07:00" && endTime.slice(0, 5) === "15:15" && durationMinutes === 495) return "1 day";
  return formatLeaveMinutes(durationMinutes);
}

export function formatLeaveDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : date;
}

export function formatLeaveTime(time: string) {
  const match = /^(\d{2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hour = Number(match[1]);
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${String(displayHour).padStart(2, "0")}:${match[2]} ${period}`;
}

export function formatLeaveStatus(status: "pending" | "approved" | "rejected") {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function leaveYear(date: string) {
  return Number(date.slice(0, 4));
}

export function leaveBalance(adjustmentMinutes: number, approvedMinutes: number) {
  return Math.max(0, ANNUAL_LEAVE_ENTITLEMENT_MINUTES + adjustmentMinutes - approvedMinutes);
}

export function adjustmentPartsToMinutes(days: number, hours: number, minutes: number) {
  return Math.max(0, Math.trunc(days)) * LEAVE_WORKDAY_MINUTES + Math.max(0, Math.trunc(hours)) * 60 + Math.max(0, Math.trunc(minutes));
}

export function remainingLeaveAdjustment(remainingMinutes: number, approvedMinutes: number) {
  return remainingMinutes + approvedMinutes - ANNUAL_LEAVE_ENTITLEMENT_MINUTES;
}

export function calculateAnnualLeaveTotals(records: Array<{ leaveDate: string; status: "pending" | "approved" | "rejected"; durationMinutes: number }>, year: number, adjustmentMinutes: number) {
  const annual = records.filter((item) => Number(item.leaveDate.slice(0, 4)) === year);
  const approved = annual.filter((item) => item.status === "approved").reduce((sum, item) => sum + item.durationMinutes, 0);
  const pending = annual.filter((item) => item.status === "pending").reduce((sum, item) => sum + item.durationMinutes, 0);
  return { adjustment: adjustmentMinutes, approved, pending, remaining: leaveBalance(adjustmentMinutes, approved) };
}

export function countRejectedLeaveRequests(
  records: Array<{ employeeId: string; leaveDate: string; status: "pending" | "approved" | "rejected"; workspace?: string; isDeleted?: boolean }>,
  employeeId: string,
  year: number,
  workspace?: string,
) {
  return records.filter((item) => item.employeeId === employeeId && Number(item.leaveDate.slice(0, 4)) === year && item.status === "rejected" && item.isDeleted !== true && (!workspace || item.workspace === workspace)).length;
}
