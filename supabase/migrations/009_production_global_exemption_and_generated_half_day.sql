-- PRODUCTION PATCH — NOT APPLIED.
-- Global HR/Admin exemption workflow plus generated attendance Half-Day records.
begin;

create or replace function public.submit_exemption(p_employee_id uuid,p_late_record_id bigint,p_reason text,p_reported_time time default null,p_informed text[] default '{}')
returns bigint language plpgsql security definer set search_path = '' as $$
declare e public.employees%rowtype; l public.late_records%rowtype; new_id bigint;
begin
 if auth.uid() is null or public.attendance_role() <> 'HR' then raise exception 'Only HR can submit exemptions'; end if;
 if nullif(btrim(p_reason),'') is null then raise exception 'Reason required'; end if;
 select * into e from public.employees where id=p_employee_id and not is_deleted and employment_status='active';
 select * into l from public.late_records where id=p_late_record_id and not is_deleted;
 if e.id is null or l.id is null or l.work_date is null or public.employee_name_key(l.employee_name) <> public.employee_name_key(e.full_name) then raise exception 'Employee and late record names must match'; end if;
 insert into public.exemptions(workspace,employee_id,late_record_id,employee_name,work_date,reason,reported_time,informed_parties,approval_status,submitted_by)
 values(l.workspace,e.id,l.id,e.full_name,l.work_date,nullif(btrim(p_reason),''),p_reported_time,coalesce(p_informed,'{}'),'pending',auth.uid()) returning id into new_id;
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

alter table public.half_day_records
  add column if not exists source_type text,
  add column if not exists source_file_name text;

create or replace function public.create_generated_half_day(p_workspace text,p_employee_name text,p_date date,p_period text,p_reason text,p_source_file_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.employees%rowtype; s time; f time; new_id uuid;
begin
 if auth.uid() is null or public.attendance_role() <> 'HR' then raise exception 'Only HR can generate half-day records'; end if;
 if p_period <> 'afternoon' then raise exception 'Generated attendance supports afternoon half-day only'; end if;
 select * into e from public.employees where workspace=p_workspace and not is_deleted and employment_status='active' and public.employee_name_key(full_name)=public.employee_name_key(p_employee_name);
 if e.id is null then raise exception 'Active employee required'; end if;
 if extract(dow from p_date)=6 then s='11:15'; f='15:15';
 elsif extract(dow from p_date) between 1 and 5 then s='13:00'; f='17:00';
 else raise exception 'Sunday has no half-day schedule'; end if;
 update public.generated_undertimes set is_deleted=true,deleted_at=now(),deleted_reason='reclassified_as_half_day' where workspace=p_workspace and work_date=p_date and not is_deleted and public.employee_name_key(employee_name)=public.employee_name_key(e.full_name);
 insert into public.half_day_records(workspace,employee_id,work_date,absent_period,scheduled_start,scheduled_end,reason,created_by,source_type,source_file_name)
 values(e.workspace,e.id,p_date,'afternoon',s,f,nullif(btrim(p_reason),''),auth.uid(),'attendance_upload',nullif(btrim(p_source_file_name),''))
 on conflict (employee_id,work_date,absent_period) do update set reason=excluded.reason,source_type=excluded.source_type,source_file_name=excluded.source_file_name
 returning id into new_id;
 return new_id;
end $$;

revoke all on function public.create_generated_half_day(text,text,date,text,text,text) from public,anon;
grant execute on function public.create_generated_half_day(text,text,date,text,text,text) to authenticated;

commit;
