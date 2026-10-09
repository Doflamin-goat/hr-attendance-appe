import { useEffect, useMemo, useState } from "react";
import {
  Trash2,
  RotateCcw,
  FileSpreadsheet,
  RefreshCw,
  Layers,
  ShieldCheck,
  UserX,
  Clock3,
  Clock,
  ClipboardList,
  CalendarDays,
} from "lucide-react";
import { useAttendance } from "../context/AttendanceContext";
import { useAuth } from "../context/AuthContext";
import { listDeletedServiceEvents, permanentlyDeleteServiceEvent, restoreServiceEvent, type ServiceEvent } from "../services/serviceService";
import {
  PageHeader,
  Card,
  Button,
  Badge,
  SectionHeader,
  EmptyState,
  SkeletonTable,
  ConfirmModal,
  DataTable,
  type Column,
} from "../components/ui";
import type {
  DeletedManualHrRow,
  DeletedManualHrType,
  DeletedUploadedFileRow,
} from "../services/attendanceService";

type PendingAction =
  | { kind: "restore"; file: DeletedUploadedFileRow }
  | { kind: "remove"; file: DeletedUploadedFileRow }
  | null;

type ManualPendingAction =
  | { kind: "restore"; record: DeletedManualHrRow }
  | { kind: "remove"; record: DeletedManualHrRow }
  | null;

const MANUAL_TYPE_LABEL: Record<DeletedManualHrType, string> = {
  exemption: "Exemption",
  absence: "Absence",
  manual_undertime: "Manual undertime",
  manual_late: "Manual late",
  half_day: "Half-day",
};

const MANUAL_TYPE_TONE: Record<
  DeletedManualHrType,
  "brand" | "danger" | "warning"
> = {
  exemption: "brand",
  absence: "danger",
  manual_undertime: "warning",
  manual_late: "warning",
  half_day: "brand",
};

function ManualTypeIcon({ type }: { type: DeletedManualHrType }) {
  if (type === "exemption") return <ShieldCheck className="w-3.5 h-3.5" />;
  if (type === "absence") return <UserX className="w-3.5 h-3.5" />;
  if (type === "manual_late") return <Clock className="w-3.5 h-3.5" />;
  if (type === "half_day") return <CalendarDays className="w-3.5 h-3.5" />;
  return <Clock3 className="w-3.5 h-3.5" />;
}

function formatDeletedAt(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

const REASON_LABELS: Record<string, string> = {
  uploaded_file_deleted: "File deleted",
  uploaded_file_cascade: "Cascade from file delete",
  month_deleted: "Month delete",
  workspace_cleared: "Clear all history",
  exemption_deleted: "Exemption deleted",
  exemption_removed_for_late: "Exemption removed (late restored)",
  manual_undertime_deleted: "Manual undertime deleted",
  manual_undertime_removed_for_late: "Manual undertime removed (late restored)",
  absence_deleted: "Absence deleted",
  half_day_deleted: "Half-day deleted",
};

function readableReason(reason: string | null): string {
  if (!reason) return "—";
  return REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
}

function ReasonCell({ row }: { row: DeletedUploadedFileRow }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
        {readableReason(row.deletedReason)}
      </span>
      {row.deletedBatchId && (
        <span
          title={`Batch id: ${row.deletedBatchId}`}
          className="inline-flex items-center gap-1 rounded-md border border-brand-100 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700"
        >
          <Layers className="w-3 h-3" />
          Batch
        </span>
      )}
    </div>
  );
}

