-- Service management and scoped MAIN attendance integration.
-- Forward-only; review and apply manually after migration 041.
begin;

create table if not exists public.service_events (
  id uuid primary key default gen_random_uuid(), service_ref text not null unique,
  workspace text not null check (workspace in ('APP','WAIS')),
  service_start timestamptz not null, service_end timestamptz,
  client text, location text, purpose text, remarks text,
  status text not null default 'in_service' check (status in ('in_service','completed','cancelled')),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid references auth.users(id),
  constraint service_end_after_start check (service_end is null or service_end >= service_start),
  constraint completed_service_has_end check (status <> 'completed' or service_end is not null)
);
create table if not exists public.service_event_employees (
  service_event_id uuid not null references public.service_events(id) on delete cascade,
  employee_id uuid not null references public.employees(id), workspace text not null check (workspace in ('APP','WAIS')),
  primary key (service_event_id, employee_id)
);
create table if not exists public.service_event_effects (
  service_event_id uuid not null references public.service_events(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  work_date date not null,
  attendance_id uuid references public.main_daily_attendance(id),
  checkout_applied boolean not null default false,
  suppressed_undertime boolean not null default false,
  suppressed_absence boolean not null default false,
  applied boolean not null default true,
  rolled_back_at timestamptz,
  primary key (service_event_id, employee_id, work_date)
);

alter table public.main_daily_attendance add column if not exists biometric_last_out_at timestamptz;
alter table public.main_daily_attendance add column if not exists effective_last_out_at timestamptz;
alter table public.main_daily_attendance add column if not exists service_event_id uuid references public.service_events(id);
alter table public.main_daily_attendance drop constraint if exists main_daily_checkout_source_check;
alter table public.main_daily_attendance drop constraint if exists main_daily_attendance_checkout_source_check;
alter table public.main_daily_attendance add constraint main_daily_checkout_source_check check (checkout_source in ('biometric','manual','service') or checkout_source is null);
update public.main_daily_attendance set biometric_last_out_at=((work_date + biometric_last_out) at time zone 'Asia/Manila') where biometric_last_out_at is null and biometric_last_out is not null;

alter table public.service_events enable row level security;
alter table public.service_event_employees enable row level security;
alter table public.service_event_effects enable row level security;
drop policy if exists service_events_scoped_read on public.service_events;
create policy service_events_scoped_read on public.service_events for select to authenticated using (auth.uid() is not null and public.attendance_role() in ('HR','Admin') and workspace=public.attendance_workspace() and not is_deleted);
drop policy if exists service_event_employees_scoped_read on public.service_event_employees;
create policy service_event_employees_scoped_read on public.service_event_employees for select to authenticated using (auth.uid() is not null and public.attendance_role() in ('HR','Admin') and workspace=public.attendance_workspace());
drop policy if exists service_event_effects_scoped_read on public.service_event_effects;
create policy service_event_effects_scoped_read on public.service_event_effects for select to authenticated using (auth.uid() is not null and public.attendance_role() in ('HR','Admin') and exists (select 1 from public.service_events e where e.id=service_event_id and e.workspace=public.attendance_workspace() and not e.is_deleted));

create or replace function public.service_work_window_overlaps(p_start timestamptz,p_end timestamptz,p_work_date date)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare window_start timestamptz; window_end timestamptz; effective_end timestamptz; day_of_week integer;
begin
  day_of_week:=extract(dow from p_work_date)::integer;
  if day_of_week=0 then return false; end if;
  window_start:=((p_work_date+case when day_of_week=6 then time '07:00' else time '08:00' end) at time zone 'Asia/Manila');
  window_end:=((p_work_date+case when day_of_week=6 then time '15:00' else time '17:00' end) at time zone 'Asia/Manila');
  effective_end:=coalesce(p_end,now());
  return p_start<window_end and effective_end>window_start and effective_end>p_start;
end $$;

create or replace function public.reconcile_main_service_attendance(p_event_id uuid,p_apply boolean)
returns void language plpgsql security definer set search_path='' as $$
-- Legacy generated_undertimes do not have source_attendance_id=a.id; effect identity is employee/date.
declare e public.service_events%rowtype; link record; a public.main_daily_attendance%rowtype; eff record; day_value date; end_day date; biometric_at timestamptz; shift_end time; minutes integer; service_covers_shift_end boolean;
begin
  select * into e from public.service_events where id=p_event_id for update;
  if e.id is null or e.workspace is distinct from 'WAIS' then return; end if;
  if p_apply and e.status is distinct from 'in_service' and e.status is distinct from 'completed' then return; end if;
  perform set_config('watts.service_reconcile','1',true);
  day_value:=(e.service_start at time zone 'Asia/Manila')::date;
  end_day:=coalesce((e.service_end at time zone 'Asia/Manila')::date,(now() at time zone 'Asia/Manila')::date);
  if p_apply then
    for link in select employee_id from public.service_event_employees where service_event_id=e.id and workspace='WAIS' loop
      for day_value in select g::date from generate_series((e.service_start at time zone 'Asia/Manila')::date,end_day,interval '1 day') g where extract(dow from g) between 1 and 6 loop
        if not public.service_work_window_overlaps(e.service_start,e.service_end,day_value) then continue; end if;
        select * into a from public.main_daily_attendance where employee_id=link.employee_id and workspace='WAIS' and work_date=day_value and not is_deleted for update;
        insert into public.service_event_effects(service_event_id,employee_id,work_date,attendance_id,applied,rolled_back_at)
        values(e.id,link.employee_id,day_value,a.id,true,null)
        on conflict(service_event_id,employee_id,work_date) do update set attendance_id=excluded.attendance_id,checkout_applied=false,suppressed_undertime=false,suppressed_absence=false,applied=true,rolled_back_at=null;
        if a.id is not null and day_value=(e.service_start at time zone 'Asia/Manila')::date and e.status='completed' and e.service_end is not null and a.checkout_source is distinct from 'manual' then
          biometric_at:=coalesce(a.biometric_last_out_at,case when coalesce(a.biometric_last_out,a.last_out) is null then null else ((a.work_date+coalesce(a.biometric_last_out,a.last_out)) at time zone 'Asia/Manila') end);
          if biometric_at is null or e.service_end>biometric_at then
            shift_end:=case when extract(dow from a.work_date)=6 then time '15:00' when extract(dow from a.work_date) between 1 and 5 then time '17:00' else null end;
            service_covers_shift_end:=shift_end is not null
              and ((e.service_end at time zone 'Asia/Manila')::date>a.work_date or ((e.service_end at time zone 'Asia/Manila')::date=a.work_date and (e.service_end at time zone 'Asia/Manila')::time>=shift_end))
              and ((e.service_start at time zone 'Asia/Manila')::date<a.work_date or ((e.service_start at time zone 'Asia/Manila')::date=a.work_date and (e.service_start at time zone 'Asia/Manila')::time<=(biometric_at at time zone 'Asia/Manila')::time));
            update public.main_daily_attendance set biometric_last_out_at=biometric_at,effective_last_out_at=e.service_end,last_out=(e.service_end at time zone 'Asia/Manila')::time,checkout_source='service',service_event_id=e.id,status='complete',undertime_minutes=case when service_covers_shift_end then 0 else a.undertime_minutes end,updated_at=now() where id=a.id;
            update public.service_event_effects set checkout_applied=true where service_event_id=e.id and employee_id=a.employee_id and work_date=a.work_date;
          end if;
        end if;
        shift_end:=case when extract(dow from day_value)=6 then time '15:00' when extract(dow from day_value) between 1 and 5 then time '17:00' else null end;
        if shift_end is not null and exists(
          select 1 from public.generated_undertimes gu
          where gu.workspace='WAIS' and gu.employee_id=link.employee_id and gu.work_date=day_value and not gu.is_deleted
            and public.service_work_window_overlaps(e.service_start,e.service_end,day_value)
            and ((coalesce(e.service_end,now()) at time zone 'Asia/Manila')::date>day_value or ((coalesce(e.service_end,now()) at time zone 'Asia/Manila')::date=day_value and (coalesce(e.service_end,now()) at time zone 'Asia/Manila')::time>=shift_end))
            and ((e.service_start at time zone 'Asia/Manila')::date<day_value or ((e.service_start at time zone 'Asia/Manila')::date=day_value and (e.service_start at time zone 'Asia/Manila')::time<=gu.time_in))
        ) then
          update public.generated_undertimes set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='Completed service supplied final checkout' where workspace='WAIS' and employee_id=link.employee_id and work_date=day_value and not is_deleted
            and public.service_work_window_overlaps(e.service_start,e.service_end,day_value)
            and ((coalesce(e.service_end,now()) at time zone 'Asia/Manila')::date>day_value or ((coalesce(e.service_end,now()) at time zone 'Asia/Manila')::date=day_value and (coalesce(e.service_end,now()) at time zone 'Asia/Manila')::time>=shift_end))
            and ((e.service_start at time zone 'Asia/Manila')::date<day_value or ((e.service_start at time zone 'Asia/Manila')::date=day_value and (e.service_start at time zone 'Asia/Manila')::time<=time_in));
          update public.service_event_effects set suppressed_undertime=true where service_event_id=e.id and employee_id=link.employee_id and work_date=day_value;
        end if;
        if (a.id is null or (a.first_in is null and a.last_out is null)) and not exists(select 1 from public.absences where workspace='WAIS' and employee_id=link.employee_id and work_date=day_value and source_type='manual' and not is_deleted) and exists(select 1 from public.absences where workspace='WAIS' and employee_id=link.employee_id and work_date=day_value and source_type='system_generated' and not is_deleted) then
          update public.absences set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='Service covered the work date' where workspace='WAIS' and employee_id=link.employee_id and work_date=day_value and source_type='system_generated' and not is_deleted;
          update public.service_event_effects set suppressed_absence=true where service_event_id=e.id and employee_id=link.employee_id and work_date=day_value;
        end if;
      end loop;
    end loop;
  else
    for eff in select * from public.service_event_effects where service_event_id=e.id and applied for update loop
      select * into a from public.main_daily_attendance where id=eff.attendance_id and workspace='WAIS' for update;
      if a.id is null then
        select * into a from public.main_daily_attendance where employee_id=eff.employee_id and workspace='WAIS' and work_date=eff.work_date and not is_deleted for update;
      end if;
      if eff.checkout_applied and a.id is not null and a.checkout_source='service' and a.service_event_id=e.id then
        update public.main_daily_attendance set effective_last_out_at=biometric_last_out_at,last_out=case when biometric_last_out_at is null then null else (biometric_last_out_at at time zone 'Asia/Manila')::time end,checkout_source=case when biometric_last_out_at is null then null else 'biometric' end,service_event_id=null,status=case when biometric_last_out_at is null then 'missing_checkout' else 'complete' end,updated_at=now() where id=a.id;
      end if;
      if eff.suppressed_undertime and a.id is not null and a.biometric_last_out_at is not null and not exists(select 1 from public.manual_undertimes where workspace='WAIS' and employee_id=eff.employee_id and work_date=eff.work_date and not is_deleted) and not exists(select 1 from public.generated_undertimes where workspace='WAIS' and employee_id=eff.employee_id and work_date=eff.work_date and not is_deleted) then
        shift_end:=case when extract(dow from eff.work_date)=6 then time '15:00' when extract(dow from eff.work_date) between 1 and 5 then time '17:00' else null end;
        minutes:=case when shift_end is null then 0 else greatest(0,(extract(epoch from (shift_end-(a.biometric_last_out_at at time zone 'Asia/Manila')::time))/60)::integer) end;
        if minutes>0 then insert into public.generated_undertimes(workspace,employee_id,employee_name,work_date,time_in,minutes_undertime,source_file_id,source_file_name) values('WAIS',eff.employee_id,a.employee_name,eff.work_date,(a.biometric_last_out_at at time zone 'Asia/Manila')::time,minutes,a.source_file_id::text,a.source_file_name); end if;
      end if;
      if eff.suppressed_absence and not exists(select 1 from public.absences where workspace='WAIS' and employee_id=eff.employee_id and work_date=eff.work_date and source_type='manual' and not is_deleted) and not exists(select 1 from public.main_daily_attendance where workspace='WAIS' and employee_id=eff.employee_id and work_date=eff.work_date and not is_deleted and (first_in is not null or last_out is not null)) then
        insert into public.absences(workspace,employee_id,employee_name,work_date,reason,informed_to,source_type,source_attendance_date) select 'WAIS',emp.id,emp.full_name,eff.work_date,'No biometric attendance record','{}','system_generated',eff.work_date from public.employees emp where emp.id=eff.employee_id and emp.workspace='WAIS' and emp.hr_scope='MAIN' and emp.employment_status='active' and not emp.is_deleted and not exists(select 1 from public.absences where workspace='WAIS' and employee_id=eff.employee_id and work_date=eff.work_date and source_type='system_generated' and not is_deleted);
      end if;
      update public.service_event_effects set applied=false,rolled_back_at=now() where service_event_id=e.id and employee_id=eff.employee_id and work_date=eff.work_date;
    end loop;
  end if;
end $$;

create or replace function public.reconcile_main_service_attendance_row()
returns trigger language plpgsql security definer set search_path='' as $$
declare event_id uuid; attendance_id uuid;
begin
  if current_setting('watts.service_reconcile',true)='1' then return new; end if;
  if new.workspace='WAIS' and not new.is_deleted then
    for event_id in
      select distinct e.id
      from public.service_events e
      join public.service_event_employees l on l.service_event_id=e.id
      where l.employee_id=new.employee_id and e.workspace='WAIS' and e.status in ('in_service','completed') and not e.is_deleted
        and public.service_work_window_overlaps(e.service_start,e.service_end,new.work_date)
    loop
      perform public.reconcile_main_service_attendance(event_id,true);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_reconcile_main_service_attendance_row on public.main_daily_attendance;
create trigger trg_reconcile_main_service_attendance_row after insert or update on public.main_daily_attendance for each row execute function public.reconcile_main_service_attendance_row();

create or replace function public.service_require_hr(p_workspace text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or public.attendance_role() is distinct from 'HR' or public.attendance_workspace() is distinct from p_workspace or (p_workspace='WAIS' and public.attendance_hr_scope() is distinct from 'MAIN') or (p_workspace='APP' and public.attendance_hr_scope() is distinct from 'ITC') or p_workspace not in ('APP','WAIS') then raise exception 'HR access required for this workspace'; end if;
end $$;

create or replace function public.service_validate_employees(p_workspace text,p_employee_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
begin
  if coalesce(array_length(p_employee_ids,1),0)=0 then raise exception 'Select at least one employee'; end if;
  if exists(select 1 from public.employees where id=any(p_employee_ids) and (workspace<>p_workspace or hr_scope<>case when p_workspace='WAIS' then 'MAIN' else 'ITC' end or is_deleted or employment_status<>'active')) or (select count(*) from public.employees where id=any(p_employee_ids))<>array_length(p_employee_ids,1) then raise exception 'Employee is outside workspace scope'; end if;
end $$;

create or replace function public.service_validate_overlap(p_event_id uuid,p_employee_ids uuid[],p_start timestamptz,p_end timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare employee_id uuid;
begin
  for employee_id in select id from unnest(p_employee_ids) as ids(id) order by id loop
    perform pg_advisory_xact_lock(hashtextextended('service-overlap:'||employee_id::text,0));
  end loop;
  if exists(select 1 from public.service_event_employees l join public.service_events e on e.id=l.service_event_id where l.employee_id=any(p_employee_ids) and e.status in ('in_service','completed') and not e.is_deleted and e.id is distinct from p_event_id and e.service_start<coalesce(p_end,'infinity'::timestamptz) and coalesce(e.service_end,'infinity'::timestamptz)>p_start) then raise exception 'Employee already has an overlapping Service record'; end if;
end $$;

create or replace function public.service_reference(p_year text)
returns text language plpgsql security definer set search_path='' as $$
declare next_number integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('service-ref:'||p_year,0));
  select coalesce(max((substring(service_ref from '^SR-'||p_year||'-([0-9]+)$'))::integer),0)+1 into next_number from public.service_events;
  return 'SR-'||p_year||'-'||lpad(next_number::text,4,'0');
end $$;

create or replace function public.create_service_event(p_service_ref text,p_workspace text,p_service_start timestamptz,p_service_end timestamptz,p_employee_ids uuid[],p_client text default null,p_location text default null,p_purpose text default null,p_remarks text default null,p_status text default 'in_service')
returns uuid language plpgsql security definer set search_path='' as $$
declare event_id uuid; employee_id uuid; ref text:=nullif(btrim(p_service_ref),'');
begin
  perform public.service_require_hr(p_workspace);
  if p_service_start is null or p_status not in ('in_service','completed','cancelled') or (p_status='completed' and p_service_end is null) then raise exception 'Valid service details required'; end if;
  perform public.service_validate_employees(p_workspace,p_employee_ids); perform public.service_validate_overlap(null,p_employee_ids,p_service_start,p_service_end);
  if ref is null then ref:=public.service_reference(to_char(p_service_start at time zone 'Asia/Manila','YYYY')); end if;
  insert into public.service_events(service_ref,workspace,service_start,service_end,client,location,purpose,remarks,status,created_by,updated_by) values(ref,p_workspace,p_service_start,p_service_end,nullif(btrim(p_client),''),nullif(btrim(p_location),''),nullif(btrim(p_purpose),''),nullif(btrim(p_remarks),''),p_status,auth.uid(),auth.uid()) returning id into event_id;
  foreach employee_id in array p_employee_ids loop insert into public.service_event_employees(service_event_id,employee_id,workspace) values(event_id,employee_id,p_workspace); end loop;
  if p_workspace='WAIS' then perform public.reconcile_main_service_attendance(event_id,true); end if;
  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload) values(p_workspace,auth.uid(),'service_event',event_id::text,'create',jsonb_build_object('service_ref',ref,'status',p_status,'service_start',p_service_start,'service_end',p_service_end,'employee_ids',p_employee_ids)); return event_id;
end $$;

create or replace function public.update_service_event(p_id uuid,p_service_ref text,p_workspace text,p_service_start timestamptz,p_service_end timestamptz,p_employee_ids uuid[],p_client text default null,p_location text default null,p_purpose text default null,p_remarks text default null,p_status text default 'in_service')
returns void language plpgsql security definer set search_path='' as $$
declare old_event public.service_events%rowtype; ref text;
begin
  perform public.service_require_hr(p_workspace); select * into old_event from public.service_events where id=p_id and workspace=p_workspace and not is_deleted for update; if old_event.id is null then raise exception 'Service record not found'; end if;
  if p_service_start is null or p_status not in ('in_service','completed','cancelled') or (p_status='completed' and p_service_end is null) then raise exception 'Valid service details required'; end if;
  perform public.service_validate_employees(p_workspace,p_employee_ids); perform public.service_validate_overlap(p_id,p_employee_ids,p_service_start,p_service_end); ref:=coalesce(nullif(btrim(p_service_ref),''),old_event.service_ref);
  if p_workspace='WAIS' then perform set_config('watts.service_reconcile','1',true); perform public.reconcile_main_service_attendance(p_id,false); end if;
  update public.service_events set service_ref=ref,service_start=p_service_start,service_end=p_service_end,client=nullif(btrim(p_client),''),location=nullif(btrim(p_location),''),purpose=nullif(btrim(p_purpose),''),remarks=nullif(btrim(p_remarks),''),status=p_status,updated_by=auth.uid(),updated_at=now() where id=p_id;
  delete from public.service_event_employees where service_event_id=p_id;
  insert into public.service_event_employees(service_event_id,employee_id,workspace) select p_id,id,p_workspace from public.employees where id=any(p_employee_ids);
  if p_workspace='WAIS' then perform public.reconcile_main_service_attendance(p_id,true); end if;
  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload) values(p_workspace,auth.uid(),'service_event',p_id::text,'update',jsonb_build_object('service_ref',ref,'status',p_status,'service_start',p_service_start,'service_end',p_service_end,'employee_ids',p_employee_ids));
end $$;

create or replace function public.cancel_service_event(p_id uuid,p_workspace text)
returns void language plpgsql security definer set search_path='' as $$
declare event_row public.service_events%rowtype;
begin
  perform public.service_require_hr(p_workspace); select * into event_row from public.service_events where id=p_id and workspace=p_workspace and not is_deleted for update; if event_row.id is null then raise exception 'Service record not found in this workspace'; end if;
  if event_row.workspace='WAIS' then perform set_config('watts.service_reconcile','1',true); perform public.reconcile_main_service_attendance(event_row.id,false); end if;
  update public.service_events set status='cancelled',updated_by=auth.uid(),updated_at=now() where id=event_row.id;
  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload) values(event_row.workspace,auth.uid(),'service_event',event_row.id::text,'cancel',jsonb_build_object('service_ref',event_row.service_ref,'status','cancelled','service_start',event_row.service_start,'service_end',event_row.service_end));
