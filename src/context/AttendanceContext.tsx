import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { computeExcelColumnWidth, sortAttendanceDetailRecords, toExcelCalendarDate } from "../utils/exportRows";
import { useAuth } from "./AuthContext";
import { useEmployees } from "./EmployeesContext";
import {
  clearWorkspaceAttendanceData,
  createDeleteBatchId,
  deleteAbsenceRecord,
  deleteMainSystemGeneratedAbsence,
  deleteAbsencesByMonthFromDatabase,
  deleteExemptionRecord,
  deleteExemptionsByMonthFromDatabase,
  deleteManualUndertimeRecord,
  deleteManualUndertimesByMonthFromDatabase,
  deleteUploadedAttendanceFile,
  describeSupabaseError,
  loadAttendanceData,
  loadDeletedAttendanceData,
  restoreApprovedExemptionLate,
  permanentlyDeleteRecycleBinItem,
  restoreManualHrRecord,
  restoreUploadedFileBatch,
  saveAbsenceRecord,
  updateMainSystemGeneratedAbsence,
  saveManualUndertimeRecord,
  saveMemoReads,
  saveUploadedAttendanceFile,
  updateGeneratedUndertimeDetails,
  type DeletedAttendanceData,
  type DeletedManualHrType,
  loadMainDailyAttendance,
  loadMainBiometricMappings,
  saveMainAttendanceImport,
  saveMainManualCheckin,
  saveMainManualCheckout,
  saveMainBiometricMapping,
  deleteMainAttendanceUpload,
  reconcileMainUnmatchedAttendance,
  reconcileMainActiveUploadRecords,
} from "../services/attendanceService";
import {
  addManualLateRecord,
  loadManualLateRecords,
  softDeleteManualLateRecord,
} from "../services/manualLateService";
import { computeManualLate } from "../utils/manualLate";
import { attendanceNameMatchesEmployee, classifyUploadedTimeIn, matchesDateScope, normalizeAttendanceDate, parseAttendanceDateTime } from "../utils/attendanceForms";
import { aggregateMainAttendance, isItcAttendanceRows, isMainAttendanceHeader, mainWorkDateOptions, type MainDailyAttendance } from "../utils/mainAttendance";
import { toast } from "../components/ui";


export type LateRecordSourceType = "excel-upload" | "manual-entry";

export interface LateRecord {
  id: string;
  employeeId?: string;
  name: string;
  date: string;
  timeIn: string;
  minutesLate: number;
  secondsLate: number;
  totalSecondsLate: number;
  sourceFileId: string;
  sourceFileName: string;
  sourceType?: LateRecordSourceType;
  workspace?: "APP" | "WAIS";
  isDeleted?: boolean;
  workDate?: string;
}

export interface ManualLateRecord {
  id: string;
  name: string;
  date: string;
  timeIn: string;
  officialStartTime: string | null;
  graceMinutes: number;
  minutesLate: number;
  secondsLate: number;
  totalSecondsLate: number;
  reason: string | null;
  sourceType: string;
}

export interface LateSummary {
  name: string;
  totalLates: number;
  totalMinutesLate: number;
}

export interface GeneratedUndertime {
  id: string;
  employeeId?: string;
  name: string;
  date: string;
  timeIn: string;
  sourceFileId: string;
  sourceFileName: string;
  minutesUndertime?: number;
  reason?: string;
  informed?: string[];
}

export interface GeneratedHalfDay {
  name: string;
  date: string;
  period: "morning" | "afternoon";
  scheduledStart: string;
  scheduledEnd: string;
  reason: string;
  sourceFileName: string;
}

export interface Exemption {
  id: string;
  employeeId?: string;
  name: string;
  reason: string;
  date: string;
  minutesLate?: number;
  time?: string;
  informed?: string[];
  approvalStatus?: "pending" | "approved" | "declined";
  lateRecordId?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewRemarks?: string;
  lateTime?: string;
  lateRestoredAt?: string;
  lateRestoredBy?: string;
  sourceType?: "individual" | "date_rule";
  dateRuleId?: string;
}

export interface AbsentRecord {
  id: string;
  name: string;
  date: string;
  reason: string;
  informed?: string[];
  sourceType?: "manual" | "system_generated";
  employeeId?: string;
}

export interface UndertimeRecord {
  id: string;
  employeeId?: string;
  name: string;
  date: string;
  reason: string;
  undertimeHours: string;
  sourceLateRecordId?: string;
  sourceAttendanceRecordId?: string;
  originalTimeIn?: string;
  sourceType?: "manual-entry" | "late-conversion";
  isManualOverride?: boolean;
  informed?: string[];
}

export interface MemoAlert {
  id: string;
  name: string;
  totalLates: number;
  totalMinutesLate: number;
  message: string;
  isRead: boolean;
}

export interface UploadedAttendanceFile {
  id: string;
  fileName: string;
  uploadedAt: string;
  lateRecords: LateRecord[];
  generatedUndertimes: GeneratedUndertime[];
}

interface PersistedAttendanceData {
  fileName: string;
  uploadedFiles: UploadedAttendanceFile[];
  exemptions: Exemption[];
  absences: AbsentRecord[];
  manualUndertimes: UndertimeRecord[];
  readMemoEmployeeNames: string[];
  selectedMonthScope: string;
  selectedDayScope: string;
}

interface AttendanceState {
  loading: boolean;
  fileName: string;
  uploadedFiles: UploadedAttendanceFile[];
  allLateRecords: LateRecord[];
  lateRecords: LateRecord[];
  lateSummary: LateSummary[];
  generatedUndertimes: GeneratedUndertime[];
  exemptions: Exemption[];
  absences: AbsentRecord[];
  manualUndertimes: UndertimeRecord[];
  memoAlerts: MemoAlert[];
  unreadMemoCount: number;
  monthScopeOptions: string[];
  dayScopeOptions: string[];
  selectedMonthScope: string;
  selectedDayScope: string;
  setSelectedMonthScope: (scope: string) => void;
  setSelectedDayScope: (scope: string) => void;
  refreshAttendanceData: () => Promise<void>;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  mainDailyAttendance: MainDailyAttendance[];
  saveManualCheckin: (recordId: string, checkinTime: string, note?: string) => Promise<{ success: boolean; message: string }>;
  saveManualCheckout: (recordId: string, checkoutTime: string, note?: string) => Promise<{ success: boolean; message: string }>;
  mapMainEmployee: (recordId: string, employeeId: string) => Promise<{ success: boolean; message: string }>;
  reconcileMainUnmatched: () => Promise<{ success: boolean; message: string }>;
  cleanMainStaleRecords: () => Promise<{ success: boolean; message: string }>;
  addExemption: (ex: Omit<Exemption, "id">) => {
    success: boolean;
    message: string;
  };
  addAbsence: (ab: Omit<AbsentRecord, "id">) => Promise<{
    success: boolean;
    message: string;
  }>;
  addUndertime: (ut: Omit<UndertimeRecord, "id">) => Promise<{
    success: boolean;
    message: string;
  }>;
  convertLateToUndertime: (payload: {
    lateRecordId: string;
    undertimeHours: string;
    reason?: string;
    isManualOverride?: boolean;
  }) => Promise<{
    success: boolean;
    message: string;
  }>;
  deleteUploadedFile: (fileId: string) => Promise<{ success: boolean; message: string; warning?: string }>;
  deleteExemption: (id: string) => Promise<{ success: boolean; message: string }>;
  deleteAbsence: (id: string) => Promise<{ success: boolean; message: string }>;
  updateMainSystemGeneratedAbsence: (id: string, reason: string, informed: string[]) => Promise<{ success: boolean; message: string }>;
  deleteMainSystemGeneratedAbsence: (id: string) => Promise<{ success: boolean; message: string }>;
  deleteManualUndertime: (id: string) => Promise<{ success: boolean; message: string }>;
  updateGeneratedUndertimeDetails: (id: string, reason: string, informed: string[]) => Promise<{ success: boolean; message: string }>;

  // Manual late records (migration 005)
  manualLateRecords: ManualLateRecord[];
  addManualLate: (input: {
    name: string;
    workDate: string;
    timeIn: string;
    officialStartTime: string;
    graceMinutes: number;
    reason: string;
  }) => Promise<{ success: boolean; message: string }>;
  deleteManualLate: (id: string) => Promise<{ success: boolean; message: string }>;
  clearAllAttendanceHistory: () => Promise<{ success: boolean; message: string }>;
  deleteAbsencesByMonth: (monthKey: string) => Promise<{ success: boolean; message: string }>;
  deleteExemptionsByMonth: (monthKey: string) => Promise<{ success: boolean; message: string }>;
  deleteManualUndertimesByMonth: (monthKey: string) => Promise<{ success: boolean; message: string }>;
  restoreExemptionLate: (id: string) => Promise<void>;
  removeManualUndertimeAdjustment: (id: string) => Promise<{ success: boolean; message: string }>;
  markAllMemoAlertsAsRead: () => void;
  exportFilteredWorkbook: () => Promise<{ success: boolean; message: string }>;

