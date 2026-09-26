-- Safely reconcile MAIN records that no longer have an active upload source.
-- FORWARD-ONLY. DO NOT APPLY AUTOMATICALLY. Requires migrations 022-025.
begin;

create or replace function public.reconcile_main_active_upload_records()
returns integer language plpgsql security definer set search_path='' as $$
declare
  changed integer:=0;
  affected integer;
begin
  if auth.uid() is null or public.attendance_role()<>'HR' or public.attendance_hr_scope()<>'MAIN' then
    raise exception 'MAIN HR access required';
  end if;

  update public.main_daily_attendance d
  set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='orphaned_main_upload_source'
  where d.workspace='WAIS' and not d.is_deleted
    and not exists(
      select 1 from public.uploaded_files f
      where f.id=d.source_file_id and f.workspace='WAIS' and not f.is_deleted
    )
    and not exists(
      select 1
      from public.main_attendance_sources s
      join public.uploaded_files f on f.id=s.source_file_id
      where s.daily_attendance_id=d.id and f.workspace='WAIS' and not f.is_deleted
    );
  get diagnostics affected = row_count;
  changed := changed + affected;

  update public.late_records l
  set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='orphaned_main_upload_source'
  where l.workspace='WAIS' and not l.is_deleted
    and not exists(
      select 1 from public.uploaded_files f
      where f.id::text=l.source_file_id::text and f.workspace='WAIS' and not f.is_deleted
    );
  get diagnostics affected = row_count;
  changed := changed + affected;

  update public.generated_undertimes u
  set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='orphaned_main_upload_source'
  where u.workspace='WAIS' and not u.is_deleted
    and not exists(
      select 1 from public.uploaded_files f
      where f.id::text=u.source_file_id::text and f.workspace='WAIS' and not f.is_deleted
    );
  get diagnostics affected = row_count;
  changed := changed + affected;

  update public.half_day_records h
  set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='orphaned_main_upload_source'
  where h.workspace='WAIS' and h.source_type='attendance_upload' and not h.is_deleted
    and not exists(
      select 1 from public.uploaded_files f
      where f.id=h.source_file_id and f.workspace='WAIS' and not f.is_deleted
    );
  get diagnostics affected = row_count;
  changed := changed + affected;

  update public.absences a
  set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='orphaned_main_upload_source'
  where a.workspace='WAIS' and a.source_type='system_generated' and not a.is_deleted
    and not exists(
      select 1 from public.uploaded_files f
      where f.id=a.source_file_id and f.workspace='WAIS' and not f.is_deleted
    );
  get diagnostics affected = row_count;
  changed := changed + affected;

  return changed;
end $$;

revoke all on function public.reconcile_main_active_upload_records() from public,anon;
grant execute on function public.reconcile_main_active_upload_records() to authenticated;
commit;
