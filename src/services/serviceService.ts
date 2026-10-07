import { supabase } from "../lib/supabase";

export type ServiceWorkspace = "APP" | "WAIS";
export type ServiceStatus = "in_service" | "completed" | "cancelled";

export type ServiceEvent = {
  id: string;
  serviceRef: string;
  workspace: ServiceWorkspace;
  serviceStart: string;
  serviceEnd: string | null;
  client: string;
  location: string;
  purpose: string;
  remarks: string;
  status: ServiceStatus;
  employeeIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ServiceEventInput = Omit<ServiceEvent, "id" | "createdAt" | "updatedAt">;

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

function toManilaTimestamptz(value: string | null) {
  if (!value) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) return new Date(value).toISOString();
  return new Date(`${value}:00+08:00`).toISOString();
}

function throwServiceRpcError(operation: string, error: { message?: string; code?: string; details?: string; hint?: string }): never {
  if (error.code === "23505" && error.message?.includes("service_ref")) {
    throw new Error("That Service Reference is already in use.");
  }
  const fields = [error.message, error.code && `code ${error.code}`, error.details, error.hint].filter(Boolean);
  if (import.meta.env.DEV) console.error(`[Service] ${operation} failed`, { message: error.message, code: error.code, details: error.details, hint: error.hint });
  throw new Error(fields.join(" — ") || `Could not ${operation}.`);
}

function mapEvent(row: Record<string, unknown>, employeeIds: string[]): ServiceEvent {
  return {
    id: String(row.id),
    serviceRef: String(row.service_ref ?? ""),
    workspace: row.workspace === "WAIS" ? "WAIS" : "APP",
    serviceStart: String(row.service_start),
    serviceEnd: row.service_end == null ? null : String(row.service_end),
    client: String(row.client ?? ""),
    location: String(row.location ?? ""),
    purpose: String(row.purpose ?? ""),
    remarks: String(row.remarks ?? ""),
    status: row.status === "completed" || row.status === "cancelled" ? row.status : "in_service",
    employeeIds,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function listServiceEvents(workspace: ServiceWorkspace): Promise<ServiceEvent[]> {
  const db = client();
  const [{ data: events, error: eventError }, { data: links, error: linkError }] = await Promise.all([
    db.from("service_events").select("*").eq("workspace", workspace).eq("is_deleted", false).order("service_start", { ascending: false }),
    db.from("service_event_employees").select("service_event_id, employee_id").eq("workspace", workspace),
  ]);
  if (eventError) throw eventError;
  if (linkError) throw linkError;
  const byEvent = new Map<string, string[]>();
  (links ?? []).forEach((link) => byEvent.set(String(link.service_event_id), [...(byEvent.get(String(link.service_event_id)) ?? []), String(link.employee_id)]));
  return (events ?? []).map((row) => mapEvent(row as Record<string, unknown>, byEvent.get(String((row as { id: string }).id)) ?? []));
}

export async function createServiceEvent(input: ServiceEventInput) {
  if (!/^SR-\d{4}$/.test(input.serviceRef.trim())) throw new Error("Service Reference must use the format SR-0001.");
  const { data, error } = await client().rpc("create_service_event", {
    p_service_ref: input.serviceRef || null,
    p_workspace: input.workspace,
    p_service_start: toManilaTimestamptz(input.serviceStart),
    p_service_end: toManilaTimestamptz(input.serviceEnd),
    p_employee_ids: input.employeeIds,
    p_client: input.client || null,
    p_location: input.location || null,
    p_purpose: input.purpose || null,
    p_remarks: input.remarks || null,
    p_status: input.status,
  });
  if (error) throwServiceRpcError("save Service record", error);
  return String(data);
}

export async function updateServiceEvent(id: string, input: ServiceEventInput) {
  if (!/^SR-\d{4}$/.test(input.serviceRef.trim())) throw new Error("Service Reference must use the format SR-0001.");
  const { error } = await client().rpc("update_service_event", {
    p_id: id,
    p_service_ref: input.serviceRef || null,
    p_workspace: input.workspace,
    p_service_start: toManilaTimestamptz(input.serviceStart),
    p_service_end: toManilaTimestamptz(input.serviceEnd),
    p_employee_ids: input.employeeIds,
    p_client: input.client || null,
    p_location: input.location || null,
    p_purpose: input.purpose || null,
    p_remarks: input.remarks || null,
    p_status: input.status,
  });
  if (error) throwServiceRpcError("update Service record", error);
}

export async function suggestServiceReference(): Promise<string> {
  const { data, error } = await client().rpc("service_reference", { p_year: null });
  if (error) throwServiceRpcError("load Service reference", error);
  return String(data ?? "SR-0001");
}

export async function cancelServiceEvent(id: string, workspace: ServiceWorkspace) {
  const { error } = await client().rpc("cancel_service_event", { p_id: id, p_workspace: workspace });
  if (error) throw error;
}

export async function deleteServiceEvent(id: string, workspace: ServiceWorkspace) {
  const { error } = await client().rpc("delete_service_event", { p_id: id, p_workspace: workspace });
  if (error) throwServiceRpcError("delete Service record", error);
}

export async function listDeletedServiceEvents(workspace: ServiceWorkspace): Promise<ServiceEvent[]> {
  const db = client();
  const [{ data: events, error }, { data: links, error: linkError }] = await Promise.all([
    db.from("service_events").select("*").eq("workspace", workspace).eq("is_deleted", true).order("deleted_at", { ascending: false }),
    db.from("service_event_employees").select("service_event_id, employee_id").eq("workspace", workspace),
  ]);
  if (error) throw error;
  if (linkError) throw linkError;
  const byEvent = new Map<string, string[]>();
  (links ?? []).forEach((link) => byEvent.set(String(link.service_event_id), [...(byEvent.get(String(link.service_event_id)) ?? []), String(link.employee_id)]));
  return (events ?? []).map((row) => mapEvent(row as Record<string, unknown>, byEvent.get(String((row as { id: string }).id)) ?? []));
}

export async function restoreServiceEvent(id: string, workspace: ServiceWorkspace) {
  const { error } = await client().rpc("restore_service_event", { p_id: id, p_workspace: workspace });
  if (error) throwServiceRpcError("restore Service record", error);
}

export async function permanentlyDeleteServiceEvent(id: string, workspace: ServiceWorkspace) {
  const { error } = await client().rpc("permanently_delete_service_event", { p_id: id, p_workspace: workspace });
  if (error) throwServiceRpcError("permanently delete Service record", error);
}
