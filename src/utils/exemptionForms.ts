export function formatOptionalReportedTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.exec(value.trim());
  return match ? match[0].slice(0, 5) : undefined;
}

export function describeSubmitExemptionError(error: unknown): string {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message = typeof candidate?.message === "string" ? candidate.message.toLowerCase() : "";

  if (code === "PGRST202" || code === "42883" || message.includes("could not find the function")) {
    return "The exemption submission service is unavailable or has a different database contract. Ask an administrator to verify the service deployment.";
  }
  if (message.includes("only hr") || message.includes("permission")) {
    return "Only an HR account can submit an exemption.";
  }
  if (message.includes("employee and late record must match") || message.includes("active employee")) {
    return "The employee and selected late record must be active and match exactly.";
  }
  if (code === "23505" || message.includes("duplicate") || message.includes("unique")) {
    return "An active exemption already exists for the selected late record.";
  }
  if (message.includes("time") || code === "22007" || code === "22008") {
    return "Enter a valid optional reported time, or leave it blank.";
  }
  return "The exemption could not be submitted. Refresh the page and try again; if it continues, ask an administrator to verify the submission service.";
}

type MatchingLate = {
  id: string;
  name: string;
  date: string;
  workDate?: string;
  workspace?: string;
  isDeleted?: boolean;
  sourceType?: string;
  timeIn?: string;
  minutesLate?: number;
};

type LinkedExemption = {
  lateRecordId?: string;
  approvalStatus?: "pending" | "approved" | "declined";
};

export function matchingLinkedLateRecords(
  records: MatchingLate[],
  exemptions: LinkedExemption[],
  employeeName: string,
  workDate: string
) {
  const linkedLateIds = new Set(
    exemptions
      .filter((exemption) => exemption.approvalStatus === "pending" || exemption.approvalStatus === "approved")
      .map((exemption) => exemption.lateRecordId)
      .filter((id): id is string => Boolean(id))
  );

  return records.filter((record) =>
    record.sourceType === "excel-upload" &&
    record.isDeleted === false &&
    normalizeEmployeeName(record.name) === normalizeEmployeeName(employeeName) &&
    record.workDate === workDate &&
    !linkedLateIds.has(record.id)
  );
}

export function normalizeEmployeeName(value: string) {
  return value.trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
}

export function resolveEmployeeForLate<T extends { id: string; workspace: string; fullName: string }>(
  employees: T[],
  late: { workspace?: string; name: string } | undefined
) {
  if (!late?.workspace) return undefined;
  return employees.find((employee) =>
    employee.workspace === late.workspace &&
    normalizeEmployeeName(employee.fullName) === normalizeEmployeeName(late.name)
  );
}
