import { classifyUploadedTimeIn, parseAttendanceDateTime } from "./attendanceForms.ts";

export const MAIN_ATTENDANCE_HEADERS = ["Department", "Name", "No.", "Date/Time", "Status", "Location ID", "ID Number", "VerifyCode", "CardNo"] as const;

export type MainEmployeeMatch = { id: string; fullName: string; attendanceName?: string | null; biometricAliases?: string[]; startDate?: string | null; employmentStatus?: string; isDeleted?: boolean };
export type MainDailyAttendance = {
  id?: string;
  sourceFileId?: string | null; sourceFileName?: string | null;
  employeeId: string | null; employeeName: string; rawName: string; deviceNo: string | null;
  workDate: string; firstIn: string | null; lastOut: string | null;
  biometricLastOut?: string | null;
  biometricLastOutAt?: string | null;
  effectiveLastOutAt?: string | null;
  serviceEventId?: string | null;
  biometricFirstIn?: string | null;
  checkinSource?: "biometric" | "manual" | null;
  manualCheckinNote?: string | null;
  checkoutSource: "biometric" | "manual" | "service" | null;
  manualCheckoutNote?: string | null;
  status: "complete" | "missing_checkout" | "unmatched_employee";
  lateMinutes: number; lateSeconds: number; halfDay: boolean; undertimeMinutes: number;
};

export type MainAttendanceSourceLink = {
  dailyAttendanceId: string;
  sourceFileId: string;
};

const clean = (value: unknown) => String(value ?? "").trim();
export const normalizeMainName = (value: string) => value.normalize("NFKC").toLocaleUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");

function employeeNameKeys(name: string, attendanceName?: string | null, aliases: string[] = []) {
  const keys = new Set([normalizeMainName(name)]);
  const comma = name.indexOf(",");
  if (comma >= 0) keys.add(normalizeMainName(`${name.slice(comma + 1)} ${name.slice(0, comma)}`));
  if (attendanceName) keys.add(normalizeMainName(attendanceName));
  aliases.forEach((alias) => keys.add(normalizeMainName(alias)));
  return keys;
}

export function isMainAttendanceHeader(row: unknown[]) {
  const values = new Set(row.map((value) => clean(value).toLocaleLowerCase()));
  return MAIN_ATTENDANCE_HEADERS.every((header) => values.has(header.toLocaleLowerCase()));
}

export function isItcAttendanceRows(rows: unknown[][]) {
  return !rows.some(isMainAttendanceHeader) && rows.slice(4).some((row) => clean(row?.[2]) && parseAttendanceDateTime(row?.[4] as string | number | Date));
}

export function validateAttendanceFormat(scope: "ITC" | "MAIN", rows: unknown[][]) {
  const valid = scope === "MAIN" ? rows.some(isMainAttendanceHeader) : isItcAttendanceRows(rows);
  if (!valid) throw new Error(`This file does not match the ${scope === "MAIN" ? "MAIN Office" : "ITC Plant"} attendance format.`);
  return true;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeKey = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const seconds = (time: string) => { const [h, m, s = 0] = time.split(":").map(Number); return h * 3600 + m * 60 + s; };

export function checkoutUndertimeMinutes(date: string, checkout: string) {
  const day = new Date(`${date}T00:00:00`).getDay();
  const scheduled = day === 6 ? 15 * 60 + 15 : day >= 1 && day <= 5 ? 17 * 60 : null;
  if (scheduled == null) return 0;
  return Math.max(0, scheduled - Math.floor(seconds(checkout) / 60));
}

export function isValidFinalCheckout(checkout: string | null, checkIns: string[]) {
  if (!checkout) return false;
  const checkoutSeconds = seconds(checkout);
  return !checkIns.some((checkIn) => seconds(checkIn) > checkoutSeconds);
}

export function resolveManualCheckout(record: MainDailyAttendance, checkout: string): MainDailyAttendance {
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(checkout)) throw new Error("Enter a valid check-out time.");
  return { ...record, lastOut: checkout.length === 5 ? `${checkout}:00` : checkout, checkoutSource: "manual", status: record.employeeId ? "complete" : "unmatched_employee", undertimeMinutes: checkoutUndertimeMinutes(record.workDate, checkout) };
}