end $$;

create or replace function public.preserve_main_service_checkout()
returns trigger language plpgsql security definer set search_path='' as $$
declare incoming timestamptz;
begin
  if current_setting('watts.service_reconcile',true)='1' then return new; end if;
  if new.biometric_last_out is not null then incoming:=((new.work_date+new.biometric_last_out) at time zone 'Asia/Manila'); new.biometric_last_out_at:=incoming; end if;
  if tg_op='UPDATE' and old.checkout_source='service' and new.checkout_source is distinct from 'manual' and old.effective_last_out_at is not null then
    if incoming is null or incoming<=old.effective_last_out_at then new.last_out:=old.last_out; new.checkout_source:='service'; new.effective_last_out_at:=old.effective_last_out_at; new.service_event_id:=old.service_event_id; new.status:='complete'; new.undertime_minutes:=0;
    elsif incoming>old.effective_last_out_at then new.effective_last_out_at:=incoming; new.checkout_source:='biometric'; new.service_event_id:=null; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_preserve_main_service_checkout on public.main_daily_attendance;
create trigger trg_preserve_main_service_checkout before insert or update on public.main_daily_attendance for each row execute function public.preserve_main_service_checkout();

create or replace function public.suppress_service_generated_absence()
returns trigger language plpgsql security definer set search_path='' as $$
declare event_id uuid;
begin
  if current_setting('watts.service_reconcile',true)='1' then return new; end if;
  if new.workspace='WAIS' and new.source_type='system_generated' and new.employee_id is not null and extract(dow from new.work_date) between 1 and 6 then
    select e.id into event_id from public.service_events e join public.service_event_employees l on l.service_event_id=e.id
    where l.employee_id=new.employee_id and e.workspace='WAIS' and e.status in ('in_service','completed') and not e.is_deleted
      and public.service_work_window_overlaps(e.service_start,e.service_end,new.work_date) limit 1;
    if event_id is not null then
      insert into public.service_event_effects(service_event_id,employee_id,work_date,suppressed_absence,applied) values(event_id,new.employee_id,new.work_date,true,true)
      on conflict(service_event_id,employee_id,work_date) do update set suppressed_absence=true,applied=true,rolled_back_at=null;
      return null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_service_generated_absence on public.absences;
