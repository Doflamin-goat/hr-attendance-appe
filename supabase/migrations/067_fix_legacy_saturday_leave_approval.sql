-- Canonical leave units for approval and reservation calculations.
-- Forward-only; do not apply automatically.
begin;

create or replace function public.leave_request_normalized_units(p_leave_date date, p_duration_minutes integer)
returns integer
language sql immutable
set search_path=''
as $$
  select greatest(0,
    case when extract(dow from p_leave_date)=6 and p_duration_minutes=495 then 450
         else coalesce(p_duration_minutes,0) end
  ) * case when extract(dow from p_leave_date)=6 then 16 else 15 end;
$$;

create or replace function public.leave_request_canonical_units(p_leave_date date, p_start_time time, p_end_time time)
returns integer language plpgsql immutable set search_path='' as $$
declare dow integer; s time; e time; chargeable integer; breaks integer := 0;
begin
  dow := extract(dow from p_leave_date);
  if dow=0 or p_start_time is null or p_end_time is null or p_end_time<=p_start_time then return 0; end if;
  if dow=6 then s:='07:00'; e:='15:15';
  else s:='08:00'; e:='17:00'; end if;
  chargeable := greatest(0,(extract(epoch from (least(p_end_time,e)-greatest(p_start_time,s)))/60)::integer);
  if dow between 1 and 5 then
    breaks := greatest(0,(extract(epoch from (least(p_end_time,time '13:00')-greatest(p_start_time,time '12:00')))/60)::integer);
  elsif dow=6 then
    breaks := greatest(0,(extract(epoch from (least(p_end_time,time '09:15')-greatest(p_start_time,time '09:00')))/60)::integer)
      + greatest(0,(extract(epoch from (least(p_end_time,time '12:30')-greatest(p_start_time,time '12:00')))/60)::integer);
  end if;
  chargeable := greatest(0,chargeable-breaks);
  return chargeable * case when dow=6 then 16 else 15 end;
end $$;

create or replace function public.leave_request_effective_units(p_leave_date date, p_start_time time, p_end_time time, p_duration_minutes integer, p_existing_units integer default null)
returns integer language sql immutable set search_path='' as $$
  select case when public.leave_request_canonical_units(p_leave_date,p_start_time,p_end_time) > 0
              then public.leave_request_canonical_units(p_leave_date,p_start_time,p_end_time)
              when p_existing_units is not null and p_existing_units > 0 then p_existing_units
              else public.leave_request_normalized_units(p_leave_date,p_duration_minutes) end;
$$;

create or replace function public.review_leave_request(p_id uuid,p_status text,p_remarks text default null)
returns void language plpgsql security definer set search_path='' as $$
declare x public.leave_requests%rowtype; used_units integer; balance_adjustment integer; request_units integer;
begin
 if auth.uid() is null or public.attendance_role() is distinct from 'Admin' then raise exception 'Only Admin can review leave requests'; end if;
 if p_status not in ('approved','rejected') then raise exception 'Invalid review status'; end if;
 select * into x from public.leave_requests where id=p_id and workspace=public.attendance_workspace() and not is_deleted for update;
 if x.id is null or x.status<>'pending' then raise exception 'Pending leave request in your HR scope required'; end if;
 if x.submitted_by=auth.uid() then raise exception 'Self-approval is not allowed'; end if;
 request_units := public.leave_request_effective_units(x.leave_date,x.start_time,x.end_time,x.duration_minutes,x.normalized_units);
 if p_status='approved' then
  select coalesce(sum(public.leave_request_effective_units(leave_date,start_time,end_time,duration_minutes,normalized_units)),0) into used_units from public.leave_requests where employee_id=x.employee_id and status='approved' and not is_deleted and extract(year from leave_date)=extract(year from x.leave_date);
  select coalesce(adjustment_minutes,0) into balance_adjustment from public.employee_leave_adjustments where employee_id=x.employee_id and leave_year=extract(year from x.leave_date)::integer for update;
  if used_units+request_units > 36000+coalesce(balance_adjustment,0)*15 then raise exception 'Insufficient annual leave balance'; end if;
 end if;
 update public.leave_requests set normalized_units=request_units,status=p_status,reviewed_by=auth.uid(),reviewed_at=now(),review_remarks=nullif(btrim(p_remarks),'') where id=x.id;
