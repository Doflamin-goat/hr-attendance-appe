-- MAIN upload provenance: client reads only; writes remain in existing owner RPCs/triggers.
-- Forward-only proposal. Do not apply automatically. Does not change migration 037.
begin;

alter table public.main_attendance_sources enable row level security;

-- No browser workflow inserts, updates, or deletes these links directly.
revoke all privileges on table public.main_attendance_sources from public, anon, authenticated;
grant select on table public.main_attendance_sources to authenticated;

create policy "MAIN HR and Admin read attendance sources"
on public.main_attendance_sources
for select to authenticated
using (
  auth.uid() is not null
  and public.attendance_role() in ('HR', 'Admin')
  and public.attendance_workspace() = 'WAIS'
  and public.attendance_hr_scope() = 'MAIN'
  and exists (
    select 1 from public.main_daily_attendance d
    where d.id = main_attendance_sources.daily_attendance_id
      and d.workspace = 'WAIS'
  )
  and exists (
    select 1 from public.uploaded_files f
    where f.id = main_attendance_sources.source_file_id
      and f.workspace = 'WAIS'
  )
);

-- Intentionally no is_deleted filter: soft deletion/restoration retains provenance.
-- No INSERT/UPDATE/DELETE policies, and no FORCE ROW LEVEL SECURITY: existing
-- SECURITY DEFINER import/reconciliation/Trash functions must retain owner access.
-- Their own authorization checks remain a separate security boundary.
commit;