create trigger trg_service_generated_absence before insert on public.absences for each row execute function public.suppress_service_generated_absence();

create or replace function public.suppress_service_generated_undertime()
returns trigger language plpgsql security definer set search_path='' as $$
declare event_id uuid; attendance_id uuid;
begin
  if current_setting('watts.service_reconcile',true)='1' then return new; end if;
  if new.workspace='WAIS' and new.employee_id is not null and extract(dow from new.work_date) between 1 and 6 then
    select e.id into event_id from public.service_events e join public.service_event_employees l on l.service_event_id=e.id
    where l.employee_id=new.employee_id and e.workspace='WAIS' and e.status in ('in_service','completed') and not e.is_deleted
      and public.service_work_window_overlaps(e.service_start,e.service_end,new.work_date)
      and ((coalesce(e.service_end,now()) at time zone 'Asia/Manila')::date>new.work_date or ((coalesce(e.service_end,now()) at time zone 'Asia/Manila')::date=new.work_date and (coalesce(e.service_end,now()) at time zone 'Asia/Manila')::time>=case when extract(dow from new.work_date)=6 then time '15:00' when extract(dow from new.work_date) between 1 and 5 then time '17:00' else time '00:00' end))
      and ((e.service_start at time zone 'Asia/Manila')::date<new.work_date or ((e.service_start at time zone 'Asia/Manila')::date=new.work_date and (e.service_start at time zone 'Asia/Manila')::time<=new.time_in)) limit 1;
    if event_id is not null then
      select a.id into attendance_id from public.main_daily_attendance a where a.employee_id=new.employee_id and a.workspace='WAIS' and a.work_date=new.work_date and not a.is_deleted limit 1;
      insert into public.service_event_effects(service_event_id,employee_id,work_date,attendance_id,suppressed_undertime,applied) values(event_id,new.employee_id,new.work_date,attendance_id,true,true)
      on conflict(service_event_id,employee_id,work_date) do update set attendance_id=coalesce(excluded.attendance_id,public.service_event_effects.attendance_id),suppressed_undertime=true,applied=true,rolled_back_at=null;
      return null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_service_generated_undertime on public.generated_undertimes;
create trigger trg_service_generated_undertime before insert on public.generated_undertimes for each row execute function public.suppress_service_generated_undertime();

revoke all on table public.service_events,public.service_event_employees,public.service_event_effects from anon,authenticated;
grant select on table public.service_events,public.service_event_employees,public.service_event_effects to authenticated;
revoke all on function public.service_work_window_overlaps(timestamptz,timestamptz,date),public.reconcile_main_service_attendance(uuid,boolean),public.reconcile_main_service_attendance_row(),public.service_require_hr(text),public.service_validate_employees(text,uuid[]),public.service_validate_overlap(uuid,uuid[],timestamptz,timestamptz),public.service_reference(text) from public,anon,authenticated;
revoke all on function public.create_service_event(text,text,timestamptz,timestamptz,uuid[],text,text,text,text,text),public.update_service_event(uuid,text,text,timestamptz,timestamptz,uuid[],text,text,text,text,text),public.cancel_service_event(uuid,text) from public,anon;
grant execute on function public.create_service_event(text,text,timestamptz,timestamptz,uuid[],text,text,text,text,text),public.update_service_event(uuid,text,text,timestamptz,timestamptz,uuid[],text,text,text,text,text),public.cancel_service_event(uuid,text) to authenticated;
commit;