export function aggregateMainAttendance(rows: unknown[][], employees: MainEmployeeMatch[], deviceMappings: Record<string, string> = {}): MainDailyAttendance[] {
  const headerIndex = rows.findIndex(isMainAttendanceHeader);
  if (headerIndex < 0) throw new Error("This file does not match the MAIN Office attendance format.");
  const headers = rows[headerIndex].map((value) => clean(value).toLocaleLowerCase());
  const col = (name: string) => headers.indexOf(name.toLocaleLowerCase());
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const nameMatches = new Map<string, MainEmployeeMatch[]>();
  employees.filter((e) => !e.isDeleted && e.employmentStatus !== "inactive").forEach((employee) => employeeNameKeys(employee.fullName, employee.attendanceName, employee.biometricAliases).forEach((key) => nameMatches.set(key, [...(nameMatches.get(key) ?? []), employee])));
  const grouped = new Map<string, { rawName: string; deviceNo: string | null; date: string; employee?: MainEmployeeMatch; ins: string[]; outs: string[] }>();
  for (const row of rows.slice(headerIndex + 1)) {
    const rawName = clean(row[col("Name")]); const status = clean(row[col("Status")]).toLocaleLowerCase();
    const parsed = parseAttendanceDateTime(row[col("Date/Time")] as string | number | Date);
    if (!rawName || !parsed || (status !== "c/in" && status !== "c/out")) continue;
    const deviceNo = clean(row[col("No.")]) || null; const date = dateKey(parsed);
    const mapped = deviceNo ? employeeById.get(deviceMappings[deviceNo]) : undefined;
    const aliasMapped = employeeById.get(deviceMappings[`name:${normalizeMainName(rawName)}`]);
    const exact = nameMatches.get(normalizeMainName(rawName)) ?? [];
    const employee = mapped ?? aliasMapped ?? (exact.length === 1 ? exact[0] : undefined);
    const key = employee ? `employee:${employee.id}|${date}` : `unmatched:${normalizeMainName(rawName)}|${deviceNo ?? ""}|${date}`;
    const group = grouped.get(key) ?? { rawName, deviceNo, date, employee, ins: [], outs: [] };
    if (!group.deviceNo && deviceNo) group.deviceNo = deviceNo;
    (status === "c/in" ? group.ins : group.outs).push(timeKey(parsed)); grouped.set(key, group);
  }
  return [...grouped.values()].map((group): MainDailyAttendance => {
    const employee = group.employee;
    const firstIn = group.ins.sort((a, b) => seconds(a) - seconds(b))[0] ?? null;
    const lastOut = group.outs.sort((a, b) => seconds(b) - seconds(a))[0] ?? null;
    const validFinalCheckout = isValidFinalCheckout(lastOut, group.ins);
    let lateMinutes = 0, lateSeconds = 0, halfDay = false;
    if (firstIn) { const [h, m, s] = firstIn.split(":").map(Number); const result = classifyUploadedTimeIn(group.date, h, m, s); if (result.kind === "late") { lateMinutes = result.minutes; lateSeconds = result.seconds; } halfDay = result.kind === "half_day"; }
    return { employeeId: employee?.id ?? null, employeeName: employee?.attendanceName ?? employee?.fullName ?? group.rawName.toLocaleLowerCase().replace(/\b\w/g, (letter) => letter.toLocaleUpperCase()), rawName: group.rawName, deviceNo: group.deviceNo, workDate: group.date, firstIn, lastOut, biometricLastOut: lastOut, checkoutSource: lastOut ? "biometric" : null, status: employee ? (validFinalCheckout ? "complete" : "missing_checkout") : "unmatched_employee", lateMinutes, lateSeconds, halfDay, undertimeMinutes: validFinalCheckout && lastOut ? checkoutUndertimeMinutes(group.date, lastOut) : 0 };
  }).sort((a, b) => a.workDate.localeCompare(b.workDate) || a.employeeName.localeCompare(b.employeeName));
}

export function systemAbsenceEmployeeIds(employees: MainEmployeeMatch[], records: MainDailyAttendance[], date: string) {
  const present = new Set(records.filter((r) => r.workDate === date && r.employeeId && (r.firstIn || r.lastOut)).map((r) => r.employeeId));
  return employees.filter((e) => !e.isDeleted && e.employmentStatus !== "inactive" && (!e.startDate || e.startDate <= date) && !present.has(e.id)).map((e) => e.id);
}

export function activeMainAttendanceRecordIds(
  records: MainDailyAttendance[],
  activeSourceFileIds: ReadonlySet<string>,
  sourceLinks: MainAttendanceSourceLink[],
  activeSourceFileNames: ReadonlySet<string> = new Set(),
) {
  const linkedSources = new Map<string, string[]>();
  sourceLinks.forEach((link) => {
    linkedSources.set(link.dailyAttendanceId, [
      ...(linkedSources.get(link.dailyAttendanceId) ?? []),
      link.sourceFileId,
    ]);
  });

  return new Set(
    records
      .filter((record) => {
        const directSourceIsActive =
          record.sourceFileId != null && activeSourceFileIds.has(record.sourceFileId);
        const linkedSourceIsActive = (linkedSources.get(record.id ?? "") ?? []).some((sourceFileId) =>
          activeSourceFileIds.has(sourceFileId),
        );
        const nameSourceIsActive =
          record.sourceFileName != null &&
          activeSourceFileNames.has(record.sourceFileName);
        return directSourceIsActive || linkedSourceIsActive || nameSourceIsActive;
      })
      .map((record) => record.id)
      .filter((id): id is string => Boolean(id)),
  );
}

export function mainWorkDateOptions(records: MainDailyAttendance[]) {
  return [...new Set(records.map((record) => record.workDate))].sort((a, b) =>
    b.localeCompare(a),
  );
}