  // Recycle Bin
  deletedAttendanceData: DeletedAttendanceData;
  deletedAttendanceLoading: boolean;
  deletedAttendanceCount: number;
  loadDeletedAttendanceData: () => Promise<boolean>;
  restoreUploadedFileBatch: (fileId: string) => Promise<void>;
  removeUploadedFileFromRecycleBin: (fileId: string) => Promise<void>;
  restoreManualHrRecord: (type: DeletedManualHrType, id: string) => Promise<void>;
  removeManualHrRecordFromRecycleBin: (
    type: DeletedManualHrType,
    id: string
  ) => Promise<void>;
  deleteAllRecycleBinItems: () => Promise<{ succeeded: number; failed: number }>;
}

const EMPTY_DELETED_ATTENDANCE: DeletedAttendanceData = {
  uploadedFiles: [],
  manualHrRecords: [],
};

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeDate(dateValue: string) {
  return normalizeAttendanceDate(dateValue);
}

function makeRecordKey(name: string, date: string, timeIn: string) {
  return `${normalizeName(name)}|${date}|${timeIn}`;
}

function getMonthKey(dateValue: string) {
  const date = new Date(dateValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);

  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatDayLabel(dayValue: string) {
  return new Date(dayValue).toLocaleDateString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

function getDefaultStoredData(): PersistedAttendanceData {
  return {
    fileName: "",
    uploadedFiles: [],
    exemptions: [],
    absences: [],
    manualUndertimes: [],
    readMemoEmployeeNames: [],
    selectedMonthScope: "all",
    selectedDayScope: "all",
  };
}

function buildStorageKey(workspace: string | null | undefined) {
  if (!workspace) return null;
  return `attendance-system-v6-${workspace}`;
}

function getStoredData(storageKey: string | null): PersistedAttendanceData {
  if (typeof window === "undefined" || !storageKey) {
    return getDefaultStoredData();
  }

  const raw = window.localStorage.getItem(storageKey);

  if (!raw) {
    return getDefaultStoredData();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedAttendanceData>;

    return {
      fileName: parsed.fileName ?? "",
      uploadedFiles: parsed.uploadedFiles ?? [],
      exemptions: parsed.exemptions ?? [],
      absences: parsed.absences ?? [],
      manualUndertimes: parsed.manualUndertimes ?? [],
      readMemoEmployeeNames: parsed.readMemoEmployeeNames ?? [],
      selectedMonthScope: parsed.selectedMonthScope ?? "all",
      selectedDayScope: parsed.selectedDayScope ?? "all",
    };
  } catch {
    return getDefaultStoredData();
  }
}

function matchesCurrentScope(
  dateValue: string,
  selectedMonthScope: string,
  selectedDayScope: string
) {
  return matchesDateScope(dateValue, selectedMonthScope, selectedDayScope);
}

const AttendanceContext = createContext<AttendanceState | undefined>(undefined);
const STORAGE_KEY_PREFIX = "attendance-system-v6";

export const AttendanceProvider = ({ children }: { children: ReactNode }) => {
  const { workspace, hrScope, role, loading: authLoading } = useAuth();
  const { activeEmployees } = useEmployees();

  const storageKey = useMemo(() => {
    if (!workspace) return null;
    return buildStorageKey(workspace) ?? `${STORAGE_KEY_PREFIX}-${workspace}`;
  }, [workspace]);

  const [fileName, setFileName] = useState("");
  const [mainDailyAttendance, setMainDailyAttendance] = useState<MainDailyAttendance[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedAttendanceFile[]>([]);
  const [exemptionsState, setExemptions] = useState<Exemption[]>([]);
  const [absencesState, setAbsences] = useState<AbsentRecord[]>([]);
  const [manualUndertimesState, setManualUndertimes] = useState<
    UndertimeRecord[]
  >([]);
  const [manualLateRecordsState, setManualLateRecordsState] = useState<
    ManualLateRecord[]
  >([]);
  const [readMemoEmployeeNames, setReadMemoEmployeeNames] = useState<string[]>([]);
  const [selectedMonthScope, setSelectedMonthScope] = useState<string>("all");
  const [selectedDayScope, setSelectedDayScope] = useState<string>("all");
  const [isStorageHydrated, setIsStorageHydrated] = useState(false);
  const [deletedAttendanceData, setDeletedAttendanceData] =
    useState<DeletedAttendanceData>(EMPTY_DELETED_ATTENDANCE);
  const [deletedAttendanceLoading, setDeletedAttendanceLoading] =
    useState(false);

  const applyDatabaseData = async (loadFilterState = false) => {
    if (!workspace) return;

    const [dbData, manualLates, mainDaily] = await Promise.all([
      loadAttendanceData(workspace),
      loadManualLateRecords(workspace).catch((error) => {
        console.error("Failed to load manual late records:", error);
        return [] as ManualLateRecord[];
      }),
      hrScope === "MAIN" ? loadMainDailyAttendance().catch(() => [] as MainDailyAttendance[]) : Promise.resolve([] as MainDailyAttendance[]),
    ]);

    const localData = getStoredData(storageKey);

    setFileName(dbData.fileName);
    setUploadedFiles(dbData.uploadedFiles);
    setExemptions(dbData.exemptions);
    setAbsences(dbData.absences);
    setManualUndertimes(dbData.manualUndertimes);
    setManualLateRecordsState(manualLates);
    const attendanceNames = new Map(activeEmployees.map((employee) => [employee.id, employee.attendanceName ?? employee.fullName]));
    setMainDailyAttendance(mainDaily.map((record) => ({ ...record, employeeName: record.employeeId ? (attendanceNames.get(record.employeeId) ?? record.employeeName) : record.employeeName })));
    setReadMemoEmployeeNames(dbData.readMemoEmployeeNames);

    if (loadFilterState) {
      setSelectedMonthScope(localData.selectedMonthScope || "all");
      setSelectedDayScope(localData.selectedDayScope || "all");
    }
  };

  useEffect(() => {
    if (authLoading || !workspace) return;

    let isMounted = true;

    async function loadInitialData() {
      try {
        await applyDatabaseData(true);
      } catch (error) {
        console.error("Failed to load attendance data from Supabase:", error);
      } finally {
        if (isMounted) {
          setIsStorageHydrated(true);
        }
      }
    }

    void loadInitialData();

    return () => {
      isMounted = false;
    };
  }, [authLoading, workspace, storageKey]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      authLoading ||
      !storageKey ||
      !isStorageHydrated
    ) {
      return;
    }

    const payload: PersistedAttendanceData = {
      ...getDefaultStoredData(),
      selectedMonthScope,
      selectedDayScope,
    };

    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [
    authLoading,
    storageKey,
    isStorageHydrated,
    selectedMonthScope,
    selectedDayScope,
  ]);

  const allLateRecords = useMemo<LateRecord[]>(() => {
    const excelLates: LateRecord[] = uploadedFiles.flatMap((file) =>
      file.lateRecords.map((record) => ({
        ...record,
        sourceType: (record.sourceType ?? "excel-upload") as LateRecordSourceType,
      }))
    );

    const manualLates: LateRecord[] = manualLateRecordsState.map((record) => ({
      id: record.id,
      name: record.name,
      date: record.date,
      timeIn: record.timeIn,
      minutesLate: record.minutesLate,
      secondsLate: record.secondsLate,
      totalSecondsLate: record.totalSecondsLate,
      sourceFileId: `manual:${record.id}`,
      sourceFileName: "Manual Entry",
      sourceType: "manual-entry" as LateRecordSourceType,
      isDeleted: false,
    }));

    return [...excelLates, ...manualLates];
  }, [uploadedFiles, manualLateRecordsState]);

  const allGeneratedUndertimes = useMemo(() => {
    return uploadedFiles
      .flatMap((file) => file.generatedUndertimes)
      .sort((a, b) => {
        const aDate = new Date(`${a.date} ${a.timeIn}`).getTime();
        const bDate = new Date(`${b.date} ${b.timeIn}`).getTime();
        return bDate - aDate;
      });
  }, [uploadedFiles]);

  const uploadedAvailableDates = useMemo(() => {
    if (hrScope === "MAIN") {
      return mainWorkDateOptions(mainDailyAttendance);
    }

    const daySet = new Set<string>();

    uploadedFiles.forEach((file) => {
      file.lateRecords.forEach((record) => daySet.add(normalizeDate(record.date)));
      file.generatedUndertimes.forEach((record) =>
        daySet.add(normalizeDate(record.date))
      );
    });

    return Array.from(daySet).sort(
      (a, b) => new Date(b).getTime() - new Date(a).getTime()
    );
  }, [hrScope, mainDailyAttendance, uploadedFiles]);

  const uploadedAvailableMonths = useMemo(() => {
    const monthSet = new Set<string>();

    uploadedAvailableDates.forEach((dateValue) => {
      monthSet.add(getMonthKey(dateValue));
    });

    return Array.from(monthSet).sort((a, b) => b.localeCompare(a));
  }, [uploadedAvailableDates]);

  const dayScopeOptions = useMemo(() => {
    if (selectedMonthScope === "all") {
      return uploadedAvailableDates;
    }

    return uploadedAvailableDates.filter(
      (dateValue) => getMonthKey(dateValue) === selectedMonthScope
    );
  }, [uploadedAvailableDates, selectedMonthScope]);

  useEffect(() => {
    if (
      selectedMonthScope !== "all" &&
      !uploadedAvailableMonths.includes(selectedMonthScope)
    ) {
      setSelectedMonthScope("all");
    }
  }, [selectedMonthScope, uploadedAvailableMonths]);

  useEffect(() => {
    if (selectedDayScope !== "all" && !dayScopeOptions.includes(selectedDayScope)) {
      setSelectedDayScope("all");
    }
  }, [selectedDayScope, dayScopeOptions]);

  const adjustedLateRecords = useMemo(() => {
    if (allLateRecords.length === 0) return [];

    const linkedUndertimeLateIds = new Set(
      manualUndertimesState
        .map((ut) => ut.sourceLateRecordId)
        .filter(Boolean) as string[]
    );

    const approvedExemptionLateIds = new Set(
      exemptionsState
        .filter((ex) => ex.approvalStatus === "approved" && ex.lateRecordId && !ex.lateRestoredAt)
        .map((ex) => ex.lateRecordId as string)
    );

    const adjustmentCountMap = new Map<string, number>();

    manualUndertimesState
      .filter((ut) => !ut.sourceLateRecordId)
      .forEach((ut) => {
        const key = `${normalizeName(ut.name)}|${normalizeDate(ut.date)}`;
        adjustmentCountMap.set(key, (adjustmentCountMap.get(key) ?? 0) + 1);
      });

    const consumedAdjustments = new Map<string, number>();

    return allLateRecords.filter((record) => {
      if (linkedUndertimeLateIds.has(record.id)) {
        return false;
      }

      if (approvedExemptionLateIds.has(record.id)) {
        return false;
      }

      const key = `${normalizeName(record.name)}|${record.date}`;
      const allowed = adjustmentCountMap.get(key) ?? 0;
      const used = consumedAdjustments.get(key) ?? 0;

      if (used < allowed) {
        consumedAdjustments.set(key, used + 1);
        return false;
      }

      return true;
    });
  }, [allLateRecords, exemptionsState, manualUndertimesState]);

  const lateRecords = useMemo(() => {
    return adjustedLateRecords.filter((record) =>
      matchesCurrentScope(record.date, selectedMonthScope, selectedDayScope)
    );
  }, [adjustedLateRecords, selectedMonthScope, selectedDayScope]);

  const lateSummary = useMemo<LateSummary[]>(() => {
    const lateCount: Record<string, { lates: number; minutes: number }> = {};

    lateRecords.forEach((record) => {
      const cleanName = record.name.trim();

      if (!lateCount[cleanName]) {
        lateCount[cleanName] = { lates: 0, minutes: 0 };
      }

      lateCount[cleanName].lates += 1;
      lateCount[cleanName].minutes += record.minutesLate;
    });

    return Object.entries(lateCount)
      .map(([name, stats]) => ({
        name,
        totalLates: stats.lates,
        totalMinutesLate: stats.minutes,
      }))
      .sort((a, b) => {
        if (b.totalLates !== a.totalLates) return b.totalLates - a.totalLates;
        return b.totalMinutesLate - a.totalMinutesLate;
      });
  }, [lateRecords]);

  const generatedUndertimes = useMemo(() => {
    return allGeneratedUndertimes.filter((record) =>
      matchesCurrentScope(record.date, selectedMonthScope, selectedDayScope)
    );
  }, [allGeneratedUndertimes, selectedMonthScope, selectedDayScope]);

  const exemptions = useMemo(() => {
    return exemptionsState.filter((record) =>
      matchesCurrentScope(record.date, selectedMonthScope, selectedDayScope)
    );
  }, [exemptionsState, selectedMonthScope, selectedDayScope]);

  const absences = useMemo(() => {
    return absencesState.filter((record) =>
      matchesCurrentScope(record.date, selectedMonthScope, selectedDayScope)
    );
  }, [absencesState, selectedMonthScope, selectedDayScope]);

  const manualUndertimes = useMemo(() => {
    return manualUndertimesState.filter((record) =>
      matchesCurrentScope(record.date, selectedMonthScope, selectedDayScope)
    );
  }, [manualUndertimesState, selectedMonthScope, selectedDayScope]);

  const memoAlerts = useMemo<MemoAlert[]>(() => {
    const readSet = new Set(readMemoEmployeeNames.map((name) => normalizeName(name)));

    return lateSummary
      .filter((item) => item.totalLates >= 4)
      .map((item) => ({
        id: `memo-${normalizeName(item.name)}`,
        name: item.name,
        totalLates: item.totalLates,
        totalMinutesLate: item.totalMinutesLate,
        message: `${item.name} has already reached ${item.totalLates} lates and is due for memo/penalty review.`,
        isRead: readSet.has(normalizeName(item.name)),
      }))
      .sort((a, b) => b.totalLates - a.totalLates);
  }, [lateSummary, readMemoEmployeeNames]);

  const unreadMemoCount = memoAlerts.filter((item) => !item.isRead).length;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!workspace) {
      toast.error(
        "Not signed in",
        "Please log in before uploading attendance files."
      );
      return;
    }

    if (uploadedFiles.some((uploadedFile) => uploadedFile.fileName.toLocaleLowerCase() === file.name.toLocaleLowerCase())) {
      toast.error("Duplicate upload blocked", "This attendance file has already been uploaded.");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      void (async () => {
        try {
          const data = event.target?.result;
          const workbook = XLSX.read(data, { type: "binary" });

          const workbookRows = workbook.SheetNames.flatMap((sheetName) =>
            XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1 })
          );

          if (hrScope === "MAIN") {
            if (!workbookRows.some(isMainAttendanceHeader)) {
              throw new Error("This file does not match the MAIN Office attendance format.");
            }
            const mappings = await loadMainBiometricMappings();
            const summaries = aggregateMainAttendance(workbookRows, activeEmployees.map((employee) => ({
              id: employee.id,
              fullName: employee.fullName,
              attendanceName: employee.attendanceName,
              startDate: employee.startDate,
              employmentStatus: employee.employmentStatus,
              isDeleted: employee.isDeleted,
            })), mappings);
            if (summaries.length === 0) throw new Error("No valid MAIN Office C/In or C/Out records were found.");
            await saveMainAttendanceImport(file.name, summaries, activeEmployees.map((employee) => ({ id: employee.id, startDate: employee.startDate })));
            await applyDatabaseData(false);
            setFileName(file.name);
            const day = summaries[0]?.workDate;
            if (day) { setSelectedMonthScope(getMonthKey(day)); setSelectedDayScope(day); }
            toast.success("MAIN attendance imported", `${summaries.length} daily attendance record${summaries.length === 1 ? "" : "s"} processed.`);
            if (e.target) e.target.value = "";
            return;
          }

          if (!isItcAttendanceRows(workbookRows)) {
            throw new Error("This file does not match the ITC Plant attendance format.");
          }

          const newFileId = createId();
          const parsedLateRecords: LateRecord[] = [];
          const parsedGeneratedUndertime: GeneratedUndertime[] = [];
          const parsedGeneratedHalfDays: GeneratedHalfDay[] = [];

          const allExistingLateKeys = new Set(
            uploadedFiles.flatMap((uploadedFile) =>
              uploadedFile.lateRecords.map((record) =>
                makeRecordKey(record.name, record.date, record.timeIn)
              )
            )
          );

          const allExistingUndertimeKeys = new Set(
            uploadedFiles.flatMap((uploadedFile) =>
              uploadedFile.generatedUndertimes.map((record) =>
                makeRecordKey(record.name, record.date, record.timeIn)
              )
            )
          );

          workbook.SheetNames.forEach((sheetName) => {
            const worksheet = workbook.Sheets[sheetName];
            const jsonData: unknown[] = XLSX.utils.sheet_to_json(worksheet, {
              header: 1,
            });

            for (let i = 4; i < jsonData.length; i += 1) {
              const row = jsonData[i] as unknown[];

              if (!row?.[2] || !row?.[4]) continue;

              const name = String(row[2]).trim();
              const dateTime = parseAttendanceDateTime(row[4] as string | number | Date);

              if (!name || !dateTime) continue;

              const hours = dateTime.getHours();
              const minutes = dateTime.getMinutes();
              const seconds = dateTime.getSeconds();
              const workDate = `${dateTime.getFullYear()}-${String(dateTime.getMonth() + 1).padStart(2, "0")}-${String(dateTime.getDate()).padStart(2, "0")}`;

              const classification = classifyUploadedTimeIn(workDate, hours, minutes, seconds);

              const timeIn = dateTime.toLocaleTimeString("en-US");
              const dateStr = dateTime.toLocaleDateString("en-US");
              const recordKey = makeRecordKey(name, dateStr, timeIn);
              const employeeMatches = activeEmployees.filter((employee) =>
                normalizeName(employee.fullName) === normalizeName(name) ||
                normalizeName(employee.attendanceName ?? "") === normalizeName(name)
              );
              const fuzzyEmployeeMatches = employeeMatches.length === 0
                ? activeEmployees.filter((employee) => attendanceNameMatchesEmployee(name, employee.fullName) || (employee.attendanceName ? attendanceNameMatchesEmployee(name, employee.attendanceName) : false))
                : [];
              const resolvedEmployees = employeeMatches.length > 0 ? employeeMatches : fuzzyEmployeeMatches;
              // Preserve the original exact-match contract: employeeMatches.length === 1 ? employeeMatches[0].id : undefined
              const matchedEmployee = resolvedEmployees.length === 1 ? resolvedEmployees[0] : undefined;
              const matchedEmployeeId = matchedEmployee?.id;

              if (classification.kind === "half_day") {
                parsedGeneratedHalfDays.push({
                  name: matchedEmployee?.fullName ?? name,
                  date: dateStr,
                  period: classification.period,
                  scheduledStart: classification.scheduledStart,
                  scheduledEnd: classification.scheduledEnd,
                  reason: "Generated from attendance upload",
                  sourceFileName: file.name,
                });
              } else if (classification.kind === "undertime") {
                if (!allExistingUndertimeKeys.has(recordKey)) {
                  allExistingUndertimeKeys.add(recordKey);
                  parsedGeneratedUndertime.push({
                    id: createId(),
                    employeeId: matchedEmployeeId,
                    name,
                    date: dateStr,
                    timeIn,
                    minutesUndertime: classification.minutes,
                    sourceFileId: newFileId,
                    sourceFileName: file.name,
                  });
                }
              } else if (classification.kind === "late") {
                if (!allExistingLateKeys.has(recordKey)) {
                  allExistingLateKeys.add(recordKey);
                  parsedLateRecords.push({
                    id: createId(),
                    employeeId: matchedEmployeeId,
                    name,
                    date: dateStr,
                    timeIn,
                    minutesLate: classification.minutes,
                    secondsLate: classification.seconds,
                    totalSecondsLate: classification.totalSeconds,
                    sourceFileId: newFileId,
                    sourceFileName: file.name,
                  });
                }
              }
            }
          });

          if (parsedLateRecords.length === 0 && parsedGeneratedUndertime.length === 0 && parsedGeneratedHalfDays.length === 0) {
            toast.warning(
              "Nothing to import",
              "No late, undertime, or half-day records were found in this file."
            );

            if (e.target) {
              e.target.value = "";
            }

            return;
          }

          await saveUploadedAttendanceFile(
            workspace,
            file.name,
            parsedLateRecords,
            parsedGeneratedUndertime,
            parsedGeneratedHalfDays,
            file
          );

          const uploadedDay =
            parsedLateRecords[0]?.date || parsedGeneratedUndertime[0]?.date || parsedGeneratedHalfDays[0]?.date || null;

          await applyDatabaseData(false);
          setFileName(file.name);

          if (uploadedDay) {
            setSelectedMonthScope(getMonthKey(uploadedDay));
            setSelectedDayScope(uploadedDay);
          }

          if (e.target) {
            e.target.value = "";
          }
        } catch (error) {
          // Supabase errors (PostgrestError, AuthError, StorageError) are
          // plain objects, not Error instances, so `error instanceof Error`
          // would silently fall through to a misleading "check the format"
          // message. Log the raw object for diagnostics and surface a clear
          // human-readable message.
          console.error("Upload failed:", error);
          if (
            error &&
            typeof error === "object" &&
            "code" in (error as Record<string, unknown>)
          ) {
            console.error("Upload failed (full detail):", {
              message: (error as { message?: string }).message,
              code: (error as { code?: string }).code,
              details: (error as { details?: string }).details,
              hint: (error as { hint?: string }).hint,
            });
          }
          toast.error(
            "Upload failed",
            hrScope === "MAIN"
              ? "MAIN Office attendance upload could not be completed. Please contact the system administrator."
              : describeSupabaseError(error)
          );
        }
      })();
    };

    reader.readAsBinaryString(file);
  };

  const saveManualCheckout = async (recordId: string, checkoutTime: string, note?: string) => {
    if (hrScope !== "MAIN" || role !== "HR") return { success: false, message: "Manual Check-Out is available to MAIN HR only." };
    try {
      await saveMainManualCheckout(recordId, checkoutTime, note);
      await applyDatabaseData(false);
      return { success: true, message: "Manual Check-Out saved and undertime recalculated." };
    } catch (error) {
      return { success: false, message: describeSupabaseError(error) };
    }
  };
  const mapMainEmployee = async (recordId: string, employeeId: string) => {
    if (hrScope !== "MAIN" || role !== "HR") return { success: false, message: "MAIN HR access required." };
    try { await saveMainBiometricMapping(recordId, employeeId); await applyDatabaseData(false); return { success: true, message: "Biometric mapping saved." }; }
    catch (error) { return { success: false, message: describeSupabaseError(error) }; }
  };
  const reconcileMainUnmatched = async () => {
    if (hrScope !== "MAIN" || role !== "HR") return { success: false, message: "MAIN HR access required." };
    try { const count = await reconcileMainUnmatchedAttendance(); await applyDatabaseData(false); return { success: true, message: `${count} known unmatched record${count === 1 ? "" : "s"} reconciled.` }; }
    catch (error) { return { success: false, message: describeSupabaseError(error) }; }
  };
  const cleanMainStaleRecords = async () => {
    if (hrScope !== "MAIN" || role !== "HR") return { success: false, message: "MAIN HR access required." };
    try {
      await reconcileMainActiveUploadRecords();
      await applyDatabaseData(false);
      return { success: true, message: "Stale system-generated attendance records were reconciled." };
    } catch (error) {
      console.error("Failed to reconcile stale MAIN attendance records:", error);
      return { success: false, message: "Stale system-generated attendance records could not be reconciled. Please try again." };
    }
  };

  const addExemption = (_ex: Omit<Exemption, "id">) => {
    void _ex;
    return {
      success: false,
      message: "Select an exact late record and submit it through the Exemptions form.",
    };
  };

  const addAbsence = async (ab: Omit<AbsentRecord, "id">) => {
    const absenceDate = normalizeDate(ab.date);
    // The former upload-date guard (`hrScope !== "MAIN" && !uploadedAvailableDates.includes(absenceDate)`) is intentionally removed: HR may enter a valid absence before attendance upload.
    if (absencesState.some((record) => record.employeeId === ab.employeeId && normalizeDate(record.date) === absenceDate)) {
      return { success: false, message: "An absence already exists for this employee and date." };
    }

    if (!workspace) return { success: false, message: "Not signed in to a workspace." };
    try {
      const saved = await saveAbsenceRecord(workspace, { ...ab, id: createId() });
      setAbsences((prev) => [saved, ...prev]);
      setSelectedMonthScope(getMonthKey(absenceDate));
      setSelectedDayScope(absenceDate);
      return { success: true, message: "Absence saved successfully." };
    } catch (error) {
      const message = describeSupabaseError(error);
      return { success: false, message: message.includes("An absence record already exists") ? "An absence record already exists for this employee and date." : "The absence could not be saved. Please try again." };
    }
  };

  const addUndertime = async (ut: Omit<UndertimeRecord, "id">) => {
    const undertimeDate = normalizeDate(ut.date);
    const normalizedName = normalizeName(ut.name);

    if (!uploadedAvailableDates.includes(undertimeDate)) {
      return {
        success: false,
        message: "This date is not found in uploaded attendance files.",
      };
    }

    const matchingLateRecords = allLateRecords.filter(
      (record) =>
        normalizeName(record.name) === normalizedName &&
        record.date === undertimeDate
    );

    if (hrScope !== "MAIN" && matchingLateRecords.length === 0) {
      return {
        success: false,
        message:
          "No matching late record found for this employee and date. Manual undertime will only offset a late record if name and date match.",
      };
    }

    if (hrScope !== "MAIN" && (!ut.sourceLateRecordId || !matchingLateRecords.some((record) => record.id === ut.sourceLateRecordId))) {
      return { success: false, message: "Select the exact matching attendance record before saving undertime." };
    }


    if (manualUndertimesState.some((record) => normalizeName(record.name) === normalizedName && normalizeDate(record.date) === undertimeDate)) {
      return { success: false, message: "A manual undertime record already exists for this employee and date." };
    }

    const newUndertime: UndertimeRecord = {
      ...ut,
      id: createId(),
      sourceType: ut.sourceType ?? "manual-entry",
      isManualOverride: ut.isManualOverride ?? true,
    };

    if (!workspace || !ut.employeeId) return { success: false, message: "Employee identity and workspace are required." };
    try {
      await saveManualUndertimeRecord(newUndertime);
      await applyDatabaseData(false);
      setSelectedMonthScope(getMonthKey(undertimeDate));
      setSelectedDayScope(undertimeDate);
      return { success: true, message: "Manual undertime saved successfully." };
    } catch (error) {
      console.error("Failed to save manual undertime:", error);
      return { success: false, message: describeSupabaseError(error) };
    }
  };

  const convertLateToUndertime = async (payload: {
    lateRecordId: string;
    undertimeHours: string;
    reason?: string;
    isManualOverride?: boolean;
  }) => {
    const lateRecord = allLateRecords.find(
      (record) => record.id === payload.lateRecordId
    );

    if (!lateRecord) {
      return {
        success: false,
        message: "The selected late record was not found.",
      };
    }

    const alreadyConverted = manualUndertimesState.some(
      (item) => item.sourceLateRecordId === lateRecord.id
    );

    if (alreadyConverted) {
      return {
        success: false,
        message: "This late record has already been converted to undertime.",
      };
    }

    const matchingEmployees = activeEmployees.filter((employee) =>
      normalizeName(employee.fullName) === normalizeName(lateRecord.name) ||
      normalizeName(employee.attendanceName ?? "") === normalizeName(lateRecord.name)
    );
    const employeeId = lateRecord.employeeId ?? (matchingEmployees.length === 1 ? matchingEmployees[0].id : undefined);

    const newUndertime: UndertimeRecord = {
      id: createId(),
      name: lateRecord.name,
      employeeId,
      date: lateRecord.date,
      reason: payload.reason?.trim() || "Converted from late record",
      undertimeHours: payload.undertimeHours,
      sourceLateRecordId: lateRecord.id,
      originalTimeIn: lateRecord.timeIn,
      sourceType: "late-conversion",
      isManualOverride: payload.isManualOverride ?? false,
    };

    if (!workspace || !employeeId) {
      return { success: false, message: "Employee identity and workspace are required." };
    }
    try {
      await saveManualUndertimeRecord(newUndertime);
      await applyDatabaseData(false);
      setSelectedMonthScope(getMonthKey(lateRecord.date));
      setSelectedDayScope("all");
    } catch (error) {
      console.error("Failed to save converted undertime to Supabase:", error);
      return { success: false, message: describeSupabaseError(error) };
    }

    return {
      success: true,
      message: `${lateRecord.name} was successfully moved to Undertime Records.`,
    };
  };

  // Deleting an uploaded Excel/XLSX attendance file moves only upload-backed
  // rows to Trash. Manual HR records — exemptions, absences, manual undertimes,
  // and late-to-undertime conversions — are independent saved records and
  // are NEVER touched by this action, regardless of whether their date
  // still has uploaded-file coverage. Manual records have their own
  // individual Delete buttons that soft-delete the chosen row.
  const deleteUploadedFile = async (fileId: string) => {
    const batchId = createDeleteBatchId();
    if (!workspace) return { success: false, message: "No active attendance workspace." };
    try {
      await (hrScope === "MAIN" ? deleteMainAttendanceUpload(fileId, batchId) : deleteUploadedAttendanceFile(fileId, {
        batchId,
        reason: "uploaded_file_deleted",
      }));
    } catch (error) {
      console.error("Failed to delete uploaded file from Supabase:", error);
      return { success: false, message: "Attendance upload could not be moved to Trash. Please refresh and try again." };
    }

    // The destructive operation has committed. Reflect that immediately and
    // treat subsequent view refreshes as a separate, non-destructive phase.
    setUploadedFiles((current) => current.filter((file) => file.id !== fileId));
    const refreshResults = await Promise.allSettled([
      applyDatabaseData(false),
      refreshDeletedAttendanceData(false),
    ]);
    const refreshFailed = refreshResults.some((result) =>
      result.status === "rejected" || (result.status === "fulfilled" && result.value === false)
    );
    return {
      success: true,
      message: "Attendance upload moved to Recycle Bin.",
      warning: refreshFailed
        ? "Attendance upload was moved to Recycle Bin, but some views could not be refreshed. Please refresh the page."
        : undefined,
    };
  };

  const deleteAbsence = async (id: string) => {
    try { await deleteAbsenceRecord(id); await applyDatabaseData(false); return { success: true, message: "Absence moved to Trash." }; }
    catch (error) { console.error("Failed to move absence to Trash:", error); return { success: false, message: "The absence could not be moved to Trash." }; }
  };

  const updateMainGeneratedAbsence = async (id: string, reason: string, informed: string[]) => {
    if (hrScope !== "MAIN" || role !== "HR") return { success: false, message: "MAIN HR access required." };
    try {
      await updateMainSystemGeneratedAbsence(id, reason, informed);
      setAbsences((prev) => prev.map((record) => record.id === id ? { ...record, reason: reason.trim(), informed } : record));
      return { success: true, message: "System-generated absence updated." };
    } catch (error) {
      console.error("Failed to update MAIN system-generated absence:", error);
      return { success: false, message: "The system-generated absence could not be updated. Please try again." };
    }
  };

  const deleteMainGeneratedAbsence = async (id: string) => {
    if (hrScope !== "MAIN" || role !== "HR") return { success: false, message: "MAIN HR access required." };
    try {
      await deleteMainSystemGeneratedAbsence(id);
      setAbsences((prev) => prev.filter((record) => record.id !== id));
      return { success: true, message: "System-generated absence moved to Trash." };
    } catch (error) {
      console.error("Failed to delete MAIN system-generated absence:", error);
      return { success: false, message: "The system-generated absence could not be moved to Trash. Please try again." };
    }
  };

  // Per-row Delete button on the Exemptions page. Soft-deletes only the
  // selected exemption row — the underlying late record reappears in
  // Late Records as a side effect of the adjustment count dropping.
  const deleteExemption = async (id: string) => {
    try { await deleteExemptionRecord(id, { reason: "exemption_deleted" }); await applyDatabaseData(false); return { success: true, message: "Exemption moved to Trash." }; }
    catch (error) { console.error("Failed to move exemption to Trash:", error); return { success: false, message: "The exemption could not be moved to Trash." }; }
  };

  // Per-row Delete button on the Undertime > Manual Entry page.
  // Soft-deletes only the selected manual undertime row.
  const deleteManualUndertime = async (id: string) => {
    try { await deleteManualUndertimeRecord(id, { reason: "manual_undertime_deleted" }); await applyDatabaseData(false); return { success: true, message: "Manual undertime moved to Trash." }; }
    catch (error) { console.error("Failed to move manual undertime to Trash:", error); return { success: false, message: "The manual undertime could not be moved to Trash." }; }
  };
  const saveManualCheckin = async (recordId: string, checkinTime: string, note?: string) => {
    if (hrScope !== "MAIN" || role !== "HR") return { success: false, message: "Manual Check-In is available to MAIN HR only." };
    try {
      await saveMainManualCheckin(recordId, checkinTime, note);
      await applyDatabaseData(false);
      return { success: true, message: "Manual Check-In saved and MAIN classifications recalculated." };
    } catch (error) {
      return { success: false, message: describeSupabaseError(error) };
    }
  };

  const editGeneratedUndertimeDetails = async (id: string, reason: string, informed: string[]) => {
    if (!reason.trim()) return { success: false, message: "Reason / Remarks is required." };
    try {
      await updateGeneratedUndertimeDetails(id, reason, informed);
      await applyDatabaseData(false);
      return { success: true, message: "System generated undertime details updated." };
    } catch (error) {
      return { success: false, message: describeSupabaseError(error) };
    }
  };

  // ------------------- Manual late records (migration 005) --------------

  const addManualLate = async (input: {
    name: string;
    workDate: string;      // ISO yyyy-mm-dd from the date input
    timeIn: string;
    officialStartTime: string;
    graceMinutes: number;
    reason: string;
  }): Promise<{ success: boolean; message: string }> => {
    if (!workspace) {
      return { success: false, message: "Not signed in to a workspace." };
    }

    const trimmedName = input.name.trim();
    if (!trimmedName) {
      return { success: false, message: "Please enter an employee name." };
    }
    if (!input.workDate) {
      return { success: false, message: "Please select a date." };
    }
    if (!input.timeIn.trim()) {
      return { success: false, message: "Please enter a time in." };
    }
    if (!input.officialStartTime.trim()) {
      return { success: false, message: "Please enter the official start time." };
    }
    if (input.graceMinutes < 0) {
      return { success: false, message: "Grace minutes cannot be negative." };
    }

    const computed = computeManualLate({
      timeIn: input.timeIn,
      officialStartTime: input.officialStartTime,
      graceMinutes: input.graceMinutes,
    });

    if (!computed.normalizedTimeIn) {
      return {
        success: false,
        message:
          "Could not parse the time in. Use a format like '8:15 AM' or '08:15:00'.",
      };
    }

    if (!computed.isLate) {
      return {
        success: false,
        message: `Not late: ${computed.normalizedTimeIn} is at or before the late threshold ${computed.lateStartTime}.`,
      };
    }

    const displayDate = normalizeDate(input.workDate);
    const dedupeKey = makeRecordKey(
      trimmedName,
      displayDate,
      computed.normalizedTimeIn
    );

    const existingDupe = allLateRecords.some(
      (record) =>
        makeRecordKey(record.name, record.date, record.timeIn) === dedupeKey
    );
    if (existingDupe) {
      return {
        success: false,
        message:
          "A late record with the same name, date, and time in already exists.",
      };
    }

    try {
      const saved = await addManualLateRecord({
        workspace,
        name: trimmedName,
        workDate: input.workDate,
        timeIn: computed.normalizedTimeIn,
        officialStartTime: computed.officialStartTime,
        graceMinutes: input.graceMinutes,
        minutesLate: computed.minutesLate,
        secondsLate: computed.secondsLate,
        totalSecondsLate: computed.totalSecondsLate,
        reason: input.reason.trim() || null,
      });

      setManualLateRecordsState((prev) => [saved, ...prev]);
      setSelectedMonthScope(getMonthKey(displayDate));
      setSelectedDayScope(displayDate);

      return {
        success: true,
        message: `Manual late saved. ${trimmedName} is ${saved.minutesLate} min ${saved.secondsLate} sec late.`,
      };
    } catch (error) {
      console.error("Failed to save manual late:", error);
      return {
        success: false,
        message: describeSupabaseError(error),
      };
    }
  };

  const deleteManualLate = async (id: string) => {
    if (!workspace) return { success: false, message: "Not signed in to a workspace." };
    try {
      await softDeleteManualLateRecord(id, {
        batchId: createDeleteBatchId(),
        reason: "Deleted manual late record",
      });
      await applyDatabaseData(false);
      return { success: true, message: "Manual late moved to Trash." };
    } catch (error) { console.error("Failed to move manual late to Trash:", error); return { success: false, message: "The manual late could not be moved to Trash." }; }
  };

  const clearAllAttendanceHistory = async () => {
    if (!workspace) return { success: false, message: "Not signed in to a workspace." };
    const result = await clearWorkspaceAttendanceData(workspace);
    await applyDatabaseData(false);
    if (result.failed > 0) return { success: false, message: `${result.failed} data group(s) could not be cleared; remaining records were reloaded.` };
    setSelectedMonthScope("all"); setSelectedDayScope("all");
    if (typeof window !== "undefined" && storageKey) window.localStorage.removeItem(storageKey);
    return { success: true, message: "Attendance history moved to Trash." };
  };

  const deleteAbsencesByMonth = async (monthKey: string) => {
    if (!workspace) return { success: false, message: "Not signed in to a workspace." };
    try { await deleteAbsencesByMonthFromDatabase(workspace, monthKey); await applyDatabaseData(false); return { success: true, message: "Absences moved to Trash." }; }
    catch (error) { console.error("Failed to delete absences:", error); return { success: false, message: "Absences could not be moved to Trash." }; }
  };

  const deleteExemptionsByMonth = async (monthKey: string) => {
    if (!workspace) return { success: false, message: "Not signed in to a workspace." };
    try { await deleteExemptionsByMonthFromDatabase(workspace, monthKey); await applyDatabaseData(false); return { success: true, message: "Exemptions moved to Trash." }; }
    catch (error) { console.error("Failed to delete exemptions:", error); return { success: false, message: "Exemptions could not be moved to Trash." }; }
  };

  const restoreExemptionLate = async (id: string) => {
    await restoreApprovedExemptionLate(id);
    await applyDatabaseData(false);
  };

  const deleteManualUndertimesByMonth = async (monthKey: string) => {
    if (!workspace) return { success: false, message: "Not signed in to a workspace." };
    try { await deleteManualUndertimesByMonthFromDatabase(workspace, monthKey); await applyDatabaseData(false); return { success: true, message: "Manual undertimes moved to Trash." }; }
    catch (error) { console.error("Failed to delete manual undertimes:", error); return { success: false, message: "Manual undertimes could not be moved to Trash." }; }
  };

  // Removes the manual undertime adjustment so the underlying late
  // record reappears in Late Records. The undertime row itself is moved
  // to Trash (soft delete), where it can be restored from Recycle Bin.
  const removeManualUndertimeAdjustment = async (id: string) => {
    try {
      await deleteManualUndertimeRecord(id, {
        reason: "manual_undertime_removed_for_late",
      });
      await applyDatabaseData(false);
      return { success: true, message: "Manual undertime moved to Trash." };
    } catch (error) {
      console.error("Failed to move manual undertime to Trash:", error);
      return { success: false, message: describeSupabaseError(error) };
    }
  };

  // ------------------- Recycle Bin / Trash ------------------------------

  const refreshDeletedAttendanceData = async (showError = true): Promise<boolean> => {
    if (!workspace) {
      setDeletedAttendanceData(EMPTY_DELETED_ATTENDANCE);
      return true;
    }

    setDeletedAttendanceLoading(true);
    try {
      const data = await loadDeletedAttendanceData(workspace);
      setDeletedAttendanceData(data);
      return true;
    } catch (error) {
      console.error("Failed to load Recycle Bin:", error);
      if (showError) toast.error("Could not load Recycle Bin", describeSupabaseError(error));
      return false;
    } finally {
      setDeletedAttendanceLoading(false);
    }
  };

  const restoreUploadedFileBatchFromTrash = async (fileId: string) => {
    try {
      await restoreUploadedFileBatch(fileId);
      await applyDatabaseData(false);
      await refreshDeletedAttendanceData();
      toast.success(
        "Batch restored",
        "The uploaded file and every record that was deleted with it are active again."
      );
    } catch (error) {
      console.error("Failed to restore batch:", error);
      toast.error("Restore failed", describeSupabaseError(error));
    }
  };

  const removeUploadedFileFromRecycleBinAction = async (fileId: string) => {
    try {
      await permanentlyDeleteRecycleBinItem("uploaded_file", fileId);
      await refreshDeletedAttendanceData();
      toast.success(
        "Permanently deleted",
        "The uploaded attendance batch was permanently deleted."
      );
    } catch (error) {
      console.error("Failed to remove batch from Recycle Bin:", error);
      toast.error("Remove failed", describeSupabaseError(error));
    }
  };

  const TYPE_LABEL: Record<DeletedManualHrType, string> = {
    exemption: "Exemption",
    absence: "Absence",
    manual_undertime: "Manual undertime",
    manual_late: "Manual late",
    half_day: "Half-day",
  };

  const restoreManualHrRecordAction = async (
    type: DeletedManualHrType,
    id: string
  ) => {
    try {
      await restoreManualHrRecord(type, id);
      await applyDatabaseData(false);
      await refreshDeletedAttendanceData();
      toast.success(
        "Record restored",
        `${TYPE_LABEL[type]} restored from Recycle Bin.`
      );
    } catch (error) {
      console.error("Failed to restore manual HR record:", error);
      toast.error("Restore failed", describeSupabaseError(error));
    }
  };

  const removeManualHrRecordFromRecycleBinAction = async (
    type: DeletedManualHrType,
    id: string
  ) => {
    try {
      await permanentlyDeleteRecycleBinItem(type, id);
      await refreshDeletedAttendanceData();
      toast.success(
        "Permanently deleted",
        "The HR record was permanently deleted."
      );
    } catch (error) {
      console.error(
        "Failed to remove manual HR record from Recycle Bin:",
        error
      );
      toast.error("Remove failed", describeSupabaseError(error));
    }
  };

  const deleteAllRecycleBinItems = async () => {
    if (!workspace || deletedAttendanceCount === 0) return { succeeded: 0, failed: 0 };
    const succeededFiles = new Set<string>();
    const succeededManual = new Set<string>();
    let failed = 0;

    for (const file of deletedAttendanceData.uploadedFiles) {
      try {
        await permanentlyDeleteRecycleBinItem("uploaded_file", file.id);
        succeededFiles.add(file.id);
      } catch (error) {
        failed += 1;
        console.error("Failed to permanently remove uploaded batch:", error);
      }
    }
    for (const record of deletedAttendanceData.manualHrRecords) {
      try {
        await permanentlyDeleteRecycleBinItem(record.type, record.id);
        succeededManual.add(`${record.type}:${record.id}`);
      } catch (error) {
        failed += 1;
        console.error("Failed to permanently remove manual HR record:", error);
      }
    }

    const succeeded = succeededFiles.size + succeededManual.size;
    setDeletedAttendanceData((current) => ({
      uploadedFiles: current.uploadedFiles.filter((file) => !succeededFiles.has(file.id)),
      manualHrRecords: current.manualHrRecords.filter((record) => !succeededManual.has(`${record.type}:${record.id}`)),
    }));
    await refreshDeletedAttendanceData(false);

    if (failed === 0) toast.success("Recycle Bin cleared", `${succeeded} item${succeeded === 1 ? "" : "s"} permanently deleted.`);
    else toast.warning("Recycle Bin partially cleared", `${succeeded} item${succeeded === 1 ? "" : "s"} permanently deleted. ${failed} item${failed === 1 ? "" : "s"} could not be deleted.`);
    return { succeeded, failed };
  };

  const markAllMemoAlertsAsRead = () => {
    const uniqueNames = Array.from(new Set(memoAlerts.map((item) => item.name.trim())));
    setReadMemoEmployeeNames((prev) =>
      Array.from(new Set([...prev, ...uniqueNames]))
    );

    if (workspace) {
      void saveMemoReads(workspace, uniqueNames).catch((error) => {
        console.error("Failed to save memo reads to Supabase:", error);
      });
    }
  };

