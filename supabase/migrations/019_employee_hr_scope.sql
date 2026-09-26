-- Employee employer / HR ownership separation. FORWARD-ONLY; DO NOT APPLY AUTOMATICALLY.
-- Existing employee and attendance rows remain intact. Existing employees are ITC-owned.
begin;

alter table public.employees add column if not exists employer text;
alter table public.employees add column if not exists hr_scope text;
alter table public.employees add column if not exists start_date date;
alter table public.employees add column if not exists regular_date date;
alter table public.employees add column if not exists source_regular_year integer;

update public.employees
set employer=coalesce(employer,workspace), hr_scope=coalesce(hr_scope,'ITC'), workspace='APP'
where employer is null or hr_scope is null;

alter table public.employees alter column employer set not null;
alter table public.employees alter column hr_scope set not null;
alter table public.employees drop constraint if exists employees_hr_scope_check;
alter table public.employees add constraint employees_hr_scope_check check(hr_scope in ('ITC','MAIN'));
alter table public.employees drop constraint if exists employees_employer_check;
alter table public.employees add constraint employees_employer_check check(employer in ('APP','WAIS','WATTS APP','M2B'));

drop index if exists public.employees_unique_active_name;
create unique index if not exists employees_unique_active_scope_name
  on public.employees(hr_scope,public.employee_name_key(full_name)) where not is_deleted;
create unique index if not exists employees_unique_employee_number
  on public.employees(employee_number) where employee_number is not null;
create index if not exists employees_hr_scope_idx on public.employees(hr_scope,employment_status,is_deleted);

-- MAIN seed matches only stable employee numbers. A similar name in ITC is a distinct person.
do $$
declare conflicts text;
begin
 select string_agg(employee_number||' ('||full_name||')',', ' order by employee_number) into conflicts
 from public.employees
 where hr_scope='ITC' and employee_number=any(array['W-3002011','W-3002423','W-2001803','W-2001802','W-6002627','W-2002508','W-8001910','W-3002637','W-3001704','W-3002636','M-2009501','M-5009402','M-3002318']);
 if conflicts is not null then raise exception 'MAIN employee-number conflict with existing ITC records: %. Resolve identity before applying.',conflicts; end if;
end $$;

with main_seed(employee_number,full_name,employer,start_date,regular_date,source_regular_year,position) as (values
 ('W-3002011','Abellera, Criselda Gajol','WATTS APP',date '2020-01-27',date '2020-09-04',null::integer,'ACCOUNTS PAYABLE ASST'),
 ('W-3002423','Bael, Lea Tinibroso','WATTS APP',date '2024-10-03',date '2025-03-03',null::integer,'ACCOUNTING ASSISTANT'),
 ('W-2001803','Bernal, Ralvic Gamay','WATTS APP',date '2018-09-03',date '2020-01-05',null::integer,'DRIVER'),
 ('W-2001802','Collera, Rogel','WATTS APP',date '2018-04-16',date '2019-08-19',null::integer,'MESSENGER'),
 ('W-6002627','Corona Jr., Eduard Espelimbergo','WATTS APP',date '2026-06-18',null::date,null::integer,'SALES'),
 ('W-2002508','Huerto, Joben Luciano','WATTS APP',date '2025-06-17',date '2025-11-17',null::integer,'RIDER/DELIVERY HELPER'),
 ('W-8001910','Ong, Reina Lynn Yu','WATTS APP',date '2019-05-20',date '2019-05-20',null::integer,'ACCOUNTING SUPERVISOR'),
 ('W-3002637','Reyes, Kimberly Mae Dela Cruz','WATTS APP',date '2026-04-13',null::date,null::integer,'ACCOUNTS PAYABLE ASST'),
 ('W-3001704','Reyes, Marjorie Justiniano','WATTS APP',date '2017-01-05',date '2017-10-05',null::integer,'HR ASSISTANT'),
 ('W-3002636','Santos, Catherine Labaro','WATTS APP',date '2026-03-17',null::date,null::integer,'ACCOUNTING ASSISTANT'),
 ('M-2009501','Codilan, Uldarico Abletes','M2B',null::date,null::date,1995,'SALES COORDINATOR/DELIVERY DRIVER'),
 ('M-5009402','Aquino, Armando Lantay','M2B',null::date,null::date,1994,'SALES COORDINATOR'),
 ('M-3002318','Lasam, Christine Joy Yap','M2B',date '2023-09-18',date '2024-02-18',null::integer,'PURCHASING ASSISTANT')
)
insert into public.employees(workspace,employer,hr_scope,employee_number,full_name,position,start_date,regular_date,source_regular_year)
select 'WAIS',employer,'MAIN',employee_number,full_name,position,start_date,regular_date,source_regular_year
from main_seed s
on conflict(employee_number) where employee_number is not null do update set
 workspace='WAIS',employer=excluded.employer,hr_scope='MAIN',full_name=excluded.full_name,
 position=excluded.position,start_date=excluded.start_date,regular_date=excluded.regular_date,
 source_regular_year=excluded.source_regular_year,updated_at=now();

