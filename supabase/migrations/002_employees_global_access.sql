-- =====================================================================
-- Allow the HR/admin user to manage both APP and WAIS employees from a
-- single master list.
--
-- The original policies in 001_employees.sql scoped every read and write
-- to the caller's own profile workspace, which hid the other company's
-- roster. In this organisation a single HR account manages both APP and
-- WAIS, so any authenticated app user is allowed to read and write the
-- employees and audit_logs tables. Attendance-tracking tables remain
-- workspace-scoped as before.
--
-- Run this in Supabase SQL Editor after 001_employees.sql.
-- Safe to re-run.
-- =====================================================================

-- 1. Replace the employees policies with cross-workspace versions.
drop policy if exists "employees: workspace members can read" on public.employees;
drop policy if exists "employees: workspace members can write" on public.employees;

drop policy if exists "employees: authenticated can read" on public.employees;
create policy "employees: authenticated can read"
  on public.employees
  for select
  to authenticated
  using (true);

drop policy if exists "employees: authenticated can write" on public.employees;
create policy "employees: authenticated can write"
  on public.employees
  for all
  to authenticated
  using (true)
  with check (workspace in ('APP', 'WAIS'));

-- 2. Audit log: same idea — any authenticated HR user can read or insert.
drop policy if exists "audit_logs: workspace members can read" on public.audit_logs;
drop policy if exists "audit_logs: workspace members can insert" on public.audit_logs;

drop policy if exists "audit_logs: authenticated can read" on public.audit_logs;
create policy "audit_logs: authenticated can read"
  on public.audit_logs
  for select
  to authenticated
  using (true);

drop policy if exists "audit_logs: authenticated can insert" on public.audit_logs;
create policy "audit_logs: authenticated can insert"
  on public.audit_logs
  for insert
  to authenticated
  with check (workspace in ('APP', 'WAIS'));