export function RecycleBin() {
  const { workspace, hrScope, role } = useAuth();
  const {
    deletedAttendanceData,
    deletedAttendanceLoading,
    deletedAttendanceCount,
    loadDeletedAttendanceData,
    restoreUploadedFileBatch,
    removeUploadedFileFromRecycleBin,
    restoreManualHrRecord,
    removeManualHrRecordFromRecycleBin,
    deleteAllRecycleBinItems,
  } = useAttendance();

  const [pending, setPending] = useState<PendingAction>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manualPending, setManualPending] = useState<ManualPendingAction>(null);
  const [manualBusyId, setManualBusyId] = useState<string | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllBusy, setDeleteAllBusy] = useState(false);
  const [deletedServices, setDeletedServices] = useState<ServiceEvent[]>([]);
  const [serviceBusy, setServiceBusy] = useState<string | null>(null);
  const isWaisMainHr = workspace === "WAIS" && hrScope === "MAIN" && role === "HR";
  const hideDeletedBy = isWaisMainHr || (workspace === "APP" && hrScope === "ITC" && role === "HR");

  useEffect(() => {
    void loadDeletedAttendanceData();
    if (workspace && role === "HR") void listDeletedServiceEvents(workspace).then(setDeletedServices).catch(() => setDeletedServices([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, role]);

  const refreshDeletedServices = async () => { if (!workspace || role !== "HR") return; setDeletedServices(await listDeletedServiceEvents(workspace)); };

  const handleConfirmRestore = async () => {
    if (!pending || pending.kind !== "restore") return;
    setBusyId(pending.file.id);
    try {
      await restoreUploadedFileBatch(pending.file.id);
      setPending(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmRemove = async () => {
    if (!pending || pending.kind !== "remove") return;
    setBusyId(pending.file.id);
    try {
      await removeUploadedFileFromRecycleBin(pending.file.id);
      setPending(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmManualRestore = async () => {
    if (!manualPending || manualPending.kind !== "restore") return;
    setManualBusyId(manualPending.record.id);
    try {
      await restoreManualHrRecord(
        manualPending.record.type,
        manualPending.record.id
      );
      setManualPending(null);
    } finally {
      setManualBusyId(null);
    }
  };

  const handleConfirmManualRemove = async () => {
    if (!manualPending || manualPending.kind !== "remove") return;
    setManualBusyId(manualPending.record.id);
    try {
      await removeManualHrRecordFromRecycleBin(
        manualPending.record.type,
        manualPending.record.id
      );
      setManualPending(null);
    } finally {
      setManualBusyId(null);
    }
  };

  const manualColumns: Column<DeletedManualHrRow>[] = useMemo(
    () => [
      {
        key: "type",
        header: "Type",
        className: `${isWaisMainHr ? "w-[112px] !px-2 align-middle" : "w-28"} ${isWaisMainHr ? "text-center" : ""}`,
        headerClassName: isWaisMainHr ? "w-[112px] text-center" : "w-28",
        render: (row) => (
          <Badge className={isWaisMainHr ? "min-w-[92px] justify-center whitespace-nowrap" : ""} tone={MANUAL_TYPE_TONE[row.type]}>
            <ManualTypeIcon type={row.type} />
            {MANUAL_TYPE_LABEL[row.type]}
          </Badge>
        ),
      },
      {
        key: "name",
        header: "Employee",
        className: isWaisMainHr ? "w-[156px] align-middle" : "w-48",
        headerClassName: isWaisMainHr ? "w-[156px]" : "w-48",
        render: (row) => (
          <span className={`font-medium text-slate-900 block ${isWaisMainHr ? "break-words leading-5" : "truncate"}`}>
            {row.name || "—"}
          </span>
        ),
      },
      {
        key: "date",
        header: "Date",
        className: isWaisMainHr ? "w-[96px] align-middle" : "w-32",
        headerClassName: isWaisMainHr ? "w-[96px]" : "w-32",
        render: (row) => (
          <span className="text-xs text-slate-600 tabular-nums">
            {row.date || "—"}
          </span>
        ),
      },
      {
        key: "details",
        header: "Period / Source",
        className: `${isWaisMainHr ? "w-[230px] align-middle" : "w-[340px]"} whitespace-pre-line break-words`,
        headerClassName: isWaisMainHr ? "w-[230px]" : "w-[340px]",
        render: (row) => <span className="block whitespace-pre-line break-words text-xs leading-5 text-slate-600">{row.details || "—"}</span>,
      },
      ...(!hideDeletedBy ? [{
        key: "deletedBy",
        header: "Deleted By",
        className: "w-36",
        headerClassName: "w-36",
        render: (row: DeletedManualHrRow) => <span className="break-all text-xs text-slate-600">{row.deletedBy || "—"}</span>,
      } satisfies Column<DeletedManualHrRow>] : []),
      {
        key: "deletedAt",
        header: "Moved to Trash",
        className: `${isWaisMainHr ? "w-[168px] align-middle" : "w-48"} whitespace-normal`,
        headerClassName: isWaisMainHr ? "w-[168px]" : "w-48",
        render: (row) => (
          <span className={`text-xs leading-5 text-slate-600 ${isWaisMainHr ? "whitespace-normal" : "whitespace-nowrap"}`}>
            {formatDeletedAt(row.deletedAt)}
          </span>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        align: "right",
        className: isWaisMainHr ? "w-[272px] align-middle" : "w-[290px]",
        headerClassName: isWaisMainHr ? "w-[272px]" : "w-[290px]",
        render: (row) => (
          <div className={`flex min-w-max flex-nowrap items-center justify-end ${isWaisMainHr ? "gap-1.5" : "gap-2"}`}>
            <Button
              variant="primary"
              size="sm"
              className={isWaisMainHr ? "!px-2" : ""}
              leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
              loading={
                manualBusyId === row.id && manualPending?.kind === "restore"
              }
              disabled={manualBusyId !== null && manualBusyId !== row.id}
              onClick={() => setManualPending({ kind: "restore", record: row })}
            >
              Restore
            </Button>
            <Button
              variant="danger"
              size="sm"
              className={isWaisMainHr ? "!px-2" : ""}
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
              loading={
                manualBusyId === row.id && manualPending?.kind === "remove"
              }
              disabled={manualBusyId !== null && manualBusyId !== row.id}
              onClick={() => setManualPending({ kind: "remove", record: row })}
            >
              Delete Permanently
            </Button>
          </div>
        ),
      },
    ],
    [hideDeletedBy, manualBusyId, manualPending]
  );

  const columns: Column<DeletedUploadedFileRow>[] = useMemo(
    () => [
      {
        key: "fileName",
        header: "File Name",
        render: (row) => (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600 border border-slate-200 flex-shrink-0">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <span className="font-medium text-slate-900 truncate">
              {row.fileName}
            </span>
          </div>
        ),
      },
      {
        key: "records",
        header: "Records",
        render: (row) => (
          <span className="text-xs text-slate-600 tabular-nums">
            {row.lateCount} late / {row.undertimeCount} undertime
          </span>
        ),
      },
      {
        key: "deletedAt",
        header: "Moved to Trash",
        render: (row) => (
          <span className="text-xs text-slate-600">
            {formatDeletedAt(row.deletedAt)}
          </span>
        ),
      },
      {
        key: "reason",
        header: "Reason",
        render: (row) => <ReasonCell row={row} />,
      },
      {
        key: "actions",
        header: "Actions",
        align: "right",
        render: (row) => (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
              loading={busyId === row.id && pending?.kind === "restore"}
              disabled={busyId !== null && busyId !== row.id}
              onClick={() => setPending({ kind: "restore", file: row })}
            >
              Restore Batch
            </Button>
            <Button
              variant="danger"
              size="sm"
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
              loading={busyId === row.id && pending?.kind === "remove"}
              disabled={busyId !== null && busyId !== row.id}
              onClick={() => setPending({ kind: "remove", file: row })}
            >
              Delete Permanently
            </Button>
          </div>
        ),
      },
    ],
    [busyId, pending]
  );

  const uploadedFilesCount = deletedAttendanceData.uploadedFiles.length;
  const manualHrCount = deletedAttendanceData.manualHrRecords.length;

  const handleDeleteAll = async () => {
    if (deletedAttendanceCount === 0) return;
    setDeleteAllBusy(true);
    try {
      await deleteAllRecycleBinItems();
      setDeleteAllOpen(false);
    } finally {
      setDeleteAllBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recycle Bin"
        description="Records that were moved to Trash. Uploaded files are shown separately from manual HR records so each item can be restored or permanently deleted."
        actions={
          <>
            <Badge tone="neutral">
              {deletedAttendanceCount} item
              {deletedAttendanceCount === 1 ? "" : "s"} in Trash
            </Badge>
            {deletedAttendanceCount > 0 && (
              <Button
                variant="danger"
                leftIcon={<Trash2 className="w-4 h-4" />}
                onClick={() => setDeleteAllOpen(true)}
                disabled={deletedAttendanceLoading || deleteAllBusy}
              >
                Delete All
              </Button>
            )}
            <Button
              variant="secondary"
              leftIcon={<RefreshCw className="w-4 h-4" />}
              onClick={() => void loadDeletedAttendanceData()}
              disabled={deletedAttendanceLoading}
            >
              Refresh
            </Button>
          </>
        }
      />

      <Card padded={false}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3 flex-wrap">
          <SectionHeader
            icon={<FileSpreadsheet className="w-5 h-5" />}
            iconTone="brand"
            title="Deleted Uploaded Files"
            description="Restoring an uploaded file brings back the file and the late / undertime records generated from it. Manual HR records are never affected."
          />
          <Badge tone="neutral">
            {uploadedFilesCount} file{uploadedFilesCount === 1 ? "" : "s"}
          </Badge>
        </div>

        {deletedAttendanceLoading ? (
          <SkeletonTable rows={3} columns={5} />
        ) : uploadedFilesCount === 0 ? (
          <EmptyState
            icon={<Trash2 className="w-6 h-6" />}
            title="No uploaded files in Trash"
            description="Deleting an attendance file from the dashboard moves it here. You can restore or permanently delete it."
            bordered={false}
            className="py-10"
          />
        ) : (
          <DataTable
            columns={columns}
            rows={deletedAttendanceData.uploadedFiles}
            rowKey={(row) => row.id}
            dense
          />
        )}
      </Card>

      <Card padded={false}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3 flex-wrap">
          <SectionHeader
            icon={<ClipboardList className="w-5 h-5" />}
            iconTone="warning"
            title="Deleted HR Records"
            description="Soft-deleted HR records, including manual entries and generated Half-Days. Restoring returns the record to its page; generated Half-Days retain their conversion source."
          />
          <Badge tone="neutral">
            {manualHrCount} record{manualHrCount === 1 ? "" : "s"}
          </Badge>
        </div>

        {deletedAttendanceLoading ? (
          <SkeletonTable rows={3} columns={5} />
        ) : manualHrCount === 0 ? (
          <EmptyState
            icon={<Trash2 className="w-6 h-6" />}
            title="No manual HR records in Trash"
            description="Deleting an Exemption, Absence, or Manual Undertime moves it here. You can restore or permanently delete it."
            bordered={false}
            className="py-10"
          />
        ) : (
            <div className={isWaisMainHr ? "w-full overflow-x-auto md:overflow-x-visible" : "w-full overflow-x-auto"}>
              <DataTable
                columns={manualColumns}
                rows={deletedAttendanceData.manualHrRecords}
                rowKey={(row) => `${row.type}-${row.id}`}
                className={isWaisMainHr ? "min-w-[1034px]" : hideDeletedBy ? "min-w-[1260px]" : "min-w-[1404px]"}
                dense
              />
            </div>
        )}
      </Card>

      {role === "HR" && <Card padded={false}><div className="px-5 py-4 border-b border-slate-200"><SectionHeader icon={<ClipboardList className="w-5 h-5" />} iconTone="brand" title="Deleted Service Records" description="Restore or permanently delete soft-deleted Service records." /></div>{deletedServices.length === 0 ? <EmptyState title="No deleted Service records" description="Deleted Service records will appear here." bordered={false} className="py-8" /> : <div className="divide-y divide-slate-100">{deletedServices.map((row) => <div key={row.id} className="flex items-center justify-between gap-4 px-5 py-4"><div className="min-w-0"><p className="font-semibold text-slate-900">{row.serviceRef}</p><p className="truncate text-sm text-slate-600">{row.client || "No client"} / {row.location || "No location"}</p><p className="text-xs text-slate-500">{row.purpose || "No service type"}</p></div><div className="flex shrink-0 gap-2"><Button size="sm" variant="primary" loading={serviceBusy === row.id} onClick={async () => { setServiceBusy(row.id); try { await restoreServiceEvent(row.id, workspace!); await refreshDeletedServices(); } finally { setServiceBusy(null); } }}>Restore</Button><Button size="sm" variant="danger" loading={serviceBusy === row.id} onClick={async () => { setServiceBusy(row.id); try { await permanentlyDeleteServiceEvent(row.id, workspace!); await refreshDeletedServices(); } finally { setServiceBusy(null); } }}>Delete Permanently</Button></div></div>)}</div>}</Card>}

      <ConfirmModal
        open={deleteAllOpen}
        tone="danger"
        title="Permanently delete all items?"
        description="This will permanently delete all items currently in your Recycle Bin. This action cannot be undone."
        confirmLabel="Delete All Permanently"
        loading={deleteAllBusy}
        onConfirm={handleDeleteAll}
        onCancel={() => (deleteAllBusy ? null : setDeleteAllOpen(false))}
      />

      <ConfirmModal
        open={pending?.kind === "restore"}
        tone="primary"
        title="Restore this batch?"
        description={
          pending?.kind === "restore" ? (
            <>
              This will restore{" "}
              <span className="font-semibold">{pending.file.fileName}</span> and
              the late / undertime records generated from it. Manual HR records
              (exemptions, absences, manual undertime) are not affected by this
              restore.
            </>
          ) : null
        }
        confirmLabel="Restore Batch"
        loading={busyId === pending?.file.id && pending?.kind === "restore"}
        onConfirm={handleConfirmRestore}
        onCancel={() => (busyId ? null : setPending(null))}
      />

      <ConfirmModal
        open={pending?.kind === "remove"}
        tone="danger"
        title="Permanently delete this batch?"
        description={
          pending?.kind === "remove" ? (
            <>
              <span className="font-semibold">{pending.file.fileName}</span> and
               its related trashed records will be permanently deleted. This action cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete Permanently"
        loading={busyId === pending?.file.id && pending?.kind === "remove"}
        onConfirm={handleConfirmRemove}
        onCancel={() => (busyId ? null : setPending(null))}
      />

      <ConfirmModal
        open={manualPending?.kind === "restore"}
        tone="primary"
        title="Restore this HR record?"
        description={
          manualPending?.kind === "restore" ? (
            <>
              This will return the{" "}
              <span className="font-semibold">
                {MANUAL_TYPE_LABEL[manualPending.record.type].toLowerCase()}
              </span>{" "}
              for{" "}
              <span className="font-semibold">
                {manualPending.record.name || "this employee"}
              </span>{" "}
              on {manualPending.record.date} back to its page. {manualPending.record.type === "half_day" && manualPending.record.details ? <span className="mt-2 block">{manualPending.record.details}</span> : null} No uploaded files
              or Late Records will be touched.
            </>
          ) : null
        }
        confirmLabel="Restore Record"
        loading={
          manualBusyId === manualPending?.record.id &&
          manualPending?.kind === "restore"
        }
        onConfirm={handleConfirmManualRestore}
        onCancel={() => (manualBusyId ? null : setManualPending(null))}
      />

      <ConfirmModal
        open={manualPending?.kind === "remove"}
        tone="danger"
        title="Permanently delete this record?"
        description={
          manualPending?.kind === "remove" ? (
            <>
              The{" "}
              <span className="font-semibold">
                {MANUAL_TYPE_LABEL[manualPending.record.type].toLowerCase()}
              </span>{" "}
              for{" "}
              <span className="font-semibold">
                {manualPending.record.name || "this employee"}
              </span>{" "}
               will be permanently deleted. This action cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete Permanently"
        loading={
          manualBusyId === manualPending?.record.id &&
          manualPending?.kind === "remove"
        }
        onConfirm={handleConfirmManualRemove}
        onCancel={() => (manualBusyId ? null : setManualPending(null))}
      />
    </div>
  );
}
