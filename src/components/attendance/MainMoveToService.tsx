import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useAttendance } from "../../context/AttendanceContext";
import { Button, Card, Select, SectionHeader, AlertMessage, toast } from "../ui";
import { listEligibleMainServices, moveMainGeneratedAttendanceToService, type MainServiceAttendanceType, type ServiceEvent } from "../../services/serviceService";

const displayTime = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

/** Render only beside generated rows. The RPC revalidates source and role. */
export function MainMoveToService({ type, recordId, onMoved }: {
  type: MainServiceAttendanceType;
  recordId: string;
  onMoved?: () => Promise<void>;
}) {
  const { workspace, hrScope, role } = useAuth();
  const { refreshAttendanceData } = useAttendance();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<ServiceEvent[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  if (workspace !== "WAIS" || hrScope !== "MAIN" || role !== "HR") return null;

  const load = async () => {
    setOpen(true); setBusy(true); setError(""); setOptions([]); setSelected("");
    try {
      const records = await listEligibleMainServices(type, recordId);
      setOptions(records);
      if (records.length === 1) setSelected(records[0].id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load eligible Services."); }
    finally { setBusy(false); }
  };
  const move = async () => {
    if (!selected || busy) return;
    setBusy(true); setError("");
    try { await moveMainGeneratedAttendanceToService(type, recordId, selected); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not move attendance to Service."); setBusy(false); return; }
    setOpen(false);
    toast.success("Generated attendance reconciled with Service");
    try { await refreshAttendanceData(); await onMoved?.(); }
    catch { toast.error("Service saved", "Attendance could not be refreshed. Reopen this page to load the saved result."); }
    finally { setBusy(false); }
  };

  return <>
    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void load()}>Move to Service</Button>
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label="Move to Service">
      <Card className="w-full max-w-lg text-left">
        <SectionHeader title="Move to Service" description="Select the Service that explains this attendance gap. The employee will be added if needed." />
        {error && <div className="mt-4"><AlertMessage tone="error" title="Could not continue" message={error} /></div>}
        {busy && options.length === 0 ? <p className="mt-4 text-sm text-slate-600">Loading eligible Services…</p>
          : !error && options.length === 0 ? <p className="mt-4 text-sm text-slate-600">No eligible Service covers this attendance gap.</p>
          : options.length > 0 && <Select className="mt-4" label="Eligible Service" value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}>
            <option value="">Select Service</option>
            {options.map((event) => <option key={event.id} value={event.id}>{event.serviceRef} — {displayTime(event.serviceStart)} to {event.serviceEnd ? displayTime(event.serviceEnd) : "In Service"}</option>)}
          </Select>}
        <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Close</Button>
          {options.length > 0 && <Button disabled={busy || !selected} onClick={() => void move()}>{busy ? "Saving…" : "Move to Service"}</Button>}
        </div>
      </Card>
    </div>}
  </>;
}