end $$;

create or replace function public.submit_leave_request(
  p_employee_id uuid,p_leave_date date,p_start_time time,p_end_time time,
  p_duration_minutes integer,p_informed text[] default '{}',p_reason text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.employees%rowtype; new_id uuid; dow integer; shift_start time; shift_end time; chargeable integer; breaks integer := 0; requested_units integer; approved_units integer; pending_units integer; adjustment integer;
begin
 if auth.uid() is null or public.attendance_role() is distinct from 'HR' then raise exception 'Only HR can submit leave requests'; end if;
 if p_end_time<=p_start_time or p_duration_minutes<=0 or nullif(btrim(p_reason),'') is null then raise exception 'Valid leave details required'; end if;
 if coalesce(array_length(p_informed,1),0)=0 then raise exception 'Informed person required'; end if;
 dow=extract(dow from p_leave_date); if dow=0 then raise exception 'Sunday has no configured work schedule'; end if;
 if dow=6 then shift_start='07:00'; shift_end='15:15'; else shift_start='08:00'; shift_end='17:00'; end if;
 chargeable=greatest(0,(extract(epoch from (least(p_end_time,shift_end)-greatest(p_start_time,shift_start)))/60)::integer);
 if dow between 1 and 5 then breaks=greatest(0,(extract(epoch from (least(p_end_time,time '13:00')-greatest(p_start_time,time '12:00')))/60)::integer);
 elsif dow=6 then breaks=greatest(0,(extract(epoch from (least(p_end_time,time '09:15')-greatest(p_start_time,time '09:00')))/60)::integer)+greatest(0,(extract(epoch from (least(p_end_time,time '12:30')-greatest(p_start_time,time '12:00')))/60)::integer); end if;
 chargeable=greatest(0,chargeable-breaks);
 if chargeable<=0 or p_duration_minutes<>chargeable then raise exception 'Leave duration does not match the configured work schedule'; end if;
 requested_units := public.leave_request_effective_units(p_leave_date,p_start_time,p_end_time,p_duration_minutes,null);
 select * into e from public.assert_employee_in_hr_scope(p_employee_id); perform 1 from public.employees where id=e.id for update;
 select coalesce(sum(public.leave_request_effective_units(leave_date,start_time,end_time,duration_minutes,normalized_units)),0) into approved_units from public.leave_requests where employee_id=e.id and status='approved' and not is_deleted and extract(year from leave_date)=extract(year from p_leave_date);
 select coalesce(sum(public.leave_request_effective_units(leave_date,start_time,end_time,duration_minutes,normalized_units)),0) into pending_units from public.leave_requests where employee_id=e.id and status='pending' and not is_deleted and extract(year from leave_date)=extract(year from p_leave_date);
 select coalesce(adjustment_minutes,0) into adjustment from public.employee_leave_adjustments where employee_id=e.id and leave_year=extract(year from p_leave_date)::integer;
 if requested_units > 36000 + coalesce(adjustment,0)*15 - approved_units - pending_units then raise exception 'Requested leave exceeds the available balance'; end if;
 if exists(select 1 from public.leave_requests where employee_id=e.id and leave_date=p_leave_date and not is_deleted and status in ('pending','approved')) then raise exception 'An active leave request already exists for this employee on this date.'; end if;
 insert into public.leave_requests(workspace,employee_id,employee_name,leave_date,start_time,end_time,duration_minutes,normalized_units,informed_parties,reason,status,submitted_by) values(public.attendance_workspace(),e.id,e.full_name,p_leave_date,p_start_time,p_end_time,p_duration_minutes,requested_units,coalesce(p_informed,'{}'),btrim(p_reason),'pending',auth.uid()) returning id into new_id;
 return new_id;
end $$;

create or replace function public.review_leave_request_main(p_id uuid,p_classification text,p_status text,p_remarks text default null)
returns void language plpgsql security definer set search_path='' as $$
declare x public.leave_requests%rowtype; used_units integer; balance_adjustment integer; request_units integer;
begin
 if auth.uid() is null or public.attendance_role() is distinct from 'Admin' then raise exception 'Only Admin can review leave requests'; end if;
 if public.attendance_hr_scope() is distinct from 'MAIN' or public.attendance_workspace() is distinct from 'WAIS' then raise exception 'MAIN Admin scope required'; end if;
 if p_classification not in ('excused','unexcused') then raise exception 'Attendance Classification is required'; end if;
 if p_status not in ('approved','rejected') then raise exception 'Invalid review status'; end if;
 select * into x from public.leave_requests where id=p_id and workspace='WAIS' and not is_deleted for update;
 if x.id is null or x.status<>'pending' then raise exception 'Pending leave request in your HR scope required'; end if;
 if x.submitted_by=auth.uid() then raise exception 'Self-approval is not allowed'; end if;
 request_units := public.leave_request_effective_units(x.leave_date,x.start_time,x.end_time,x.duration_minutes,x.normalized_units);
 if p_status='approved' then
  select coalesce(sum(public.leave_request_effective_units(leave_date,start_time,end_time,duration_minutes,normalized_units)),0) into used_units from public.leave_requests where employee_id=x.employee_id and status='approved' and not is_deleted and extract(year from leave_date)=extract(year from x.leave_date);
  select coalesce(adjustment_minutes,0) into balance_adjustment from public.employee_leave_adjustments where employee_id=x.employee_id and leave_year=extract(year from x.leave_date)::integer for update;
  if used_units+request_units > 36000+coalesce(balance_adjustment,0)*15 then raise exception 'Insufficient annual leave balance'; end if;
 end if;
 update public.leave_requests set normalized_units=request_units,attendance_classification=p_classification,status=p_status,reviewed_by=auth.uid(),reviewed_at=now(),review_remarks=nullif(btrim(p_remarks),'') where id=x.id;
end $$;

create or replace function public.set_employee_remaining_leave(
  p_employee_id uuid,p_leave_year integer,p_remaining_minutes integer,p_remarks text default null
) returns void language plpgsql security definer set search_path='' as $$
declare e public.employees%rowtype; approved_units integer; old_adjustment integer; previous_remaining integer; new_adjustment integer;
begin
 if auth.uid() is null or public.attendance_role() is distinct from 'HR' then raise exception 'Only HR can edit remaining leave'; end if;
 if p_leave_year not between 2000 and 2100 or p_remaining_minutes<0 or p_remaining_minutes>2400 then raise exception 'Valid leave year and remaining balance required'; end if;
 select * into e from public.assert_employee_in_hr_scope(p_employee_id);
 select coalesce(sum(public.leave_request_effective_units(leave_date,start_time,end_time,duration_minutes,normalized_units)),0) into approved_units from public.leave_requests where employee_id=e.id and status='approved' and not is_deleted and extract(year from leave_date)=p_leave_year;
 select coalesce(adjustment_minutes,0) into old_adjustment from public.employee_leave_adjustments where employee_id=e.id and leave_year=p_leave_year for update;
 previous_remaining := greatest(0, round((36000 + coalesce(old_adjustment,0)*15 - approved_units)::numeric / 15));
 new_adjustment := p_remaining_minutes + round(approved_units::numeric / 15) - 2400;
 insert into public.employee_leave_adjustments(employee_id,workspace,leave_year,adjustment_minutes,remarks,created_by) values(e.id,e.workspace,p_leave_year,new_adjustment,nullif(btrim(p_remarks),''),auth.uid()) on conflict(employee_id,leave_year) do update set workspace=excluded.workspace,adjustment_minutes=excluded.adjustment_minutes,remarks=excluded.remarks;
 insert into public.audit_logs(workspace,actor_id,actor_email,entity,entity_id,action,payload) values(e.workspace,auth.uid(),auth.jwt()->>'email','employee_leave_adjustment',e.id::text,'set_remaining_leave',jsonb_build_object('leave_year',p_leave_year,'previous_remaining_minutes',previous_remaining,'new_remaining_minutes',p_remaining_minutes,'adjustment_minutes',new_adjustment));
end $$;

revoke all on function public.leave_request_canonical_units(date,time,time) from public,anon;
grant execute on function public.leave_request_canonical_units(date,time,time) to authenticated;
revoke all on function public.leave_request_effective_units(date,time,time,integer,integer) from public,anon;
grant execute on function public.leave_request_effective_units(date,time,time,integer,integer) to authenticated;
commit;
