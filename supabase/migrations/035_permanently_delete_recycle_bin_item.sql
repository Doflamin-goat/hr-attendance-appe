-- Permanently delete one authorized Recycle Bin item.
-- Forward-only; do not apply automatically. Requires migrations through 034.
begin;

create or replace function public.permanently_delete_recycle_bin_item(p_kind text,p_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  expected_workspace text;
  file_id uuid;
  removed integer;
begin
  if auth.uid() is null or public.attendance_role()<>'HR' then raise exception 'HR access required'; end if;
  expected_workspace:=public.attendance_workspace();

  if p_kind='uploaded_file' then
    begin file_id:=p_id::uuid; exception when invalid_text_representation then return false; end;
    if not exists(select 1 from public.uploaded_files where id=file_id and workspace=expected_workspace and is_deleted and not removed_from_recycle_bin) then return false; end if;

    update public.main_daily_attendance d set source_file_id=(
      select s.source_file_id from public.main_attendance_sources s
      join public.uploaded_files f on f.id=s.source_file_id and f.id<>file_id
      where s.daily_attendance_id=d.id order by f.uploaded_at desc limit 1
    ) where d.workspace=expected_workspace and d.source_file_id=file_id;
    delete from public.main_attendance_sources where source_file_id=file_id;
    delete from public.main_daily_attendance d where d.workspace=expected_workspace and d.is_deleted and d.source_file_id is null
      and not exists(select 1 from public.main_attendance_sources s where s.daily_attendance_id=d.id);
    delete from public.half_day_records where workspace=expected_workspace and is_deleted and source_type='attendance_upload' and source_file_id=file_id;
    delete from public.absences where workspace=expected_workspace and is_deleted and source_type='system_generated' and source_file_id=file_id;
    delete from public.generated_undertimes where workspace=expected_workspace and is_deleted and source_file_id::text=file_id::text;
    delete from public.late_records l where l.workspace=expected_workspace and l.is_deleted and l.source_file_id::text=file_id::text
      and not exists(select 1 from public.exemptions e where e.late_record_id=l.id);
    delete from public.uploaded_files where id=file_id and workspace=expected_workspace and is_deleted and not removed_from_recycle_bin;
    get diagnostics removed=row_count;
    return removed=1;
  elsif p_kind='exemption' then
    delete from public.exemptions where id::text=p_id and workspace=expected_workspace and is_deleted and not removed_from_recycle_bin;
  elsif p_kind='absence' then
    delete from public.absences where id::text=p_id and workspace=expected_workspace and is_deleted and not removed_from_recycle_bin;
  elsif p_kind='manual_undertime' then
    delete from public.manual_undertimes where id::text=p_id and workspace=expected_workspace and is_deleted and not removed_from_recycle_bin;
  elsif p_kind='manual_late' then
    delete from public.manual_late_records where id::text=p_id and workspace=expected_workspace and is_deleted and not removed_from_recycle_bin;
  elsif p_kind='half_day' then
    delete from public.half_day_records where id::text=p_id and workspace=expected_workspace and is_deleted and not removed_from_recycle_bin;
  else
    raise exception 'Unsupported Recycle Bin item type';
  end if;
  get diagnostics removed=row_count;
  return removed=1;
end $$;

revoke all on function public.permanently_delete_recycle_bin_item(text,text) from public,anon;
grant execute on function public.permanently_delete_recycle_bin_item(text,text) to authenticated;

commit;