create or replace function public.attendance_hr_scope() returns text language sql stable security definer set search_path='' as $$
 select case when workspace='WAIS' then 'MAIN' else 'ITC' end from public.profiles where id=auth.uid()
$$;

drop policy if exists "employees: authenticated can read" on public.employees;
drop policy if exists "employees: authenticated can write" on public.employees;
drop policy if exists "employees: workspace members can read" on public.employees;
drop policy if exists "employees: workspace members can write" on public.employees;
drop policy if exists "employees: HR and Admin can read" on public.employees;
drop policy if exists "employees: HR can write" on public.employees;
drop policy if exists "employees: scoped HR and Admin read" on public.employees;
drop policy if exists "employees: scoped HR write" on public.employees;
create policy "employees: scoped HR and Admin read" on public.employees for select to authenticated
 using(public.attendance_role() in ('HR','Admin') and hr_scope=public.attendance_hr_scope());
create policy "employees: scoped HR write" on public.employees for all to authenticated
 using(public.attendance_role()='HR' and hr_scope=public.attendance_hr_scope())
 with check(public.attendance_role()='HR' and hr_scope=public.attendance_hr_scope()
   and workspace=case when hr_scope='MAIN' then 'WAIS' else 'APP' end);

drop policy if exists "workflow roles can read late records" on public.late_records;
drop policy if exists "workflow roles can read exemptions" on public.exemptions;
drop policy if exists "scoped roles read late records" on public.late_records;
drop policy if exists "scoped roles read exemptions" on public.exemptions;
create policy "scoped roles read late records" on public.late_records for select to authenticated
 using(public.attendance_role() in ('HR','Admin') and workspace=public.attendance_workspace());
create policy "scoped roles read exemptions" on public.exemptions for select to authenticated
 using(public.attendance_role() in ('HR','Admin') and workspace=public.attendance_workspace());

drop policy if exists "half days HR and Admin read" on public.half_day_records;
drop policy if exists "scoped roles read half days" on public.half_day_records;
create policy "scoped roles read half days" on public.half_day_records for select to authenticated
 using(public.attendance_role() in ('HR','Admin') and workspace=public.attendance_workspace());

drop policy if exists "leave requests HR and Admin read" on public.leave_requests;
drop policy if exists "scoped roles read leave requests" on public.leave_requests;
create policy "scoped roles read leave requests" on public.leave_requests for select to authenticated
 using(public.attendance_role() in ('HR','Admin') and workspace=public.attendance_workspace());
drop policy if exists "leave adjustments HR and Admin read" on public.employee_leave_adjustments;
drop policy if exists "scoped roles read leave adjustments" on public.employee_leave_adjustments;
create policy "scoped roles read leave adjustments" on public.employee_leave_adjustments for select to authenticated
 using(public.attendance_role() in ('HR','Admin') and workspace=public.attendance_workspace());
