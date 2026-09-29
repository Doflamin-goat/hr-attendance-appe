-- ITC leave reservation and generated-undertime metadata.
-- Forward-only proposal. Do not apply automatically. Requires migrations through 038.
begin;

alter table public.generated_undertimes
  add column if not exists reason text,
  add column if not exists informed_to text[] not null default '{}';

create or replace function public.submit_leave_request(
  p_employee_id uuid,p_leave_date date,p_start_time time,p_end_time time,
  p_duration_minutes integer,p_informed text[] default '{}',p_reason text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.employees%rowtype; new_id uuid; dow integer; shift_start time; shift_end time;
  chargeable integer; break_minutes integer; approved_minutes integer; pending_minutes integer; adjustment integer; available integer;
begin
  if auth.uid() is null or coalesce(public.attendance_role(),'') <> 'HR' then raise exception 'Only HR can submit leave requests'; end if;
  if p_end_time<=p_start_time or p_duration_minutes<=0 or nullif(btrim(p_reason),'') is null then raise exception 'Valid leave details required'; end if;
  if coalesce(array_length(p_informed,1),0)=0 then raise exception 'Informed person required'; end if;
  dow=extract(dow from p_leave_date); if dow=0 then raise exception 'Sunday has no configured work schedule'; end if;
  if dow=6 then shift_start='07:00'; shift_end='15:15'; else shift_start='08:00'; shift_end='17:00'; end if;
  chargeable=greatest(0,(extract(epoch from (least(p_end_time,shift_end)-greatest(p_start_time,shift_start)))/60)::integer);
  if dow between 1 and 5 then
    break_minutes=greatest(0,(extract(epoch from (least(p_end_time,time '13:00')-greatest(p_start_time,time '12:00')))/60)::integer);
    chargeable=chargeable-break_minutes;
  end if;
  if chargeable<=0 or p_duration_minutes<>chargeable then raise exception 'Leave duration does not match the configured work schedule'; end if;
  select * into e from public.assert_employee_in_hr_scope(p_employee_id);
  perform 1 from public.employees where id=e.id for update;
  select coalesce(sum(duration_minutes),0) into approved_minutes from public.leave_requests
    where employee_id=e.id and status='approved' and not is_deleted and extract(year from leave_date)=extract(year from p_leave_date);
  select coalesce(sum(duration_minutes),0) into pending_minutes from public.leave_requests
    where employee_id=e.id and status='pending' and not is_deleted and extract(year from leave_date)=extract(year from p_leave_date);
  select coalesce(adjustment_minutes,0) into adjustment from public.employee_leave_adjustments
    where employee_id=e.id and leave_year=extract(year from p_leave_date)::integer;
  available=2400+coalesce(adjustment,0)-approved_minutes-pending_minutes;
  if available<=0 then raise exception 'No leave balance remaining for this employee.'; end if;
  if p_duration_minutes>available then raise exception 'Requested leave exceeds the available balance of % minutes.',available; end if;
  if exists(select 1 from public.leave_requests where employee_id=e.id and leave_date=p_leave_date and not is_deleted and status in ('pending','approved')) then
    raise exception 'An active leave request already exists for this employee on this date.';
  end if;
  insert into public.leave_requests(workspace,employee_id,employee_name,leave_date,start_time,end_time,duration_minutes,informed_parties,reason,status,submitted_by)
  values(public.attendance_workspace(),e.id,e.full_name,p_leave_date,p_start_time,p_end_time,p_duration_minutes,coalesce(p_informed,'{}'),btrim(p_reason),'pending',auth.uid()) returning id into new_id;
  return new_id;
end $$;

create or replace function public.update_generated_undertime_details(p_id text,p_reason text,p_informed text[] default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare u public.generated_undertimes%rowtype;
begin
  if auth.uid() is null or coalesce(public.attendance_role(),'') <> 'HR' or public.attendance_hr_scope()<>'ITC' then raise exception 'ITC HR access required'; end if;
  select * into u from public.generated_undertimes where id::text=p_id and workspace=public.attendance_workspace() and not is_deleted for update;
  if u.id is null then raise exception 'Active generated undertime in your HR scope required'; end if;
  update public.generated_undertimes set reason=nullif(btrim(p_reason),''), informed_to=coalesce(p_informed,'{}') where id=u.id;
end $$;

revoke all on function public.submit_leave_request(uuid,date,time,time,integer,text[],text), public.update_generated_undertime_details(text,text,text[]) from public,anon;
grant execute on function public.submit_leave_request(uuid,date,time,time,integer,text[],text), public.update_generated_undertime_details(text,text,text[]) to authenticated;
commit;
