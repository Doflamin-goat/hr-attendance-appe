-- APP/ITC-only atomic reversal of the generated Undertime -> Half-Day action.
-- The restored Undertime keeps its original BIGINT identity; Service coverage
-- is reevaluated through the existing ITC reconciler before commit.
begin;

create or replace function public.restore_converted_half_day_to_undertime(p_half_day_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  half_day_row public.half_day_records%rowtype;
  undertime_row public.generated_undertimes%rowtype;
  source_id bigint;
  service_id uuid;
  restored_id bigint;
begin
  if auth.uid() is null
     or public.attendance_role() is distinct from 'HR'
     or public.attendance_workspace() is distinct from 'APP'
     or public.attendance_hr_scope() is distinct from 'ITC' then
    raise exception 'Only APP ITC HR can restore a converted Half-Day to Undertime';
  end if;

  select * into half_day_row
    from public.half_day_records
   where id=p_half_day_id and workspace='APP' and not is_deleted
     and source_type='system_generated'
   for update;
  if half_day_row.id is null then raise exception 'Active converted System Generated Half-Day not found'; end if;
  if nullif(btrim(half_day_row.source_generated_undertime_id),'') is null then
    raise exception 'This Half-Day has no generated Undertime conversion source';
  end if;
  begin
    source_id:=half_day_row.source_generated_undertime_id::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'The linked generated Undertime identifier is invalid';
  end;

  select * into undertime_row
    from public.generated_undertimes
   where id=source_id and workspace='APP'
   for update;
  if undertime_row.id is null
     or not undertime_row.is_deleted
     or undertime_row.deleted_reason is distinct from 'reclassified_as_half_day' then
    raise exception 'The original generated Undertime is missing or is no longer in converted state';
  end if;
  if undertime_row.work_date is distinct from half_day_row.work_date
     or public.employee_name_key(undertime_row.employee_name) is distinct from public.employee_name_key(half_day_row.employee_name)
     or (undertime_row.employee_id is not null and undertime_row.employee_id is distinct from half_day_row.employee_id)
     or undertime_row.source_file_id::text is distinct from half_day_row.source_file_id_text
     or public.parse_itc_clock_time(undertime_row.time_in) is distinct from half_day_row.source_time_in then
    raise exception 'The linked generated Undertime does not match this Half-Day';
  end if;

  if exists (
    select 1 from public.generated_undertimes u
     where u.workspace='APP' and not u.is_deleted and u.id<>undertime_row.id
       and u.work_date=undertime_row.work_date
       and (u.employee_id=half_day_row.employee_id
         or (u.employee_id is null and public.employee_name_key(u.employee_name)=public.employee_name_key(half_day_row.employee_name)))
  ) then
    raise exception 'An active generated Undertime already exists for this employee and date';
  end if;
  if exists (
    select 1 from public.manual_undertimes u
     where u.workspace='APP' and not u.is_deleted
       and u.work_date=undertime_row.work_date
       and (u.employee_id=half_day_row.employee_id
         or (u.employee_id is null and public.employee_name_key(u.employee_name)=public.employee_name_key(half_day_row.employee_name)))
  ) then
    raise exception 'A Manual Undertime already exists for this employee and date';
  end if;

  update public.generated_undertimes
     set employee_id=coalesce(employee_id,half_day_row.employee_id),
         is_deleted=false,deleted_at=null,deleted_by=null,deleted_reason=null
   where id=undertime_row.id and workspace='APP' and is_deleted
     and deleted_reason='reclassified_as_half_day'
  returning id into restored_id;
  if restored_id is null then
    raise exception 'The original generated Undertime could not be restored';
  end if;

  -- This is a conversion reversal, not a user deletion. Keep the conversion
  -- source link for audit, but hide this inactive Half-Day from Recycle Bin.
  update public.half_day_records
     set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),
         deleted_reason='conversion_reversed_to_undertime',
         removed_from_recycle_bin=true,removed_from_recycle_bin_at=now(),
         removed_from_recycle_bin_by=auth.uid()
   where id=half_day_row.id and workspace='APP' and not is_deleted;
  if not found then raise exception 'The converted Half-Day could not be deactivated'; end if;

  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload)
  values('APP',auth.uid(),'half_day',half_day_row.id::text,'conversion_reversed_to_undertime',
         jsonb_build_object('generated_undertime_id',undertime_row.id,
                            'employee_id',half_day_row.employee_id,
                            'work_date',half_day_row.work_date));

  -- Let the existing reconciler suppress the restored source again when an
  -- active/completed Service still covers this employee's attendance gap.
  for service_id in
    select distinct s.id
      from public.service_events s
      join public.service_event_employees m on m.service_event_id=s.id
        and m.employee_id=half_day_row.employee_id and m.workspace='APP'
     where s.workspace='APP' and s.status in ('in_service','completed')
       and not s.is_deleted and s.service_end is not null
       and (s.service_start at time zone 'Asia/Manila')::date<=undertime_row.work_date
       and (s.service_end at time zone 'Asia/Manila')::date>=undertime_row.work_date
  loop
    perform public.reconcile_itc_service_attendance(service_id);
  end loop;
end;
$$;

revoke all on function public.restore_converted_half_day_to_undertime(uuid) from public,anon;
grant execute on function public.restore_converted_half_day_to_undertime(uuid) to authenticated;

commit;