drop policy if exists "absences Admin can read all" on public.absences;
drop policy if exists "absences Admin reads own scope" on public.absences;
create policy "absences Admin reads own scope" on public.absences for select to authenticated
 using(public.attendance_role()='Admin' and workspace=public.attendance_workspace());

-- Scope guards used by security-definer workflow functions below.
create or replace function public.assert_employee_in_hr_scope(p_employee_id uuid) returns public.employees
language plpgsql stable security definer set search_path='' as $$
declare e public.employees%rowtype;
begin
 select * into e from public.employees where id=p_employee_id and not is_deleted and employment_status='active';
 if e.id is null or e.hr_scope<>public.attendance_hr_scope() then raise exception 'Employee is outside your HR scope'; end if;
 return e;
end $$;

create or replace function public.submit_exemption(p_employee_id uuid,p_late_record_id bigint,p_reason text,p_reported_time time default null,p_informed text[] default '{}')
returns bigint language plpgsql security definer set search_path='' as $$
declare e public.employees%rowtype; l public.late_records%rowtype; new_id bigint;
begin
 if auth.uid() is null or public.attendance_role()<>'HR' then raise exception 'Only HR can submit exemptions'; end if;
 select * into e from public.assert_employee_in_hr_scope(p_employee_id);
 select * into l from public.late_records where id=p_late_record_id and not is_deleted;
 if l.id is null or l.workspace<>public.attendance_workspace() or l.work_date is null or public.employee_name_key(l.employee_name)<>public.employee_name_key(e.full_name) then raise exception 'Employee and late record must match the current HR scope'; end if;
 insert into public.exemptions(workspace,employee_id,late_record_id,employee_name,work_date,reason,reported_time,informed_parties,approval_status,submitted_by)
 values(l.workspace,e.id,l.id,e.full_name,l.work_date,nullif(btrim(p_reason),''),p_reported_time,coalesce(p_informed,'{}'),'pending',auth.uid()) returning id into new_id;
 return new_id;
end $$;

create or replace function public.review_exemption(p_id bigint,p_status text,p_remarks text default null)
returns void language plpgsql security definer set search_path='' as $$
declare x public.exemptions%rowtype;
begin
 if auth.uid() is null or public.attendance_role()<>'Admin' then raise exception 'Only Admin can review exemptions'; end if;
 if p_status not in ('approved','declined') then raise exception 'Invalid review status'; end if;
 select * into x from public.exemptions where id=p_id and not is_deleted for update;
 if x.id is null or x.workspace<>public.attendance_workspace() or x.approval_status<>'pending' then raise exception 'Pending exemption in your HR scope required'; end if;
 if x.submitted_by=auth.uid() then raise exception 'Self-approval is not allowed'; end if;
 if x.late_record_id is null then raise exception 'Linked late record required'; end if;
 update public.exemptions set approval_status=p_status,reviewed_by=auth.uid(),reviewed_at=now(),review_remarks=nullif(btrim(p_remarks),'') where id=x.id;
end $$;

