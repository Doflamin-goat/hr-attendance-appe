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
import { useAuth } from "./AuthContext";
import {
  clearWorkspaceAttendanceData,
  deleteAbsencesByMonthFromDatabase,
  deleteAttendanceAdjustmentsByDates,
  deleteExemptionRecord,
  deleteExemptionsByMonthFromDatabase,
  deleteManualUndertimeRecord,
  deleteManualUndertimesByMonthFromDatabase,
  deleteUploadedAttendanceFile,
  loadAttendanceData,
  saveAbsenceRecord,
  saveExemptionRecord,
  saveManualUndertimeRecord,
  saveMemoReads,
  saveUploadedAttendanceFile,
} from "../services/attendanceService";
import { toast } from "../components/ui";


export interface LateRecord {
  id: string;
  name: string;
  date: string;
  timeIn: string;
  minutesLate: number;
  secondsLate: number;
  totalSecondsLate: number;
  sourceFileId: string;
  sourceFileName: string;
}

export interface LateSummary {
  name: string;
  totalLates: number;
  totalMinutesLate: number;
}

export interface GeneratedUndertime {
  id: string;
  name: string;
  date: string;
  timeIn: string;
  sourceFileId: string;
  sourceFileName: string;
}

export interface Exemption {
  id: string;
  name: string;
  reason: string;
  date: string;
  minutesLate?: number;
}

export interface AbsentRecord {
  id: string;
  name: string;
  date: string;
  reason: string;
}

export interface UndertimeRecord {
  id: string;
  name: string;
  date: string;
  reason: string;
  undertimeHours: string;
  sourceLateRecordId?: string;
  originalTimeIn?: string;
  sourceType?: "manual-entry" | "late-conversion";
  isManualOverride?: boolean;
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
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  addExemption: (ex: Omit<Exemption, "id">) => {
    success: boolean;
    message: string;
  };
  addAbsence: (ab: Omit<AbsentRecord, "id">) => {
    success: boolean;
    message: string;
  };
  addUndertime: (ut: Omit<UndertimeRecord, "id">) => {
    success: boolean;
    message: string;
  };
  convertLateToUndertime: (payload: {
    lateRecordId: string;
    undertimeHours: string;
    reason?: string;
    isManualOverride?: boolean;
  }) => {
    success: boolean;
    message: string;
  };
  deleteUploadedFile: (fileId: string) => void;
  clearAllAttendanceHistory: () => void;
  deleteAbsencesByMonth: (monthKey: string) => void;
  deleteExemptionsByMonth: (monthKey: string) => void;
  deleteManualUndertimesByMonth: (monthKey: string) => void;
  restoreExemption: (id: string) => void;
  restoreManualUndertime: (id: string) => void;
  markAllMemoAlertsAsRead: () => void;
  exportFilteredWorkbook: () => Promise<{ success: boolean; message: string }>;
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeDate(dateValue: string) {
  return new Date(dateValue).toLocaleDateString("en-US");
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
  const normalized = normalizeDate(dateValue);

  if (selectedDayScope !== "all") {
    return normalized === selectedDayScope;
  }

  if (selectedMonthScope !== "all") {
    return getMonthKey(dateValue) === selectedMonthScope;
  }

  return true;
}

const AttendanceContext = createContext<AttendanceState | undefined>(undefined);
const STORAGE_KEY_PREFIX = "attendance-system-v6";

export const AttendanceProvider = ({ children }: { children: ReactNode }) => {
  const { workspace, loading: authLoading } = useAuth();

  const storageKey = useMemo(() => {
    if (!workspace) return null;
    return buildStorageKey(workspace) ?? `${STORAGE_KEY_PREFIX}-${workspace}`;
  }, [workspace]);

  const [fileName, setFileName] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedAttendanceFile[]>([]);
  const [exemptionsState, setExemptions] = useState<Exemption[]>([]);
  const [absencesState, setAbsences] = useState<AbsentRecord[]>([]);
  const [manualUndertimesState, setManualUndertimes] = useState<
    UndertimeRecord[]
  >([]);
  const [readMemoEmployeeNames, setReadMemoEmployeeNames] = useState<string[]>([]);
  const [selectedMonthScope, setSelectedMonthScope] = useState<string>("all");
  const [selectedDayScope, setSelectedDayScope] = useState<string>("all");
  const [isStorageHydrated, setIsStorageHydrated] = useState(false);

  const applyDatabaseData = async (loadFilterState = false) => {
    if (!workspace) return;

    const dbData = await loadAttendanceData(workspace);
    const localData = getStoredData(storageKey);

    setFileName(dbData.fileName);
    setUploadedFiles(dbData.uploadedFiles);
    setExemptions(dbData.exemptions);
    setAbsences(dbData.absences);
    setManualUndertimes(dbData.manualUndertimes);
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

  const allLateRecords = useMemo(() => {
    return uploadedFiles.flatMap((file) => file.lateRecords);
  }, [uploadedFiles]);

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
  }, [uploadedFiles]);

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