const exportFilteredWorkbook = async () => {
  try {
    const workbook = new ExcelJS.Workbook();

const cleanName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*\.\s*/g, ".")
    .replace("jr.,", "jr,")
    .replace("jr.", "jr")
    .replace(" ma. ", " ma ")
    .replace(" ma,", " ma,");

    const employerByName = new Map(activeEmployees.map((employee) => [cleanName(employee.fullName), employee.employer]));

const getTeam = (name: string) => {
  const normalized = cleanName(name);

  return employerByName.get(normalized) ?? "UNASSIGNED";
};

    const sortByName = <T extends { name: string }>(items: T[]) =>
      [...items].sort((a, b) => a.name.localeCompare(b.name));

    const byTeam = <T extends { name: string }>(items: T[], team: string) =>
      sortByName(items.filter((item) => getTeam(item.name) === team));

    const primaryEmployer = workspace === "WAIS" ? "WATTS APP" : "APP";
    const secondaryEmployer = workspace === "WAIS" ? "M2B" : "WAIS";

    const reportScope =
      selectedDayScope !== "all"
        ? formatDayLabel(selectedDayScope)
        : selectedMonthScope !== "all"
        ? formatMonthLabel(selectedMonthScope)
        : "All Records";

    const generatedDate = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "2-digit",
      year: "numeric",
    });

    const totalMinutesLate = lateSummary.reduce(
      (sum, item) => sum + item.totalMinutesLate,
      0
    );

    const memoReviewCount = lateSummary.filter(
      (item) => item.totalLates >= 4
    ).length;

    const colors = {
      title: "F8FBFF",
      section: "EAF1F8",
      wais: "DDF3FF",
      app: "E8FFF3",
      unassigned: "FFF2CC",
      header: "26364A",
      memo: "FDECEC",
      white: "FFFFFF",
      blueCard: "EAF3FF",
      greenCard: "E9FFF1",
      yellowCard: "FFF8DD",
      redCard: "FDECEC",
    };

    const thinBorder = {
      top: { style: "thin" as const, color: { argb: "E5E7EB" } },
      left: { style: "thin" as const, color: { argb: "E5E7EB" } },
      bottom: { style: "thin" as const, color: { argb: "E5E7EB" } },
      right: { style: "thin" as const, color: { argb: "E5E7EB" } },
    };

    const fill = (cell: ExcelJS.Cell, color: string) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: color },
      };
    };

    const merge = (
      sheet: ExcelJS.Worksheet,
      startRow: number,
      startCol: number,
      endRow: number,
      endCol: number
    ) => {
      sheet.mergeCells(startRow, startCol, endRow, endCol);
    };

    const setupSheet = (
      sheet: ExcelJS.Worksheet,
      title: string,
      subtitle: string
    ) => {
      sheet.views = [{ showGridLines: false, state: "frozen", ySplit: 2 }];

      sheet.columns = [
        { width: 30 },
        { width: 14 },
        { width: 18 },
        { width: 18 },
        { width: 4 },
        { width: 30 },
        { width: 14 },
        { width: 14 },
        { width: 14 },
        { width: 14 },
        { width: 22 },
      ];

      merge(sheet, 1, 1, 1, 11);
      sheet.getCell("A1").value = title;
      sheet.getCell("A1").font = {
        name: "Arial",
        size: 16,
        bold: true,
        color: { argb: "111827" },
      };
      sheet.getCell("A1").alignment = {
        horizontal: "center",
        vertical: "middle",
      };
      fill(sheet.getCell("A1"), colors.title);

      merge(sheet, 2, 1, 2, 11);
      sheet.getCell("A2").value = subtitle;
      sheet.getCell("A2").font = {
        name: "Arial",
        size: 9,
        color: { argb: "334155" },
      };
      sheet.getCell("A2").alignment = {
        horizontal: "center",
        vertical: "middle",
      };
      fill(sheet.getCell("A2"), colors.title);

      sheet.getRow(1).height = 24;
      sheet.getRow(2).height = 20;
    };

    const applyContentAwareColumnWidths = (sheet: ExcelJS.Worksheet) => {
      sheet.columns.forEach((column) => {
        if ((column.width ?? 0) <= 4) return;
        const values: unknown[] = [];
        column.eachCell?.({ includeEmpty: false }, (cell) => {
          if (!cell.isMerged) values.push(cell.value);
        });
        column.width = computeExcelColumnWidth(values, Math.max(12, column.width ?? 12), 38);
      });
    };

    const setCard = (
      sheet: ExcelJS.Worksheet,
      row: number,
      startCol: number,
      endCol: number,
      label: string,
      value: string | number,
      bgColor: string,
      fontColor: string
    ) => {
      merge(sheet, row, startCol, row, endCol);
      const cell = sheet.getCell(row, startCol);
      cell.value = `${label}        ${value}`;
      cell.font = {
        name: "Arial",
        size: 10,
        bold: true,
        color: { argb: fontColor },
      };
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
      };
      fill(cell, bgColor);
    };

    const sectionTitle = (
      sheet: ExcelJS.Worksheet,
      row: number,
      startCol: number,
      endCol: number,
      title: string
    ) => {
      merge(sheet, row, startCol, row, endCol);
      const cell = sheet.getCell(row, startCol);
      cell.value = title;
      cell.font = {
        name: "Arial",
        size: 10,
        bold: true,
        color: { argb: "111827" },
      };
      cell.alignment = {
        horizontal: "left",
        vertical: "middle",
      };
      fill(cell, colors.section);
    };

    const teamLabel = (
      sheet: ExcelJS.Worksheet,
      row: number,
      startCol: number,
      endCol: number,
      label: string,
      team: string
    ) => {
      merge(sheet, row, startCol, row, endCol);
      const cell = sheet.getCell(row, startCol);
      cell.value = label;
      cell.font = {
        name: "Arial",
        size: 10,
        bold: true,
        color: { argb: team === "UNASSIGNED" ? "C2410C" : "0070C0" },
      };
      cell.alignment = {
        horizontal: "left",
        vertical: "middle",
      };
      fill(
        cell,
        team === "WAIS"
          ? colors.wais
          : team === "APP"
          ? colors.app
          : colors.unassigned
      );
    };

    const headerRow = (
      sheet: ExcelJS.Worksheet,
      row: number,
      startCol: number,
      headers: string[]
    ) => {
      headers.forEach((header, index) => {
        const cell = sheet.getCell(row, startCol + index);
        cell.value = header;
        cell.font = {
          name: "Arial",
          size: 9,
          bold: true,
          color: { argb: "FFFFFF" },
        };
        cell.alignment = {
          horizontal: "center",
          vertical: "middle",
        };
        cell.border = thinBorder;
        fill(cell, colors.header);
      });
    };

    const dataRows = (
      sheet: ExcelJS.Worksheet,
      startRow: number,
      startCol: number,
      rows: (string | number | Date)[][],
      memoColumnIndex?: number
    ) => {
      const finalRows = rows.length ? rows : [["No data"]];
      let row = startRow;

      finalRows.forEach((rowData) => {
        const isMemo =
          memoColumnIndex !== undefined &&
          String(rowData[memoColumnIndex] ?? "")
            .toLowerCase()
            .includes("memo");

        rowData.forEach((value, index) => {
          const cell = sheet.getCell(row, startCol + index);
          cell.value = value;
          if (value instanceof Date) cell.numFmt = "mm/dd/yyyy";

          cell.font = {
            name: "Arial",
            size: 9,
            bold: index === 0,
            color: { argb: isMemo ? "C00000" : "111827" },
          };

          cell.alignment = {
            horizontal: index === 0 ? "left" : typeof value === "number" ? "right" : "center",
            vertical: "middle",
            wrapText: typeof value === "string" && value.length > 36,
          };

          cell.border = thinBorder;
          fill(cell, isMemo ? colors.memo : colors.white);
        });

        row += 1;
      });

      return row;
    };

    const groupedTable = (
      sheet: ExcelJS.Worksheet,
      startRow: number,
      startCol: number,
      endCol: number,
      title: string,
      headers: string[],
      groups: {
        label: string;
        team: string;
        rows: (string | number | Date)[][];
        memoColumnIndex?: number;
      }[]
    ) => {
      let row = startRow;

      sectionTitle(sheet, row, startCol, endCol, title);
      row += 1;

      groups.forEach((group, index) => {
        if (index > 0) row += 2;

        teamLabel(sheet, row, startCol, endCol, group.label, group.team);
        row += 1;

        headerRow(sheet, row, startCol, headers);
        row += 1;

        row = dataRows(
          sheet,
          row,
          startCol,
          group.rows,
          group.memoColumnIndex
        );

        row += 1;
      });

      return row;
    };

    const summaryRows = (items: LateSummary[]) =>
      items.map((item) => [
        item.name,
        item.totalLates,
        item.totalMinutesLate,
        item.totalLates >= 4 ? "For Memo Review" : "Normal",
      ]);

    const lateRows = (items: LateRecord[]) =>
      sortAttendanceDetailRecords(items).map((item) => [
        item.name,
        toExcelCalendarDate(item.date),
        item.timeIn,
        item.minutesLate,
        item.secondsLate,
        item.sourceFileName,
      ]);

    const exemptionRows = (items: Exemption[]) =>
      sortAttendanceDetailRecords(items).map((item) => [item.name, toExcelCalendarDate(item.date), item.reason]);

    const absenceRows = (items: AbsentRecord[]) =>
      sortAttendanceDetailRecords(items).map((item) => [item.name, toExcelCalendarDate(item.date), item.reason, "Manual"]);

    const systemUndertimeRows = (items: GeneratedUndertime[]) =>
      sortAttendanceDetailRecords(items).map((item) => [
        item.name,
        toExcelCalendarDate(item.date),
        item.timeIn,
        item.sourceFileName,
        item.reason ?? "",
        item.informed?.join(", ") ?? "",
      ]);

    const manualUndertimeRows = (items: UndertimeRecord[]) =>
      sortAttendanceDetailRecords(items).map((item) => [
        item.name,
        toExcelCalendarDate(item.date),
        item.reason,
        item.undertimeHours,
      ]);

    const lateSheet = workbook.addWorksheet("Late Summary");
    const absenceSheet = workbook.addWorksheet("Absence & Undertime");

    setupSheet(
      lateSheet,
      "WATTS APP HR ATTENDANCE REPORT",
      `Late Summary / Late Records / Exemptions  |  Report Scope: ${reportScope}  |  Generated: ${generatedDate}`
    );

    setCard(lateSheet, 4, 1, 2, "Late Records", lateRecords.length, colors.blueCard, "0057D9");
    setCard(lateSheet, 4, 4, 5, "Employees with Lates", lateSummary.length, colors.greenCard, "008037");
    setCard(lateSheet, 4, 7, 8, "Total Minutes Late", totalMinutesLate, colors.yellowCard, "9A5B00");
    setCard(lateSheet, 4, 10, 11, "For Memo Review", memoReviewCount, colors.redCard, "C00000");

    const summaryEnd = groupedTable(
      lateSheet,
      7,
      1,
      4,
      "LATE SUMMARY BY HR",
      ["Employee", "Total Lates", "Total Minutes Late", "Memo Status"],
      [
        {
          label: secondaryEmployer,
          team: "WAIS",
          rows: summaryRows(byTeam(lateSummary, secondaryEmployer)),
          memoColumnIndex: 3,
        },
        {
          label: primaryEmployer,
          team: "APP",
          rows: summaryRows(byTeam(lateSummary, primaryEmployer)),
          memoColumnIndex: 3,
        },
      ]
    );

    const lateEnd = groupedTable(
      lateSheet,
      7,
      6,
      11,
      "LATE RECORDS BY HR",
      ["Employee", "Date", "Time In", "Minutes Late", "Seconds Late", "Source File"],
      [
        {
          label: secondaryEmployer,
          team: "WAIS",
          rows: lateRows(byTeam(lateRecords, secondaryEmployer)),
        },
        {
          label: primaryEmployer,
          team: "APP",
          rows: lateRows(byTeam(lateRecords, primaryEmployer)),
        },
        {
          label: "UNASSIGNED",
          team: "UNASSIGNED",
          rows: lateRows(byTeam(lateRecords, "UNASSIGNED")),
        },
      ]
    );

    groupedTable(
      lateSheet,
      Math.max(summaryEnd, lateEnd) + 2,
      1,
      4,
      "EXEMPTIONS BY HR",
      ["Employee", "Date", "Reason"],
      [
        {
          label: secondaryEmployer,
          team: "WAIS",
          rows: exemptionRows(byTeam(exemptions, secondaryEmployer)),
        },
        {
          label: primaryEmployer,
          team: "APP",
          rows: exemptionRows(byTeam(exemptions, primaryEmployer)),
        },
        {
          label: "UNASSIGNED",
          team: "UNASSIGNED",
          rows: exemptionRows(byTeam(exemptions, "UNASSIGNED")),
        },
      ]
    );

    setupSheet(
      absenceSheet,
      "WATTS APP HR ATTENDANCE REPORT",
      `Absence and Undertime Monitoring  |  Report Scope: ${reportScope}  |  Generated: ${generatedDate}`
    );

    setCard(absenceSheet, 4, 1, 2, "Absences", absences.length, colors.blueCard, "0057D9");
    setCard(absenceSheet, 4, 4, 5, "System Undertime", generatedUndertimes.length, colors.greenCard, "008037");
    setCard(absenceSheet, 4, 7, 8, "Manual Undertime", manualUndertimes.length, colors.yellowCard, "9A5B00");

    const absenceEnd = groupedTable(
      absenceSheet,
      7,
      1,
      4,
      "ABSENCES BY HR",
      ["Employee", "Date", "Reason", "Source"],
      [
        {
          label: secondaryEmployer,
          team: "WAIS",
          rows: absenceRows(byTeam(absences, secondaryEmployer)),
        },
        {
          label: primaryEmployer,
          team: "APP",
          rows: absenceRows(byTeam(absences, primaryEmployer)),
        },
        {
          label: "UNASSIGNED",
          team: "UNASSIGNED",
          rows: absenceRows(byTeam(absences, "UNASSIGNED")),
        },
      ]
    );

    const systemEnd = groupedTable(
      absenceSheet,
      7,
      6,
      11,
      "SYSTEM UNDERTIME BY HR",
      ["Employee", "Date", "Time In", "Source File", "Reason / Remarks", "Informed"],
      [
        {
          label: secondaryEmployer,
          team: "WAIS",
          rows: systemUndertimeRows(byTeam(generatedUndertimes, secondaryEmployer)),
        },
        {
          label: primaryEmployer,
          team: "APP",
          rows: systemUndertimeRows(byTeam(generatedUndertimes, primaryEmployer)),
        },
        {
          label: "UNASSIGNED",
          team: "UNASSIGNED",
          rows: systemUndertimeRows(byTeam(generatedUndertimes, "UNASSIGNED")),
        },
      ]
    );

    groupedTable(
      absenceSheet,
      Math.max(absenceEnd, systemEnd) + 2,
      1,
      4,
      "MANUAL UNDERTIME BY HR",
      ["Employee", "Date", "Reason", "Hours"],
      [
        {
          label: secondaryEmployer,
          team: "WAIS",
          rows: manualUndertimeRows(byTeam(manualUndertimes, secondaryEmployer)),
        },
        {
          label: primaryEmployer,
          team: "APP",
          rows: manualUndertimeRows(byTeam(manualUndertimes, primaryEmployer)),
        },
        {
          label: "UNASSIGNED",
          team: "UNASSIGNED",
          rows: manualUndertimeRows(byTeam(manualUndertimes, "UNASSIGNED")),
        },
      ]
    );

    applyContentAwareColumnWidths(lateSheet);
    applyContentAwareColumnWidths(absenceSheet);

    workbook.creator = "WATTS APP HR Attendance System";
    workbook.created = new Date();
    workbook.modified = new Date();

    const buffer = await workbook.xlsx.writeBuffer();

    const blob = new Blob([buffer as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const suffix =
      selectedDayScope !== "all"
        ? formatDayLabel(selectedDayScope)
            .replace(/[^\w\s-]/g, "")
            .replace(/\s+/g, "-")
        : selectedMonthScope !== "all"
        ? formatMonthLabel(selectedMonthScope)
            .replace(/[^\w\s-]/g, "")
            .replace(/\s+/g, "-")
        : "all-records";

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Attendance-Report-${suffix}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    return {
      success: true,
      message: "Professional Excel report exported successfully.",
    };
  } catch (error) {
    console.error("Excel export failed:", error);

    return {
      success: false,
      message: error instanceof Error ? error.message : "Excel export failed.",
    };
  }
};

  const deletedAttendanceCount =
    deletedAttendanceData.uploadedFiles.length +
    deletedAttendanceData.manualHrRecords.length;

  return (
    <AttendanceContext.Provider
      value={{
        loading: authLoading || !isStorageHydrated,
        fileName,
        uploadedFiles,
        allLateRecords,
        lateRecords,
        lateSummary,
        generatedUndertimes,
        exemptions,
        absences,
        manualUndertimes,
        memoAlerts,
        unreadMemoCount,
        monthScopeOptions: uploadedAvailableMonths,
        dayScopeOptions,
        selectedMonthScope,
        selectedDayScope,
        setSelectedMonthScope,
        setSelectedDayScope,
        refreshAttendanceData: () => applyDatabaseData(false),
        handleFileUpload,
        mainDailyAttendance,
        saveManualCheckin,
        saveManualCheckout,
        mapMainEmployee,
        reconcileMainUnmatched,
        cleanMainStaleRecords,
        addExemption,
        addAbsence,
        addUndertime,
        convertLateToUndertime,
        deleteUploadedFile,
        deleteExemption,
        deleteAbsence,
        updateMainSystemGeneratedAbsence: updateMainGeneratedAbsence,
        deleteMainSystemGeneratedAbsence: deleteMainGeneratedAbsence,
        deleteManualUndertime,
        updateGeneratedUndertimeDetails: editGeneratedUndertimeDetails,

        manualLateRecords: manualLateRecordsState,
        addManualLate,
        deleteManualLate,
        clearAllAttendanceHistory,
        deleteAbsencesByMonth,
        deleteExemptionsByMonth,
        deleteManualUndertimesByMonth,
        restoreExemptionLate,
        removeManualUndertimeAdjustment,
        markAllMemoAlertsAsRead,
        exportFilteredWorkbook,

        deletedAttendanceData,
        deletedAttendanceLoading,
        deletedAttendanceCount,
        loadDeletedAttendanceData: refreshDeletedAttendanceData,
        restoreUploadedFileBatch: restoreUploadedFileBatchFromTrash,
        removeUploadedFileFromRecycleBin:
          removeUploadedFileFromRecycleBinAction,
        restoreManualHrRecord: restoreManualHrRecordAction,
        removeManualHrRecordFromRecycleBin:
          removeManualHrRecordFromRecycleBinAction,
        deleteAllRecycleBinItems,
      }}
    >
      {children}
    </AttendanceContext.Provider>
  );
};

export const useAttendance = () => {
  const context = useContext(AttendanceContext);

  if (!context) {
    throw new Error("useAttendance must be used within an AttendanceProvider");
  }

  return context;
};