create or replace function public.create_half_day(p_employee_id uuid,p_date date,p_period text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.employees%rowtype; s time; f time; new_id uuid; dow int;
begin
 if auth.uid() is null or public.attendance_role()<>'HR' then raise exception 'Only HR can create half-day records'; end if;
 select * into e from public.assert_employee_in_hr_scope(p_employee_id);
 dow=extract(dow from p_date); if dow=0 then raise exception 'Sunday has no half-day schedule'; end if;
 if dow=6 then if p_period='morning' then s='07:00';f='11:00'; elsif p_period='afternoon' then s='11:00';f='15:15'; else raise exception 'Invalid period'; end if;
 else if p_period='morning' then s='08:00';f='12:00'; elsif p_period='afternoon' then s='13:00';f='17:00'; else raise exception 'Invalid period'; end if; end if;
 insert into public.half_day_records(workspace,employee_id,employee_name,work_date,absent_period,scheduled_start,scheduled_end,reason,created_by)
 values(public.attendance_workspace(),e.id,e.full_name,p_date,p_period,s,f,nullif(btrim(p_reason),''),auth.uid()) returning id into new_id; return new_id;
end $$;

create or replace function public.create_generated_half_day(p_workspace text,p_employee_name text,p_date date,p_period text,p_reason text,p_source_file_name text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.employees%rowtype; s time; f time; new_id uuid; dow int;
begin
 if auth.uid() is null or public.attendance_role()<>'HR' or p_workspace<>public.attendance_workspace() then raise exception 'Only HR can generate half-days in its own scope'; end if;
 if p_period<>'morning' then raise exception 'Uploaded attendance supports morning-absent half-day only'; end if;
 select * into e from public.employees where hr_scope=public.attendance_hr_scope() and not is_deleted and employment_status='active' and public.employee_name_key(full_name)=public.employee_name_key(p_employee_name);
 if e.id is null then raise exception 'Active employee in your HR scope required'; end if;
 dow=extract(dow from p_date); if dow=0 then raise exception 'Sunday has no generated half-day schedule'; end if;
 if dow=6 then s='07:00';f='11:00'; else s='08:00';f='12:00'; end if;
 update public.generated_undertimes set is_deleted=true,deleted_at=now(),deleted_reason='reclassified_as_half_day' where workspace=p_workspace and work_date=p_date and not is_deleted and public.employee_name_key(employee_name)=public.employee_name_key(e.full_name);
 update public.late_records set is_deleted=true,deleted_at=now(),deleted_reason='reclassified_as_half_day' where workspace=p_workspace and work_date=p_date and not is_deleted and public.employee_name_key(employee_name)=public.employee_name_key(e.full_name);
 insert into public.half_day_records(workspace,employee_id,employee_name,work_date,absent_period,scheduled_start,scheduled_end,reason,created_by,source_type,source_file_name)
 values(p_workspace,e.id,e.full_name,p_date,'morning',s,f,nullif(btrim(p_reason),''),auth.uid(),'attendance_upload',nullif(btrim(p_source_file_name),''))
 on conflict(employee_id,work_date,absent_period) do update set workspace=excluded.workspace,scheduled_start=excluded.scheduled_start,scheduled_end=excluded.scheduled_end,reason=excluded.reason,source_type='attendance_upload',source_file_name=excluded.source_file_name,is_deleted=false,restored_at=now(),restored_by=auth.uid(),removed_from_recycle_bin=false returning id into new_id;
 return new_id;
end $$;

create or replace function public.delete_half_day(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.attendance_role()<>'HR' then raise exception 'Only HR can delete half-day records'; end if;
 update public.half_day_records set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='half_day_deleted',deleted_batch_id=gen_random_uuid(),restored_at=null,restored_by=null,removed_from_recycle_bin=false,removed_from_recycle_bin_at=null,removed_from_recycle_bin_by=null
 where id=p_id and workspace=public.attendance_workspace() and not is_deleted;
 if not found then raise exception 'Active half-day record in your HR scope not found'; end if;
end $$;

create or replace function public.restore_half_day(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.attendance_role()<>'HR' then raise exception 'Only HR can restore half-day records'; end if;
 update public.half_day_records set is_deleted=false,restored_at=now(),restored_by=auth.uid(),removed_from_recycle_bin=false,removed_from_recycle_bin_at=null,removed_from_recycle_bin_by=null
 where id=p_id and workspace=public.attendance_workspace() and is_deleted;
 if not found then raise exception 'Deleted half-day record in your HR scope not found'; end if;
end $$;

create or replace function public.hide_half_day_from_recycle_bin(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.attendance_role()<>'HR' then raise exception 'Only HR can manage half-day records'; end if;
 update public.half_day_records set removed_from_recycle_bin=true,removed_from_recycle_bin_at=now(),removed_from_recycle_bin_by=auth.uid()
 where id=p_id and workspace=public.attendance_workspace() and is_deleted and not removed_from_recycle_bin;
 if not found then raise exception 'Deleted half-day record in your HR scope not found'; end if;
end $$;

create or replace function public.review_leave_request(p_id uuid,p_status text,p_remarks text default null)
returns void language plpgsql security definer set search_path='' as $$
declare x public.leave_requests%rowtype; used_minutes integer; balance_adjustment integer;
begin
 if auth.uid() is null or public.attendance_role()<>'Admin' then raise exception 'Only Admin can review leave requests'; end if;
 if p_status not in ('approved','rejected') then raise exception 'Invalid review status'; end if;
 select * into x from public.leave_requests where id=p_id and workspace=public.attendance_workspace() and not is_deleted for update;
 if x.id is null or x.status<>'pending' then raise exception 'Pending leave request in your HR scope required'; end if;
 if x.submitted_by=auth.uid() then raise exception 'Self-approval is not allowed'; end if;
 if p_status='approved' then
  select coalesce(sum(duration_minutes),0) into used_minutes from public.leave_requests where employee_id=x.employee_id and status='approved' and not is_deleted and extract(year from leave_date)=extract(year from x.leave_date);
  select coalesce(adjustment_minutes,0) into balance_adjustment from public.employee_leave_adjustments where employee_id=x.employee_id and leave_year=extract(year from x.leave_date)::integer for update;
  if used_minutes+x.duration_minutes>2400+coalesce(balance_adjustment,0) then raise exception 'Insufficient annual leave balance'; end if;
 end if;
 update public.leave_requests set status=p_status,reviewed_by=auth.uid(),reviewed_at=now(),review_remarks=nullif(btrim(p_remarks),'') where id=x.id;
end $$;

create or replace function public.submit_leave_request(p_employee_id uuid,p_leave_date date,p_start_time time,p_end_time time,p_duration_minutes integer,p_informed text[] default '{}',p_reason text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.employees%rowtype; new_id uuid; dow integer; shift_start time; shift_end time; chargeable integer; break_minutes integer;
begin
 if auth.uid() is null or public.attendance_role()<>'HR' then raise exception 'Only HR can submit leave requests'; end if;
 if p_end_time<=p_start_time or p_duration_minutes<=0 or nullif(btrim(p_reason),'') is null then raise exception 'Valid leave details required'; end if;
 if coalesce(array_length(p_informed,1),0)=0 then raise exception 'Informed person required'; end if;
 dow=extract(dow from p_leave_date); if dow=0 then raise exception 'Sunday has no configured work schedule'; end if;
 if dow=6 then shift_start='07:00';shift_end='15:15'; else shift_start='08:00';shift_end='17:00'; end if;
 chargeable=greatest(0,(extract(epoch from (least(p_end_time,shift_end)-greatest(p_start_time,shift_start)))/60)::integer);
 if dow between 1 and 5 then break_minutes=greatest(0,(extract(epoch from (least(p_end_time,time '13:00')-greatest(p_start_time,time '12:00')))/60)::integer); chargeable=chargeable-break_minutes; end if;
 if chargeable<=0 or p_duration_minutes<>chargeable then raise exception 'Leave duration does not match the configured work schedule'; end if;
 select * into e from public.assert_employee_in_hr_scope(p_employee_id);
 if exists(select 1 from public.leave_requests where employee_id=e.id and leave_date=p_leave_date and not is_deleted and status in ('pending','approved')) then raise exception 'An active leave request already exists for this employee on this date.'; end if;
 insert into public.leave_requests(workspace,employee_id,employee_name,leave_date,start_time,end_time,duration_minutes,informed_parties,reason,status,submitted_by)
 values(public.attendance_workspace(),e.id,e.full_name,p_leave_date,p_start_time,p_end_time,p_duration_minutes,coalesce(p_informed,'{}'),btrim(p_reason),'pending',auth.uid()) returning id into new_id; return new_id;
end $$;

create or replace function public.set_employee_remaining_leave(p_employee_id uuid,p_leave_year integer,p_remaining_minutes integer,p_remarks text default null)
returns void language plpgsql security definer set search_path='' as $$
declare e public.employees%rowtype; approved_minutes integer; old_adjustment integer; previous_remaining integer; new_adjustment integer;
begin
 if auth.uid() is null or public.attendance_role()<>'HR' then raise exception 'Only HR can edit remaining leave'; end if;
 if p_leave_year not between 2000 and 2100 or p_remaining_minutes<0 or p_remaining_minutes>2400 then raise exception 'Valid leave year and remaining balance required'; end if;
 select * into e from public.assert_employee_in_hr_scope(p_employee_id);
 select coalesce(sum(duration_minutes),0) into approved_minutes from public.leave_requests where employee_id=e.id and status='approved' and not is_deleted and extract(year from leave_date)=p_leave_year;
 select coalesce(adjustment_minutes,0) into old_adjustment from public.employee_leave_adjustments where employee_id=e.id and leave_year=p_leave_year for update;
 previous_remaining=2400+coalesce(old_adjustment,0)-approved_minutes; new_adjustment=p_remaining_minutes+approved_minutes-2400;
 insert into public.employee_leave_adjustments(employee_id,workspace,leave_year,adjustment_minutes,remarks,created_by)
 values(e.id,public.attendance_workspace(),p_leave_year,new_adjustment,nullif(btrim(p_remarks),''),auth.uid())
 on conflict(employee_id,leave_year) do update set adjustment_minutes=excluded.adjustment_minutes,remarks=excluded.remarks;
 insert into public.audit_logs(workspace,actor_id,actor_email,entity,entity_id,action,payload)
 values(public.attendance_workspace(),auth.uid(),auth.jwt()->>'email','employee_leave_adjustment',e.id::text,'set_remaining_leave',jsonb_build_object('leave_year',p_leave_year,'previous_remaining_minutes',previous_remaining,'new_remaining_minutes',p_remaining_minutes));
end $$;

create or replace function public.cancel_pending_leave_request(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare x public.leave_requests%rowtype;
begin
 if auth.uid() is null or public.attendance_role()<>'HR' then raise exception 'Only HR can cancel leave requests'; end if;
 select * into x from public.leave_requests where id=p_id and workspace=public.attendance_workspace() and not is_deleted for update;
 if x.id is null or x.status<>'pending' then raise exception 'Active pending leave request in your HR scope required'; end if;
 if x.submitted_by<>auth.uid() then raise exception 'HR can cancel only its own pending leave request'; end if;
 update public.leave_requests set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='leave_request_cancelled',deleted_batch_id=gen_random_uuid() where id=x.id;
end $$;

create or replace function public.remove_leave_request(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare x public.leave_requests%rowtype;
begin
 if auth.uid() is null or public.attendance_role()<>'HR' then raise exception 'Only HR can remove leave records'; end if;
 if nullif(btrim(p_reason),'') is null then raise exception 'Removal reason required'; end if;
 select * into x from public.leave_requests where id=p_id and workspace=public.attendance_workspace() and not is_deleted for update;
 if x.id is null or x.status not in ('approved','rejected') then raise exception 'Active approved or rejected leave request in your HR scope required'; end if;
 update public.leave_requests set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason=x.status||'_leave_removed: '||btrim(p_reason),deleted_batch_id=gen_random_uuid() where id=x.id;
end $$;

revoke all on function public.attendance_hr_scope(),public.assert_employee_in_hr_scope(uuid) from public,anon;
grant execute on function public.attendance_hr_scope(),public.assert_employee_in_hr_scope(uuid) to authenticated;

commit;
