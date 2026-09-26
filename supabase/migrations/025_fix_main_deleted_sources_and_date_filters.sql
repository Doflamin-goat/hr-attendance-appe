-- Repair MAIN attendance source deletion and active-date filtering.
-- FORWARD-ONLY. DO NOT APPLY AUTOMATICALLY. Requires migrations 022-024.
begin;

create or replace function public.delete_main_attendance_upload(p_file_id uuid,p_batch_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or public.attendance_role()<>'HR' or public.attendance_hr_scope()<>'MAIN' then
    raise exception 'MAIN HR access required';
  end if;
  if not exists(select 1 from public.uploaded_files where id=p_file_id and workspace='WAIS' and not is_deleted) then
    raise exception 'Active MAIN upload not found';
  end if;

  -- Mark the file first so every later active-source check observes the new state.
  update public.uploaded_files
  set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id,
      deleted_reason='uploaded_file_deleted',removed_from_recycle_bin=false
  where id=p_file_id and workspace='WAIS' and not is_deleted;
  if not found then raise exception 'MAIN upload could not be moved to Trash'; end if;

  update public.main_daily_attendance d
  set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id
  where not d.is_deleted
    and (d.source_file_id=p_file_id or exists(
      select 1 from public.main_attendance_sources s
      where s.daily_attendance_id=d.id and s.source_file_id=p_file_id
    ))
    and not exists(
      select 1 from public.uploaded_files f
      where f.id=d.source_file_id and not f.is_deleted
    )
    and not exists(
      select 1 from public.main_attendance_sources s
      join public.uploaded_files f on f.id=s.source_file_id and not f.is_deleted
      where s.daily_attendance_id=d.id
    );

  -- Generated records remain soft-deleted audit data. A second active upload
  -- keeps its own generated records; manual records are never touched.
  update public.late_records
  set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id,
      deleted_reason='uploaded_file_deleted'
  where source_file_id=p_file_id::text and not is_deleted;
  update public.generated_undertimes
  set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id,
      deleted_reason='uploaded_file_deleted'
  where source_file_id=p_file_id::text and not is_deleted;
  update public.half_day_records
  set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id,
      deleted_reason='uploaded_file_deleted'
  where source_file_id=p_file_id and source_type='attendance_upload' and not is_deleted;
  update public.absences
  set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id,
      deleted_reason='uploaded_file_deleted'
  where source_file_id=p_file_id and source_type='system_generated' and not is_deleted;
end $$;

commit;
