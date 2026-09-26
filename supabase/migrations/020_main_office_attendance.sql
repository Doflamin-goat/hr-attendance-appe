-- MAIN Office biometric attendance. FORWARD-ONLY; DO NOT APPLY AUTOMATICALLY.
-- Depends on migration 019 employee HR scopes.
begin;

create table if not exists public.main_biometric_mappings (
  device_no text primary key,
  employee_id uuid not null references public.employees(id),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz not null default now()
);

create table if not exists public.main_daily_attendance (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'WAIS' check(workspace='WAIS'),
  employee_id uuid references public.employees(id),
  employee_name text not null,
  raw_name text not null,
  device_no text,
  work_date date not null,
  first_in time,
  last_out time,
  checkout_source text check(checkout_source in ('biometric','manual')),
  status text not null check(status in ('complete','missing_checkout','unmatched_employee')),
  late_minutes integer not null default 0,
  late_seconds integer not null default 0,
  is_half_day boolean not null default false,
  undertime_minutes integer not null default 0,
  source_file_name text not null,
  manual_checkout_by uuid references auth.users(id),
  manual_checkout_at timestamptz,
  manual_checkout_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists main_daily_employee_date_idx on public.main_daily_attendance(employee_id,work_date) where employee_id is not null;
create unique index if not exists main_daily_unmatched_raw_date_idx on public.main_daily_attendance(workspace,raw_name,work_date) where employee_id is null;

alter table public.absences add column if not exists employee_id uuid references public.employees(id);
alter table public.absences add column if not exists source_type text not null default 'manual';
alter table public.absences add column if not exists source_attendance_date date;
alter table public.absences drop constraint if exists absences_source_type_check;
alter table public.absences add constraint absences_source_type_check check(source_type in ('manual','system_generated'));
create unique index if not exists absences_unique_system_generated on public.absences(employee_id,work_date) where source_type='system_generated' and not is_deleted;

alter table public.main_daily_attendance enable row level security;
alter table public.main_biometric_mappings enable row level security;
create policy "MAIN scope reads daily attendance" on public.main_daily_attendance for select to authenticated using(public.attendance_hr_scope()='MAIN' and public.attendance_role() in ('HR','Admin'));
create policy "MAIN scope reads device mappings" on public.main_biometric_mappings for select to authenticated using(public.attendance_hr_scope()='MAIN' and public.attendance_role() in ('HR','Admin'));

create or replace function public.import_main_attendance(p_file_name text,p_records jsonb,p_roster jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r jsonb; d date; e public.employees%rowtype; file_id bigint; daily_id uuid; first_time time; last_time time;
begin
  if auth.uid() is null or public.attendance_role()<>'HR' or public.attendance_hr_scope()<>'MAIN' then raise exception 'MAIN HR access required'; end if;
  if jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)=0 then raise exception 'Valid MAIN attendance records required'; end if;
  insert into public.uploaded_files(workspace,file_name) values('WAIS',p_file_name) returning id into file_id;
  for r in select value from jsonb_array_elements(p_records) loop
    d=(r->>'workDate')::date; first_time=nullif(r->>'firstIn','')::time; last_time=nullif(r->>'lastOut','')::time;
    e=null;
    if nullif(r->>'employeeId','') is not null then
      select * into e from public.employees where id=(r->>'employeeId')::uuid and hr_scope='MAIN' and workspace='WAIS' and not is_deleted;
      if e.id is null then raise exception 'Employee is outside MAIN scope'; end if;
    end if;
    if e.id is not null then
      if not exists(select 1 from public.main_daily_attendance where employee_id=e.id and work_date=d)
         and exists(select 1 from public.main_daily_attendance where workspace='WAIS' and raw_name=r->>'rawName' and work_date=d and employee_id is null) then
        update public.main_daily_attendance set employee_id=e.id,employee_name=e.full_name,device_no=nullif(r->>'deviceNo',''),first_in=first_time,last_out=last_time,checkout_source=nullif(r->>'checkoutSource',''),status=r->>'status',late_minutes=coalesce((r->>'lateMinutes')::int,0),late_seconds=coalesce((r->>'lateSeconds')::int,0),is_half_day=coalesce((r->>'halfDay')::boolean,false),undertime_minutes=coalesce((r->>'undertimeMinutes')::int,0),source_file_name=p_file_name,updated_at=now()
        where workspace='WAIS' and raw_name=r->>'rawName' and work_date=d and employee_id is null returning id into daily_id;
      else
      insert into public.main_daily_attendance(workspace,employee_id,employee_name,raw_name,device_no,work_date,first_in,last_out,checkout_source,status,late_minutes,late_seconds,is_half_day,undertime_minutes,source_file_name)
      values('WAIS',e.id,e.full_name,r->>'rawName',nullif(r->>'deviceNo',''),d,first_time,last_time,nullif(r->>'checkoutSource',''),r->>'status',coalesce((r->>'lateMinutes')::int,0),coalesce((r->>'lateSeconds')::int,0),coalesce((r->>'halfDay')::boolean,false),coalesce((r->>'undertimeMinutes')::int,0),p_file_name)
      on conflict(employee_id,work_date) where employee_id is not null do update set employee_name=excluded.employee_name,raw_name=excluded.raw_name,device_no=excluded.device_no,first_in=excluded.first_in,last_out=excluded.last_out,checkout_source=excluded.checkout_source,status=excluded.status,late_minutes=excluded.late_minutes,late_seconds=excluded.late_seconds,is_half_day=excluded.is_half_day,undertime_minutes=excluded.undertime_minutes,source_file_name=excluded.source_file_name,updated_at=now()
      returning id into daily_id;
      end if;
    else
      insert into public.main_daily_attendance(workspace,employee_id,employee_name,raw_name,device_no,work_date,first_in,last_out,checkout_source,status,late_minutes,late_seconds,is_half_day,undertime_minutes,source_file_name)
      values('WAIS',null,r->>'employeeName',r->>'rawName',nullif(r->>'deviceNo',''),d,first_time,last_time,nullif(r->>'checkoutSource',''),'unmatched_employee',0,0,false,0,p_file_name)
      on conflict(workspace,raw_name,work_date) where employee_id is null do update set device_no=excluded.device_no,first_in=excluded.first_in,last_out=excluded.last_out,checkout_source=excluded.checkout_source,status='unmatched_employee',source_file_name=excluded.source_file_name,updated_at=now()
      returning id into daily_id;
    end if;
    if e.id is not null then
      update public.late_records set is_deleted=true,deleted_at=now(),deleted_reason='MAIN attendance re-imported' where workspace='WAIS' and work_date=d and public.employee_name_key(employee_name)=public.employee_name_key(e.full_name) and not is_deleted;
      update public.generated_undertimes set is_deleted=true,deleted_at=now(),deleted_reason='MAIN attendance re-imported' where workspace='WAIS' and work_date=d and public.employee_name_key(employee_name)=public.employee_name_key(e.full_name) and not is_deleted;
      if coalesce((r->>'lateMinutes')::int,0)>0 then insert into public.late_records(workspace,employee_name,work_date,time_in,minutes_late,seconds_late,total_seconds_late,source_file_id,source_file_name) values('WAIS',e.full_name,d,first_time,coalesce((r->>'lateMinutes')::int,0),coalesce((r->>'lateSeconds')::int,0),coalesce((r->>'lateMinutes')::int,0)*60+coalesce((r->>'lateSeconds')::int,0),file_id,p_file_name); end if;
      if coalesce((r->>'halfDay')::boolean,false) then perform public.create_generated_half_day('WAIS',e.full_name,d,'morning','Generated from MAIN attendance first C/In',p_file_name); end if;
      if last_time is not null and coalesce((r->>'undertimeMinutes')::int,0)>0 then insert into public.generated_undertimes(workspace,employee_name,work_date,time_in,minutes_undertime,source_file_id,source_file_name) values('WAIS',e.full_name,d,last_time,coalesce((r->>'undertimeMinutes')::int,0),file_id,p_file_name); end if;
      update public.absences set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='Corrected MAIN attendance import' where employee_id=e.id and work_date=d and source_type='system_generated' and not is_deleted;
    end if;
  end loop;
  for d in select distinct (value->>'workDate')::date from jsonb_array_elements(p_records) loop
    insert into public.absences(workspace,employee_id,employee_name,work_date,reason,informed_to,source_type,source_attendance_date)
    select 'WAIS',e2.id,e2.full_name,d,'No biometric attendance record','{}','system_generated',d from public.employees e2
    where e2.hr_scope='MAIN' and e2.workspace='WAIS' and e2.employment_status='active' and not e2.is_deleted and (e2.start_date is null or e2.start_date<=d)
      and not exists(select 1 from public.main_daily_attendance a where a.employee_id=e2.id and a.work_date=d and (a.first_in is not null or a.last_out is not null))
      and not exists(select 1 from public.absences a where a.employee_id=e2.id and a.work_date=d and a.source_type='system_generated' and not a.is_deleted);
  end loop;
end $$;

create or replace function public.set_main_manual_checkout(p_record_id uuid,p_checkout_time time,p_note text default null)
returns void language plpgsql security definer set search_path='' as $$
declare a public.main_daily_attendance%rowtype; shift_end time; mins integer; file_id bigint;
begin
  if auth.uid() is null or public.attendance_role()<>'HR' or public.attendance_hr_scope()<>'MAIN' then raise exception 'MAIN HR access required'; end if;
  select * into a from public.main_daily_attendance where id=p_record_id and workspace='WAIS' and employee_id is not null for update;
  if a.id is null then raise exception 'MAIN attendance record not found'; end if;
  shift_end=case when extract(dow from a.work_date)=6 then time '15:15' else time '17:00' end;
  mins=greatest(0,(extract(epoch from (shift_end-p_checkout_time))/60)::integer);
  update public.main_daily_attendance set last_out=p_checkout_time,checkout_source='manual',status='complete',undertime_minutes=mins,manual_checkout_by=auth.uid(),manual_checkout_at=now(),manual_checkout_note=nullif(btrim(p_note),''),updated_at=now() where id=a.id;
  update public.generated_undertimes set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='Manual checkout corrected' where workspace='WAIS' and work_date=a.work_date and public.employee_name_key(employee_name)=public.employee_name_key(a.employee_name) and not is_deleted;
  if mins>0 then select id into file_id from public.uploaded_files where workspace='WAIS' and file_name=a.source_file_name order by uploaded_at desc limit 1; insert into public.generated_undertimes(workspace,employee_name,work_date,time_in,minutes_undertime,source_file_id,source_file_name) values('WAIS',a.employee_name,a.work_date,p_checkout_time,mins,file_id,a.source_file_name); end if;
  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload) values('WAIS',auth.uid(),'main_daily_attendance',a.id::text,'manual_checkout',jsonb_build_object('checkout_time',p_checkout_time,'note',nullif(btrim(p_note),'')));
end $$;

revoke all on function public.import_main_attendance(text,jsonb,jsonb),public.set_main_manual_checkout(uuid,time,text) from public,anon;
grant execute on function public.import_main_attendance(text,jsonb,jsonb),public.set_main_manual_checkout(uuid,time,text) to authenticated;
commit;
