-- APP/ITC-only Service reconciliation for generated Half-Day and Undertime.
begin;

create table if not exists public.itc_service_attendance_effects (
  id uuid primary key default gen_random_uuid(),
  service_event_id uuid not null references public.service_events(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  work_date date not null,
  half_day_id uuid references public.half_day_records(id),
  undertime_id bigint references public.generated_undertimes(id),
  applied_at timestamptz not null default now(),
  restored_at timestamptz,
  unique(service_event_id, employee_id, work_date, half_day_id, undertime_id)
);
alter table public.itc_service_attendance_effects enable row level security;
drop policy if exists itc_service_effects_scoped_read on public.itc_service_attendance_effects;
create policy itc_service_effects_scoped_read on public.itc_service_attendance_effects for select to authenticated using (public.attendance_role() in ('HR','Admin') and exists(select 1 from public.service_events e where e.id=service_event_id and e.workspace='APP' and e.workspace=public.attendance_workspace()));

create or replace function public.reconcile_itc_service_attendance(p_event_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare
  ev public.service_events%rowtype;
  link record;
  hd record;
  ut record;
  n integer := 0;
begin
  if auth.uid() is null or public.attendance_role()<>'HR' or public.attendance_workspace()<>'APP' then raise exception 'Only APP HR can reconcile ITC Service attendance'; end if;
  select * into ev from public.service_events where id=p_event_id and workspace='APP' and not is_deleted for update;
  if ev.id is null then raise exception 'APP Service record not found'; end if;
  if ev.status='cancelled' then
    for hd in select * from public.itc_service_attendance_effects where service_event_id=ev.id and half_day_id is not null and restored_at is null loop
      update public.half_day_records set is_deleted=false,deleted_at=null,deleted_by=null,deleted_reason=null where id=hd.half_day_id and is_deleted;
      update public.itc_service_attendance_effects set restored_at=now() where id=hd.id;
    end loop;
    for ut in select * from public.itc_service_attendance_effects where service_event_id=ev.id and undertime_id is not null and restored_at is null loop
      update public.generated_undertimes set is_deleted=false,deleted_at=null,deleted_by=null,deleted_reason=null where id=ut.undertime_id and is_deleted;
      update public.itc_service_attendance_effects set restored_at=now() where id=ut.id;
    end loop;
    return 0;
  end if;
  for link in select employee_id from public.service_event_employees where service_event_id=ev.id and workspace='APP' loop
    for hd in select h.* from public.half_day_records h where h.workspace='APP' and h.employee_id=link.employee_id and h.source_type='attendance_upload' and not h.is_deleted and h.work_date between (ev.service_start at time zone 'Asia/Manila')::date and coalesce((ev.service_end at time zone 'Asia/Manila')::date,(ev.service_start at time zone 'Asia/Manila')::date) and ev.service_end is not null and ev.service_start <= ((h.work_date + case when h.absent_period='morning' then time '12:00' else time '17:00' end) at time zone 'Asia/Manila') loop
      update public.half_day_records set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='reconciled_by_itc_service' where id=hd.id;
      insert into public.itc_service_attendance_effects(service_event_id,employee_id,work_date,half_day_id) values(ev.id,link.employee_id,hd.work_date,hd.id) on conflict do nothing;
      n:=n+1;
    end loop;
    for ut in select u.* from public.generated_undertimes u where u.workspace='APP' and u.employee_id=link.employee_id and not u.is_deleted and u.work_date=(ev.service_start at time zone 'Asia/Manila')::date and ev.service_end is not null and ev.service_end >= ((u.work_date + u.time_in) at time zone 'Asia/Manila') loop
      update public.generated_undertimes set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='reconciled_by_itc_service' where id=ut.id;
      insert into public.itc_service_attendance_effects(service_event_id,employee_id,work_date,undertime_id) values(ev.id,link.employee_id,ut.work_date,ut.id) on conflict do nothing;
      n:=n+1;
    end loop;
  end loop;
  return n;
end $$;

create or replace function public.move_itc_generated_attendance_to_service(p_record_type text,p_record_id text,p_service_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare ev public.service_events%rowtype; emp uuid; d date;
begin
  if auth.uid() is null or public.attendance_role()<>'HR' or public.attendance_workspace()<>'APP' then raise exception 'Only APP HR can move generated attendance to Service'; end if;
  select * into ev from public.service_events where id=p_service_id and workspace='APP' and status<>'cancelled' and not is_deleted;
  if ev.id is null then raise exception 'Eligible APP Service record not found'; end if;
  if p_record_type='half_day' then select employee_id,work_date into emp,d from public.half_day_records where id=p_record_id::uuid and workspace='APP' and source_type='attendance_upload' and not is_deleted; elsif p_record_type='undertime' then select employee_id,work_date into emp,d from public.generated_undertimes where id=p_record_id::bigint and workspace='APP' and not is_deleted; else raise exception 'Unsupported generated attendance type'; end if;
  if emp is null or not exists(select 1 from public.service_event_employees where service_event_id=ev.id and employee_id=emp and workspace='APP') then raise exception 'Employee is not included in this Service'; end if;
  if d < (ev.service_start at time zone 'Asia/Manila')::date or d > coalesce((ev.service_end at time zone 'Asia/Manila')::date,(ev.service_start at time zone 'Asia/Manila')::date) then raise exception 'Service does not cover the attendance date'; end if;
  return public.reconcile_itc_service_attendance(ev.id);
end $$;

create or replace function public.reconcile_itc_service_event_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.workspace='APP' and current_setting('watts.itc_service_reconcile',true) is distinct from '1' then
    perform set_config('watts.itc_service_reconcile','1',true);
    perform public.reconcile_itc_service_attendance(new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_reconcile_itc_service_event_change on public.service_events;
create trigger trg_reconcile_itc_service_event_change after insert or update of service_start,service_end,status on public.service_events for each row execute function public.reconcile_itc_service_event_change();

revoke all on function public.reconcile_itc_service_attendance(uuid),public.move_itc_generated_attendance_to_service(text,text,uuid) from public,anon;
grant execute on function public.reconcile_itc_service_attendance(uuid),public.move_itc_generated_attendance_to_service(text,text,uuid) to authenticated;
commit;
