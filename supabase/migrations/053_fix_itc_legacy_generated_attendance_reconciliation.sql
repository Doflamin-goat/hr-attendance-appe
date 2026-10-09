-- APP/ITC-only repair for legacy generated Undertime rows without canonical employee IDs.
-- Resolution is exact through employee_name_key and requires one active APP employee.
begin;

-- Backfill only uniquely resolved active ITC rows. Existing identities are never overwritten.
with resolved as (
  select u.id, array_agg(e.id order by e.id) as employee_ids
    from public.generated_undertimes u
    join public.employees e
      on e.workspace='APP'
     and e.hr_scope='ITC'
     and not e.is_deleted
     and e.employment_status='active'
     and (public.employee_name_key(e.full_name)=public.employee_name_key(u.employee_name)
       or public.employee_name_key(e.attendance_name)=public.employee_name_key(u.employee_name))
   where u.workspace='APP' and u.employee_id is null and not u.is_deleted
   group by u.id
  having count(distinct e.id)=1
)
update public.generated_undertimes u
   set employee_id=r.employee_ids[1]
  from resolved r
 where u.id=r.id and u.workspace='APP' and u.employee_id is null and not u.is_deleted;

-- Replace only the ITC Move RPC. Null legacy identities use the same exact,
-- uniquely-resolved employee_name_key contract as migration 037.
create or replace function public.move_itc_generated_attendance_to_service(
  p_record_type text,
  p_record_id text,
  p_service_id uuid
)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  event_row public.service_events%rowtype;
  employee_row public.employees%rowtype;
  record_employee_id uuid;
  record_employee_name text;
  record_date date;
  resolved_ids uuid[];
  reconciled_count integer;
  changed integer;
begin
  if auth.uid() is null
     or public.attendance_role() is distinct from 'HR'
     or public.attendance_workspace() is distinct from 'APP'
     or public.attendance_hr_scope() is distinct from 'ITC' then
    raise exception 'Only APP ITC HR can move generated attendance to Service';
  end if;

  select * into event_row
    from public.service_events
   where id=p_service_id
     and workspace='APP'
     and status in ('in_service','completed')
     and not is_deleted
   for update;
  if event_row.id is null then raise exception 'Eligible APP Service record not found'; end if;

  if p_record_type='undertime' then
    begin
      select u.employee_id,u.employee_name,u.work_date
        into record_employee_id,record_employee_name,record_date
        from public.generated_undertimes u
       where u.id=p_record_id::bigint and u.workspace='APP' and not u.is_deleted
       for update;
    exception when invalid_text_representation then
      raise exception 'Invalid generated Undertime record identifier';
    end;
    if record_date is null then raise exception 'Active system-generated Undertime record not found'; end if;
    if record_employee_id is null then
      select array_agg(e.id order by e.id)
        into resolved_ids
        from public.employees e
       where e.workspace='APP' and e.hr_scope='ITC'
         and not e.is_deleted and e.employment_status='active'
         and (public.employee_name_key(e.full_name)=public.employee_name_key(record_employee_name)
           or public.employee_name_key(e.attendance_name)=public.employee_name_key(record_employee_name));
      if coalesce(cardinality(resolved_ids),0)=0 then
        raise exception 'No matching employee could be resolved for this generated Undertime';
      elsif cardinality(resolved_ids)<>1 then
        raise exception 'Generated Undertime employee identity is ambiguous';
      end if;
      record_employee_id:=resolved_ids[1];
      update public.generated_undertimes
         set employee_id=record_employee_id
       where id=p_record_id::bigint and workspace='APP' and employee_id is null and not is_deleted;
    end if;
    select * into employee_row from public.employees e
     where e.id=record_employee_id and e.workspace='APP' and e.hr_scope='ITC'
       and not e.is_deleted and e.employment_status='active';
    if employee_row.id is null then raise exception 'Generated Undertime employee is outside APP ITC scope'; end if;

  elsif p_record_type='half_day' then
    begin
      select h.employee_id,h.work_date
        into record_employee_id,record_date
        from public.half_day_records h
        join public.employees e on e.id=h.employee_id
       where h.id=p_record_id::uuid and h.workspace='APP'
         and h.source_type='attendance_upload' and h.absent_period='morning' and not h.is_deleted
         and e.workspace='APP' and e.hr_scope='ITC' and not e.is_deleted and e.employment_status='active'
       for update of h;
    exception when invalid_text_representation then
      raise exception 'Invalid generated Half-Day record identifier';
    end;
    if record_employee_id is null then raise exception 'Active system-generated Half-Day record not found'; end if;
    select * into employee_row from public.employees e
     where e.id=record_employee_id and e.workspace='APP' and e.hr_scope='ITC'
       and not e.is_deleted and e.employment_status='active';
    if employee_row.id is null then raise exception 'Generated Half-Day employee is outside APP ITC scope'; end if;
  else
    raise exception 'Unsupported generated attendance type';
  end if;

  if record_date < (event_row.service_start at time zone 'Asia/Manila')::date
     or record_date > coalesce((event_row.service_end at time zone 'Asia/Manila')::date,
                               (event_row.service_start at time zone 'Asia/Manila')::date) then
    raise exception 'Selected Service does not cover this attendance record';
  end if;

  insert into public.service_event_employees(service_event_id,employee_id,workspace)
  values(event_row.id,record_employee_id,'APP')
  on conflict(service_event_id,employee_id) do nothing;
  get diagnostics changed = row_count;
  if changed=1 then
    insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload)
    values('APP',auth.uid(),'service_event',event_row.id::text,'add_employee_for_generated_attendance',
      jsonb_build_object('employee_id',record_employee_id,'record_type',p_record_type,'record_id',p_record_id));
  end if;

  reconciled_count:=public.reconcile_itc_service_attendance(event_row.id);
  if p_record_type='undertime' and exists(
    select 1 from public.generated_undertimes where id=p_record_id::bigint and not is_deleted
  ) then raise exception 'Selected Service does not cover this attendance record'; end if;
  if p_record_type='half_day' and exists(
    select 1 from public.half_day_records where id=p_record_id::uuid and not is_deleted
  ) then raise exception 'Selected Service does not cover this attendance record'; end if;
  return reconciled_count;
end;
$$;

revoke all on function public.move_itc_generated_attendance_to_service(text,text,uuid) from public,anon;
grant execute on function public.move_itc_generated_attendance_to_service(text,text,uuid) to authenticated;

commit;