    const adjustmentCountMap = new Map<string, number>();

    exemptionsState.forEach((ex) => {
      const key = `${normalizeName(ex.name)}|${normalizeDate(ex.date)}`;
      adjustmentCountMap.set(key, (adjustmentCountMap.get(key) ?? 0) + 1);
    });

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

    const reader = new FileReader();

    reader.onload = (event) => {
      void (async () => {
        try {
          const data = event.target?.result;
          const workbook = XLSX.read(data, { type: "binary" });

          const newFileId = createId();
          const parsedLateRecords: LateRecord[] = [];
          const parsedGeneratedUndertime: GeneratedUndertime[] = [];

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
              const dateTime = new Date(row[4] as string | number | Date);

              if (!name || Number.isNaN(dateTime.getTime())) continue;

              const dayOfWeek = dateTime.getDay();
              const hours = dateTime.getHours();
              const minutes = dateTime.getMinutes();
              const seconds = dateTime.getSeconds();
              const totalSeconds = hours * 3600 + minutes * 60 + seconds;

              let isLate = false;
              let isUndertime = false;
              let minutesLate = 0;
              let secondsLate = 0;
              let totalSecondsLateValue = 0;

              if (dayOfWeek >= 1 && dayOfWeek <= 5) {
                const officialTime = 8 * 3600;
                const lateStart = 8 * 3600 + 6 * 60;

                const exactHourUndertime =
                  minutes === 0 &&
                  seconds === 0 &&
                  (hours === 9 || hours === 10 || hours === 11);

                const afternoonUndertime =
                  totalSeconds >= 12 * 3600 && totalSeconds <= 17 * 3600;

                if (exactHourUndertime || afternoonUndertime) {
                  isUndertime = true;
                } else if (totalSeconds >= lateStart) {
                  isLate = true;
                  totalSecondsLateValue = totalSeconds - officialTime;
                  minutesLate = Math.floor(totalSecondsLateValue / 60);
                  secondsLate = totalSecondsLateValue % 60;
                }
              } else if (dayOfWeek === 6) {
                const officialTime = 7 * 3600;
                const lateStart = 7 * 3600 + 6 * 60;

                const exactHourUndertime =
                  minutes === 0 &&
                  seconds === 0 &&
                  (hours === 8 || hours === 9 || hours === 10 || hours === 11);

                const afternoonUndertime =
                  totalSeconds >= 12 * 3600 && totalSeconds <= 17 * 3600;

                if (exactHourUndertime || afternoonUndertime) {
                  isUndertime = true;
                } else if (totalSeconds >= lateStart) {
                  isLate = true;
                  totalSecondsLateValue = totalSeconds - officialTime;
                  minutesLate = Math.floor(totalSecondsLateValue / 60);
                  secondsLate = totalSecondsLateValue % 60;
                }
              }

              const timeIn = dateTime.toLocaleTimeString("en-US");
              const dateStr = dateTime.toLocaleDateString("en-US");
              const recordKey = makeRecordKey(name, dateStr, timeIn);

              if (isUndertime) {
                if (!allExistingUndertimeKeys.has(recordKey)) {
                  allExistingUndertimeKeys.add(recordKey);
                  parsedGeneratedUndertime.push({
                    id: createId(),
                    name,
                    date: dateStr,
                    timeIn,
                    sourceFileId: newFileId,
                    sourceFileName: file.name,
                  });
                }
              } else if (isLate) {
                if (!allExistingLateKeys.has(recordKey)) {
                  allExistingLateKeys.add(recordKey);
                  parsedLateRecords.push({
                    id: createId(),
                    name,
                    date: dateStr,
                    timeIn,
                    minutesLate,
                    secondsLate,
                    totalSecondsLate: totalSecondsLateValue,
                    sourceFileId: newFileId,
                    sourceFileName: file.name,
                  });
                }
              }
            }
          });

          if (parsedLateRecords.length === 0 && parsedGeneratedUndertime.length === 0) {
            toast.warning(
              "Nothing to import",
              "No late or undertime records were found in this file."
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
            parsedGeneratedUndertime
          );

          const uploadedDay =
            parsedLateRecords[0]?.date || parsedGeneratedUndertime[0]?.date || null;

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
          console.error("Error reading or saving Excel file:", error);
          toast.error(
            "Upload failed",
            error instanceof Error
              ? error.message
              : "Error reading or saving Excel file. Please check the format."
          );
        }
      })();
    };

    reader.readAsBinaryString(file);
  };

  const addExemption = (ex: Omit<Exemption, "id">) => {
    const exemptionDate = normalizeDate(ex.date);
    const normalizedExemptionName = normalizeName(ex.name);

    if (!uploadedAvailableDates.includes(exemptionDate)) {
      return {
        success: false,
        message: "This date is not found in uploaded attendance files.",
      };
    }

    const matchingLateRecords = allLateRecords.filter(
      (record) =>
        normalizeName(record.name) === normalizedExemptionName &&
        record.date === exemptionDate
    );

    if (matchingLateRecords.length === 0) {
      return {
        success: false,
        message: "No matching late record found for this employee and date.",
      };
    }

    const sameExemptionExists = exemptionsState.some(
      (item) =>
        normalizeName(item.name) === normalizedExemptionName &&
        normalizeDate(item.date) === exemptionDate &&
        item.reason.trim().toLowerCase() === ex.reason.trim().toLowerCase()
    );

    if (sameExemptionExists) {
      return {
        success: false,
        message: "This exemption appears to be already saved.",
      };
    }

    const newExemption: Exemption = {
      ...ex,
      id: createId(),
    };

    setExemptions((prev) => [newExemption, ...prev]);
    setSelectedMonthScope(getMonthKey(exemptionDate));
    setSelectedDayScope(exemptionDate);

    if (workspace) {
      void saveExemptionRecord(workspace, newExemption).catch((error) => {
        console.error("Failed to save exemption to Supabase:", error);
        toast.error(
          "Database sync failed",
          "Exemption was added on screen but failed to save to database."
        );
      });
    }

    return {
      success: true,
      message: "Exemption saved successfully and matching late record is now excluded.",
    };
  };

  const addAbsence = (ab: Omit<AbsentRecord, "id">) => {
    const absenceDate = normalizeDate(ab.date);

    if (!uploadedAvailableDates.includes(absenceDate)) {
      return {
        success: false,
        message: "This date is not found in uploaded attendance files.",
      };
    }

    const newAbsence: AbsentRecord = {
      ...ab,
      id: createId(),
    };

    setAbsences((prev) => [newAbsence, ...prev]);
    setSelectedMonthScope(getMonthKey(absenceDate));
    setSelectedDayScope(absenceDate);

    if (workspace) {
      void saveAbsenceRecord(workspace, newAbsence).catch((error) => {
        console.error("Failed to save absence to Supabase:", error);
        toast.error(
          "Database sync failed",
          "Absence was added on screen but failed to save to database."
        );
      });
    }

    return {
      success: true,
      message: "Absence saved successfully.",
    };
  };

  const addUndertime = (ut: Omit<UndertimeRecord, "id">) => {
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

    if (matchingLateRecords.length === 0) {
      return {
        success: false,
        message:
          "No matching late record found for this employee and date. Manual undertime will only offset a late record if name and date match.",
      };
    }

    const newUndertime: UndertimeRecord = {
      ...ut,
      id: createId(),
      sourceType: ut.sourceType ?? "manual-entry",
      isManualOverride: ut.isManualOverride ?? true,
    };

    setManualUndertimes((prev) => [newUndertime, ...prev]);
    setSelectedMonthScope(getMonthKey(undertimeDate));
    setSelectedDayScope(undertimeDate);

    if (workspace) {
      void saveManualUndertimeRecord(workspace, newUndertime).catch((error) => {
        console.error("Failed to save manual undertime to Supabase:", error);
        toast.error(
          "Database sync failed",
          "Undertime was added on screen but failed to save to database."
        );
      });
    }

    return {
      success: true,
      message:
        "Manual undertime saved successfully and matching late record is now excluded.",
    };
  };

  const convertLateToUndertime = (payload: {
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

    const newUndertime: UndertimeRecord = {
      id: createId(),
      name: lateRecord.name,
      date: lateRecord.date,
      reason: payload.reason?.trim() || "Converted from late record",
      undertimeHours: payload.undertimeHours,
      sourceLateRecordId: lateRecord.id,
      originalTimeIn: lateRecord.timeIn,
      sourceType: "late-conversion",
      isManualOverride: payload.isManualOverride ?? false,
    };

    setManualUndertimes((prev) => [newUndertime, ...prev]);
    setSelectedMonthScope(getMonthKey(lateRecord.date));
    setSelectedDayScope("all");

    if (workspace) {
      void saveManualUndertimeRecord(workspace, newUndertime).catch((error) => {
        console.error("Failed to save converted undertime to Supabase:", error);
        toast.error(
          "Database sync failed",
          "Converted undertime was added on screen but failed to save to database."
        );
      });
    }

    return {
      success: true,
      message: `${lateRecord.name} was successfully moved to Undertime Records.`,
    };
  };

  const deleteUploadedFile = (fileId: string) => {
    setUploadedFiles((prevFiles) => {
      const fileToDelete = prevFiles.find((file) => file.id === fileId);
      const updatedFiles = prevFiles.filter((file) => file.id !== fileId);

      setFileName(updatedFiles.length > 0 ? updatedFiles[0].fileName : "");

      if (workspace) {
        void deleteUploadedAttendanceFile(fileId).catch((error) => {
          console.error("Failed to delete uploaded file from Supabase:", error);
          toast.error(
            "Database sync failed",
            "File was removed on screen but failed to delete from database."
          );
        });
      }

      if (fileToDelete) {
        const deletedDates = new Set<string>();

        fileToDelete.lateRecords.forEach((record) =>
          deletedDates.add(normalizeDate(record.date))
        );
        fileToDelete.generatedUndertimes.forEach((record) =>
          deletedDates.add(normalizeDate(record.date))
        );

        const remainingDates = new Set<string>();
        updatedFiles.forEach((file) => {
          file.lateRecords.forEach((record) =>
            remainingDates.add(normalizeDate(record.date))
          );
          file.generatedUndertimes.forEach((record) =>
            remainingDates.add(normalizeDate(record.date))
          );
        });

        const datesToRemove = Array.from(deletedDates).filter(
          (dateValue) => !remainingDates.has(dateValue)
        );

        if (datesToRemove.length > 0) {
          setExemptions((prev) =>
            prev.filter((item) => !datesToRemove.includes(normalizeDate(item.date)))
          );
          setAbsences((prev) =>
            prev.filter((item) => !datesToRemove.includes(normalizeDate(item.date)))
          );
          setManualUndertimes((prev) =>
            prev.filter((item) => !datesToRemove.includes(normalizeDate(item.date)))
          );

          if (workspace) {
            void deleteAttendanceAdjustmentsByDates(workspace, datesToRemove).catch(
              (error) => {
                console.error(
                  "Failed to delete related adjustments from Supabase:",
                  error
                );
              }
            );
          }
        }
      }

      return updatedFiles;
    });
  };

  const clearAllAttendanceHistory = () => {
    setFileName("");
    setUploadedFiles([]);
    setExemptions([]);
    setAbsences([]);
    setManualUndertimes([]);
    setReadMemoEmployeeNames([]);
    setSelectedMonthScope("all");
    setSelectedDayScope("all");

    if (workspace) {
      void clearWorkspaceAttendanceData(workspace).catch((error) => {
        console.error("Failed to clear Supabase attendance data:", error);
        toast.error(
          "Database sync failed",
          "Records were cleared on screen but failed to clear from database."
        );
      });
    }

    if (typeof window !== "undefined" && storageKey) {
      window.localStorage.removeItem(storageKey);
    }
  };

  const deleteAbsencesByMonth = (monthKey: string) => {
    setAbsences((prev) =>
      prev.filter((record) => getMonthKey(record.date) !== monthKey)
    );

    if (workspace) {
      void deleteAbsencesByMonthFromDatabase(workspace, monthKey).catch((error) => {
        console.error("Failed to delete absences from Supabase:", error);
      });
    }
  };

  const deleteExemptionsByMonth = (monthKey: string) => {
    setExemptions((prev) =>
      prev.filter((record) => getMonthKey(record.date) !== monthKey)
    );

    if (workspace) {
      void deleteExemptionsByMonthFromDatabase(workspace, monthKey).catch(
        (error) => {
          console.error("Failed to delete exemptions from Supabase:", error);
        }
      );
    }
  };

  const restoreExemption = (id: string) => {
    setExemptions((prev) => prev.filter((record) => record.id !== id));

    void deleteExemptionRecord(id).catch((error) => {
      console.error("Failed to delete exemption from Supabase:", error);
    });
  };

  const deleteManualUndertimesByMonth = (monthKey: string) => {
    setManualUndertimes((prev) =>
      prev.filter((record) => getMonthKey(record.date) !== monthKey)
    );

    if (workspace) {
      void deleteManualUndertimesByMonthFromDatabase(workspace, monthKey).catch(
        (error) => {
          console.error("Failed to delete manual undertimes from Supabase:", error);
        }
      );
    }
  };

  const restoreManualUndertime = (id: string) => {
    setManualUndertimes((prev) => prev.filter((record) => record.id !== id));

    void deleteManualUndertimeRecord(id).catch((error) => {
      console.error("Failed to delete manual undertime from Supabase:", error);
    });
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

    const WAIS_EMPLOYEES = [
      "Agravio, John Maric",
      "Aquino, Armando",
      "Cantillon, Ma. Louissa",
      "Codilan, Ian Christopher",
      "Cruz, Gino",
      "Cruz, Nathaniel Philip",
      "Engay, Lovely Jane",
      "Loterte, Jenny Lyn",
      "Pascua, Joseph",
      "Pascual, Lucky Joy",
      "Pesquerra, Louis Gabriel",
      "Ramirez, Rejohn",
      "Raquem, Karl Anthony",
      "Tapat, Leilani",
      "Yatsu, Nanako",
    ];

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

    const waisSet = new Set(WAIS_EMPLOYEES.map(cleanName));

const getTeam = (name: string) => {
  const normalized = cleanName(name);

  if (waisSet.has(normalized)) return "WAIS";

  return "APP";
};

    const sortByName = <T extends { name: string }>(items: T[]) =>
      [...items].sort((a, b) => a.name.localeCompare(b.name));

    const byTeam = <T extends { name: string }>(items: T[], team: string) =>
      sortByName(items.filter((item) => getTeam(item.name) === team));

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
      sheet.views = [{ showGridLines: false }];

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
      rows: (string | number)[][],
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

          cell.font = {
            name: "Arial",
            size: 9,
            bold: index === 0,
            color: { argb: isMemo ? "C00000" : "111827" },
          };

          cell.alignment = {
            horizontal: index === 0 ? "left" : "center",
            vertical: "middle",
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
        rows: (string | number)[][];
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
      items.map((item) => [
        item.name,
        item.date,
        item.timeIn,
        item.minutesLate,
        item.secondsLate,
        item.sourceFileName,
      ]);

    const exemptionRows = (items: Exemption[]) =>
      items.map((item) => [item.name, item.date, item.reason]);

    const absenceRows = (items: AbsentRecord[]) =>
      items.map((item) => [item.name, item.date, item.reason, "Manual"]);

    const systemUndertimeRows = (items: GeneratedUndertime[]) =>
      items.map((item) => [
        item.name,
        item.date,
        item.timeIn,
        item.sourceFileName,
      ]);

    const manualUndertimeRows = (items: UndertimeRecord[]) =>
      items.map((item) => [
        item.name,
        item.date,
        item.reason,
        item.undertimeHours,
      ]);

    const lateSheet = workbook.addWorksheet("Late Summary");
    const absenceSheet = workbook.addWorksheet("Absence & Undertime");

    setupSheet(
      lateSheet,
      "TIMECORE HR ATTENDANCE REPORT",
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
          label: "WAIS (ADMIN)",
          team: "WAIS",
          rows: summaryRows(byTeam(lateSummary, "WAIS")),
          memoColumnIndex: 3,
        },
        {
          label: "APP (PRODUCTION)",
          team: "APP",
          rows: summaryRows(byTeam(lateSummary, "APP")),
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
          label: "WAIS (ADMIN)",
          team: "WAIS",
          rows: lateRows(byTeam(lateRecords, "WAIS")),
        },
        {
          label: "APP (PRODUCTION)",
          team: "APP",
          rows: lateRows(byTeam(lateRecords, "APP")),
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
          label: "WAIS (ADMIN)",
          team: "WAIS",
          rows: exemptionRows(byTeam(exemptions, "WAIS")),
        },
        {
          label: "APP (PRODUCTION)",
          team: "APP",
          rows: exemptionRows(byTeam(exemptions, "APP")),
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
      "TIMECORE HR ATTENDANCE REPORT",
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
          label: "WAIS (ADMIN)",
          team: "WAIS",
          rows: absenceRows(byTeam(absences, "WAIS")),
        },
        {
          label: "APP (PRODUCTION)",
          team: "APP",
          rows: absenceRows(byTeam(absences, "APP")),
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
      9,
      "SYSTEM UNDERTIME BY HR",
      ["Employee", "Date", "Time In", "Source File"],
      [
        {
          label: "WAIS (ADMIN)",
          team: "WAIS",
          rows: systemUndertimeRows(byTeam(generatedUndertimes, "WAIS")),
        },
        {
          label: "APP (PRODUCTION)",
          team: "APP",
          rows: systemUndertimeRows(byTeam(generatedUndertimes, "APP")),
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
          label: "WAIS (ADMIN)",
          team: "WAIS",
          rows: manualUndertimeRows(byTeam(manualUndertimes, "WAIS")),
        },
        {
          label: "APP (PRODUCTION)",
          team: "APP",
          rows: manualUndertimeRows(byTeam(manualUndertimes, "APP")),
        },
        {
          label: "UNASSIGNED",
          team: "UNASSIGNED",
          rows: manualUndertimeRows(byTeam(manualUndertimes, "UNASSIGNED")),
        },
      ]
    );

    workbook.creator = "TimeCore HR Attendance System";
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

  return (
    <AttendanceContext.Provider
      value={{
        loading: authLoading || !isStorageHydrated,
        fileName,
        uploadedFiles,
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
        handleFileUpload,
        addExemption,
        addAbsence,
        addUndertime,
        convertLateToUndertime,
        deleteUploadedFile,
        clearAllAttendanceHistory,
        deleteAbsencesByMonth,
        deleteExemptionsByMonth,
        deleteManualUndertimesByMonth,
        restoreExemption,
        restoreManualUndertime,
        markAllMemoAlertsAsRead,
        exportFilteredWorkbook,
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