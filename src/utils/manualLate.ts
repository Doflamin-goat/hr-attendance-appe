// =============================================================================
// Manual late compute helper.
//
// Small self-contained utility used only by:
//   - The "Add Manual Late" modal on Late Records (live preview).
//   - AttendanceContext.addManualLate (server-side validation of the
//     "is this actually late?" gate).
//
// Independent from the Excel-upload late detection rules, which remain
// hard-coded (Mon–Fri 08:00 / Sat 07:00, 6-minute grace) in AttendanceContext.
// =============================================================================

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseHMS(value: string): { h: number; m: number; s: number } {
  const [hStr = "0", mStr = "0", sStr = "0"] = value.split(":");
  return { h: Number(hStr) || 0, m: Number(mStr) || 0, s: Number(sStr) || 0 };
}

function formatHM(h: number, m: number): string {
  return `${pad2(h)}:${pad2(m)}`;
}

/**
 * Parse a free-form time-in string ("8:15", "8:15:03", "08:15 AM",
 * "8:15:03 PM") into 24-hour hours / minutes / seconds. Returns null on
 * a value we cannot understand.
 */
export function parseTimeInput(
  value: string
): { h: number; m: number; s: number } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(
    /^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?\s*(am|pm)?$/i
  );
  if (!match) return null;

  let h = Number(match[1]);
  const m = Number(match[2] ?? "0");
  const s = Number(match[3] ?? "0");
  const period = match[4]?.toUpperCase();

  if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) return null;

  if (period === "PM" && h < 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  if (h > 23) return null;

  return { h, m, s };
}

export function formatTimeIn12h(h: number, m: number, s: number): string {
  const period = h >= 12 ? "PM" : "AM";
  let display = h % 12;
  if (display === 0) display = 12;
  return `${display}:${pad2(m)}:${pad2(s)} ${period}`;
}

/**
 * Compute a manual late using an explicit official start / grace pair.
 * Returns `isLate: false` (with zero durations) when the given time-in
 * does not exceed the late threshold — callers must refuse to save in
 * that case.
 */
export function computeManualLate(params: {
  timeIn: string;
  officialStartTime: string;
  graceMinutes: number;
}): {
  isLate: boolean;
  minutesLate: number;
  secondsLate: number;
  totalSecondsLate: number;
  officialStartTime: string;
  lateStartTime: string;
  normalizedTimeIn: string | null;
} {
  const parsedTimeIn = parseTimeInput(params.timeIn);
  const parsedStart = parseHMS(params.officialStartTime);
  const officialStartTime = formatHM(parsedStart.h, parsedStart.m);
  const lateTotalMin =
    parsedStart.h * 60 + parsedStart.m + params.graceMinutes;
  const lateStartTime = formatHM(
    Math.floor(lateTotalMin / 60),
    lateTotalMin % 60
  );

  if (!parsedTimeIn) {
    return {
      isLate: false,
      minutesLate: 0,
      secondsLate: 0,
      totalSecondsLate: 0,
      officialStartTime,
      lateStartTime,
      normalizedTimeIn: null,
    };
  }

  const officialSeconds = parsedStart.h * 3600 + parsedStart.m * 60;
  const lateStartSeconds = officialSeconds + params.graceMinutes * 60;
  const totalSeconds =
    parsedTimeIn.h * 3600 + parsedTimeIn.m * 60 + parsedTimeIn.s;

  const normalizedTimeIn = formatTimeIn12h(
    parsedTimeIn.h,
    parsedTimeIn.m,
    parsedTimeIn.s
  );

  if (totalSeconds < lateStartSeconds) {
    return {
      isLate: false,
      minutesLate: 0,
      secondsLate: 0,
      totalSecondsLate: 0,
      officialStartTime,
      lateStartTime,
      normalizedTimeIn,
    };
  }

  const totalSecondsLate = totalSeconds - officialSeconds;
  return {
    isLate: true,
    minutesLate: Math.floor(totalSecondsLate / 60),
    secondsLate: totalSecondsLate % 60,
    totalSecondsLate,
    officialStartTime,
    lateStartTime,
    normalizedTimeIn,
  };
}
