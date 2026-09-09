-- PRODUCTION PATCH — NOT APPLIED.
-- Allows either HR account to submit and either Admin account to review linked
-- exemptions across APP and WAIS. Exact employee/late matching remains enforced.
begin;

create or replace function public.submit_exemption(p_employee_id uuid,p_late_record_id bigint,p_reason text,p_reported_time time default null,p_informed text[] default '{}')
returns bigint language plpgsql security definer set search_path = '' as $$
declare e public.employees%rowtype; l public.late_records%rowtype; new_id bigint;
begin
 if auth.uid() is null or public.attendance_role() <> 'HR' then raise exception 'Only HR can submit exemptions'; end if;
 select * into e from public.employees where id=p_employee_id and not is_deleted and employment_status='active';
 select * into l from public.late_records where id=p_late_record_id and not is_deleted;
 if e.id is null or l.id is null or l.workspace <> e.workspace or l.work_date is null or l.employee_name <> e.full_name then raise exception 'Employee and late record must match exactly'; end if;
 insert into public.exemptions(workspace,employee_id,late_record_id,employee_name,work_date,reason,reported_time,informed_parties,approval_status,submitted_by)
 values(e.workspace,e.id,l.id,e.full_name,l.work_date,nullif(btrim(p_reason),''),p_reported_time,coalesce(p_informed,'{}'),'pending',auth.uid()) returning id into new_id;
 return new_id;
end $$;

create or replace function public.review_exemption(p_id bigint,p_status text,p_remarks text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare x public.exemptions%rowtype;
begin
 if auth.uid() is null or public.attendance_role() <> 'Admin' then raise exception 'Only Admin can review exemptions'; end if;
 if p_status not in ('approved','declined') then raise exception 'Invalid review status'; end if;
 select * into x from public.exemptions where id=p_id and not is_deleted for update;
 if x.id is null or x.approval_status <> 'pending' then raise exception 'Pending exemption required'; end if;
 if x.submitted_by=auth.uid() then raise exception 'Self-approval is not allowed'; end if;
 if x.late_record_id is null then raise exception 'Linked late record required'; end if;
 update public.exemptions set approval_status=p_status,reviewed_by=auth.uid(),reviewed_at=now(),review_remarks=nullif(btrim(p_remarks),'') where id=x.id;
end $$;

create or replace function public.create_half_day(p_employee_id uuid,p_date date,p_period text,p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.employees%rowtype; s time; f time; new_id uuid; dow int;
begin
 if auth.uid() is null or public.attendance_role() <> 'HR' then raise exception 'Only HR can create half-day records'; end if;
 select * into e from public.employees where id=p_employee_id and not is_deleted and employment_status='active';
 if e.id is null then raise exception 'Active employee required'; end if;
 dow=extract(dow from p_date); if dow=0 then raise exception 'Sunday has no half-day schedule'; end if;
 if dow=6 then if p_period='morning' then s='07:00';f='11:00'; elsif p_period='afternoon' then s='11:15';f='15:15'; else raise exception 'Invalid period'; end if;
 else if p_period='morning' then s='08:00';f='12:00'; elsif p_period='afternoon' then s='13:00';f='17:00'; else raise exception 'Invalid period'; end if; end if;
 insert into public.half_day_records(workspace,employee_id,work_date,absent_period,scheduled_start,scheduled_end,reason,created_by) values(e.workspace,e.id,p_date,p_period,s,f,nullif(btrim(p_reason),''),auth.uid()) returning id into new_id; return new_id;
end $$;

alter table public.employees enable row level security;
drop policy if exists "employees: workspace members can read" on public.employees;
drop policy if exists "employees: workspace members can write" on public.employees;
drop policy if exists "employees: authenticated can read" on public.employees;
drop policy if exists "employees: authenticated can write" on public.employees;
create policy "employees: HR and Admin can read" on public.employees for select to authenticated using(public.attendance_role() in ('Admin','HR'));
create policy "employees: HR can write" on public.employees for all to authenticated using(public.attendance_role() = 'HR') with check(public.attendance_role() = 'HR');

alter table public.late_records enable row level security;
alter table public.exemptions enable row level security;
create policy "workflow roles can read late records" on public.late_records for select to authenticated using(public.attendance_role() in ('Admin','HR'));
create policy "workflow roles can read exemptions" on public.exemptions for select to authenticated using(public.attendance_role() in ('Admin','HR'));

alter table public.half_day_records enable row level security;
drop policy if exists "half days workspace read" on public.half_day_records;
drop policy if exists "half days HR and Admin read" on public.half_day_records;
create policy "half days HR and Admin read" on public.half_day_records for select to authenticated using(public.attendance_role() in ('Admin','HR'));

commit;
