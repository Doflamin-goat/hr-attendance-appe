-- APP/ITC-only repair for generated Undertime -> morning Half-Day and its
-- soft-delete / restore lifecycle. Do not apply automatically.
begin;

drop function if exists public.move_generated_undertime_to_half_day(uuid);

create or replace function public.move_generated_undertime_to_half_day(p_id bigint)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  undertime_row public.generated_undertimes%rowtype;
  employee_row public.employees%rowtype;
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

  update public.generated_undertimes
     set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),
         deleted_reason='reclassified_as_half_day'
   where id=undertime_row.id and workspace='APP' and not is_deleted;
  if not found then raise exception 'Undertime changed before conversion'; end if;

  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload)
  values('APP',auth.uid(),'half_day',half_day_id::text,'generated_undertime_converted',
         jsonb_build_object('generated_undertime_id',undertime_row.id,
                            'employee_id',employee_row.id,
                            'work_date',undertime_row.work_date,
                            'scheduled_start',schedule_start,
                            'scheduled_end',schedule_end));
  return half_day_id;
end;
$$;

-- Keep the existing generic delete behavior, but enforce APP/ITC HR scope for
-- the newly introduced generated Half-Day record type.
create or replace function public.delete_half_day(p_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  half_day_row public.half_day_records%rowtype;
begin
  if auth.uid() is null or public.attendance_role() is distinct from 'HR' then
    raise exception 'Only HR can delete half-day records';
  end if;
  select * into half_day_row from public.half_day_records where id=p_id and not is_deleted for update;
  if half_day_row.id is null then raise exception 'Active half-day record not found'; end if;
  if half_day_row.workspace<>public.attendance_workspace() then raise exception 'Half-Day record is outside the current workspace'; end if;
  if half_day_row.workspace='APP' and half_day_row.source_type='system_generated'
     and public.attendance_hr_scope() is distinct from 'ITC' then
    raise exception 'Only APP ITC HR can delete this generated Half-Day';
  end if;

  update public.half_day_records
     set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),
         deleted_reason='half_day_deleted',deleted_batch_id=gen_random_uuid(),
         restored_at=null,restored_by=null,removed_from_recycle_bin=false,
         removed_from_recycle_bin_at=null,removed_from_recycle_bin_by=null
   where id=half_day_row.id and not is_deleted;

  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload)
  values(half_day_row.workspace,auth.uid(),'half_day',half_day_row.id::text,'soft_delete',
         jsonb_build_object('source_type',half_day_row.source_type,
                            'source_generated_undertime_id',half_day_row.source_generated_undertime_id,
                            'work_date',half_day_row.work_date));
end;
$$;

create or replace function public.restore_half_day(p_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  half_day_row public.half_day_records%rowtype;
begin
  if auth.uid() is null or public.attendance_role() is distinct from 'HR' then
    raise exception 'Only HR can restore half-day records';
  end if;
  select * into half_day_row from public.half_day_records where id=p_id and is_deleted and not removed_from_recycle_bin for update;
  if half_day_row.id is null then raise exception 'Deleted half-day record not found'; end if;
  if half_day_row.workspace<>public.attendance_workspace() then raise exception 'Half-Day record is outside the current workspace'; end if;

  if half_day_row.workspace='APP' and half_day_row.source_type='system_generated' then
    if public.attendance_hr_scope() is distinct from 'ITC' then
      raise exception 'Only APP ITC HR can restore this generated Half-Day';
    end if;
    if exists (
      select 1 from public.half_day_records h
       where h.workspace='APP' and h.employee_id=half_day_row.employee_id
         and h.work_date=half_day_row.work_date and not h.is_deleted and h.id<>half_day_row.id
    ) then
      raise exception 'A Half-Day record already exists for this employee and date.';
    end if;
  end if;

  update public.half_day_records
     set is_deleted=false,deleted_at=null,deleted_by=null,deleted_reason=null,
         restored_at=now(),restored_by=auth.uid(),removed_from_recycle_bin=false,
         removed_from_recycle_bin_at=null,removed_from_recycle_bin_by=null
   where id=half_day_row.id and is_deleted;

  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload)
  values(half_day_row.workspace,auth.uid(),'half_day',half_day_row.id::text,'restore',
         jsonb_build_object('source_type',half_day_row.source_type,
                            'source_generated_undertime_id',half_day_row.source_generated_undertime_id,
                            'work_date',half_day_row.work_date));
end;
$$;

-- Guard permanent deletion too, including the existing generic Recycle Bin RPC.
create or replace function public.guard_itc_generated_half_day_delete()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if old.workspace='APP' and old.source_type='system_generated'
     and (auth.uid() is null
       or public.attendance_role() is distinct from 'HR'
       or public.attendance_workspace() is distinct from 'APP'
       or public.attendance_hr_scope() is distinct from 'ITC') then
    raise exception 'Only APP ITC HR can permanently delete this generated Half-Day';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_guard_itc_generated_half_day_delete on public.half_day_records;
create trigger trg_guard_itc_generated_half_day_delete
before delete on public.half_day_records
for each row execute function public.guard_itc_generated_half_day_delete();

revoke all on function public.move_generated_undertime_to_half_day(bigint),public.delete_half_day(uuid),public.restore_half_day(uuid) from public,anon;
grant execute on function public.move_generated_undertime_to_half_day(bigint),public.delete_half_day(uuid),public.restore_half_day(uuid) to authenticated;

commit;
