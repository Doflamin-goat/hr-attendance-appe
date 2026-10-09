-- APP / ITC only: reuse the original converted Half-Day row when its soft
-- deletion still occupies the unconditional (employee,date,period) unique key.
-- Apply manually after 059; do not rerun earlier migrations.
begin;

create or replace function public.move_generated_undertime_to_half_day(p_id bigint)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  undertime_row public.generated_undertimes%rowtype;
  employee_row public.employees%rowtype;
  existing_half_day public.half_day_records%rowtype;
  employee_matches integer;
  half_day_id uuid;
  parsed_time time;
  schedule_start time;
  schedule_end time;
begin
  if auth.uid() is null
     or public.attendance_role() is distinct from 'HR'
     or public.attendance_workspace() is distinct from 'APP'
     or public.attendance_hr_scope() is distinct from 'ITC' then
    raise exception 'Only APP ITC HR can move generated Undertime to Half-Day';
  end if;

  select * into undertime_row
    from public.generated_undertimes
   where id=p_id and workspace='APP' and not is_deleted
   for update;
  if undertime_row.id is null then
    raise exception 'Active system-generated Undertime not found';
  end if;

  if undertime_row.employee_id is not null then
    select * into employee_row
      from public.employees
     where id=undertime_row.employee_id and workspace='APP' and hr_scope='ITC'
       and not is_deleted
     for update;
  else
    select count(*) into employee_matches
      from public.employees e
     where e.workspace='APP' and e.hr_scope='ITC' and not e.is_deleted
       and public.employee_name_key(e.full_name)=public.employee_name_key(undertime_row.employee_name);
    if employee_matches<>1 then
      raise exception 'Generated Undertime employee cannot be uniquely resolved';
    end if;
    select * into employee_row
      from public.employees e
     where e.workspace='APP' and e.hr_scope='ITC' and not e.is_deleted
       and public.employee_name_key(e.full_name)=public.employee_name_key(undertime_row.employee_name)
     for update;
  end if;
  if employee_row.id is null then raise exception 'Employee is not in the APP/ITC workspace'; end if;
  if undertime_row.work_date is null or extract(dow from undertime_row.work_date)=0 then
    raise exception 'A valid scheduled work date is required';
  end if;

  -- Serialize conversions/restores for this employee-day before inspecting the
  -- unconditional Half-Day uniqueness key.
  perform public.lock_undertime_identity('APP',employee_row.id,undertime_row.work_date);

  parsed_time:=public.parse_itc_clock_time(undertime_row.time_in);
  if parsed_time is null or parsed_time<time '12:00' then
    raise exception 'Only generated Undertime after the morning work period can be moved to Half-Day';
  end if;

  if exists (
    select 1 from public.half_day_records h
     where h.workspace='APP' and h.employee_id=employee_row.id
       and h.work_date=undertime_row.work_date and not h.is_deleted
  ) then
    raise exception 'A Half-Day record already exists for this employee and date.';
  end if;

  if extract(dow from undertime_row.work_date)=6 then
    schedule_start:=time '07:00';
    schedule_end:=time '11:00';
  else
    schedule_start:=time '08:00';
    schedule_end:=time '12:00';
  end if;

  -- Only revive the row linked to this exact BIGINT source, and only while it
  -- remains a converted system record. Manual or unrelated deleted rows are
  -- never reused. The unique key itself is not changed.
  select h.* into existing_half_day
    from public.half_day_records h
   where h.workspace='APP' and h.employee_id=employee_row.id
     and h.work_date=undertime_row.work_date and h.absent_period='morning'
     and h.source_type='system_generated'
     and h.source_generated_undertime_id=undertime_row.id::text
     and h.source_file_id_text is not distinct from undertime_row.source_file_id::text
     and h.source_time_in is not distinct from parsed_time
     and h.is_deleted
     and (h.deleted_reason='half_day_deleted' and not coalesce(h.removed_from_recycle_bin,false)
       or h.deleted_reason='conversion_reversed_to_undertime')
   for update;

  if existing_half_day.id is not null then
    update public.half_day_records
       set employee_name=employee_row.full_name,
           scheduled_start=schedule_start,scheduled_end=schedule_end,
           reason=coalesce(nullif(btrim(undertime_row.reason),''),'Converted from generated Undertime #'||undertime_row.id::text),
           source_file_name=undertime_row.source_file_name,
           source_time_in=parsed_time,
           source_generated_undertime_id=undertime_row.id::text,
           source_file_id_text=undertime_row.source_file_id::text,
           is_deleted=false,deleted_at=null,deleted_by=null,deleted_reason=null,
           deleted_batch_id=null,restored_at=now(),restored_by=auth.uid(),
           removed_from_recycle_bin=false,removed_from_recycle_bin_at=null,
           removed_from_recycle_bin_by=null
     where id=existing_half_day.id and workspace='APP' and is_deleted
     returning id into half_day_id;
    if half_day_id is null then raise exception 'The converted Half-Day could not be restored'; end if;
  else
    if exists (
      select 1 from public.half_day_records h
       where h.workspace='APP' and h.employee_id=employee_row.id
         and h.work_date=undertime_row.work_date and h.absent_period='morning'
    ) then
      raise exception 'A Half-Day record already exists for this employee and date.';
    end if;
    insert into public.half_day_records(
      workspace,employee_id,employee_name,work_date,absent_period,
      scheduled_start,scheduled_end,reason,created_by,source_type,
      source_file_name,source_time_in,source_generated_undertime_id,source_file_id_text
    ) values (
      'APP',employee_row.id,employee_row.full_name,undertime_row.work_date,'morning',
      schedule_start,schedule_end,
      coalesce(nullif(btrim(undertime_row.reason),''),'Converted from generated Undertime #'||undertime_row.id::text),
      auth.uid(),'system_generated',undertime_row.source_file_name,parsed_time,
      undertime_row.id::text,undertime_row.source_file_id::text
    ) returning id into half_day_id;
  end if;

  update public.generated_undertimes
     set employee_id=coalesce(employee_id,employee_row.id),
         is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),
         deleted_reason='reclassified_as_half_day'
   where id=undertime_row.id and workspace='APP' and not is_deleted;
  if not found then raise exception 'Undertime changed before conversion'; end if;

  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload)
  values('APP',auth.uid(),'half_day',half_day_id::text,'generated_undertime_converted',
         jsonb_build_object('generated_undertime_id',undertime_row.id,
                            'employee_id',employee_row.id,
                            'work_date',undertime_row.work_date,
                            'scheduled_start',schedule_start,
                            'scheduled_end',schedule_end,
                            'reused_existing_half_day',existing_half_day.id is not null));
  return half_day_id;
end;
$$;

revoke all on function public.move_generated_undertime_to_half_day(bigint) from public,anon;
grant execute on function public.move_generated_undertime_to_half_day(bigint) to authenticated;

commit;
