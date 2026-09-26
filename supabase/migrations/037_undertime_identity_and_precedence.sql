-- Canonical undertime identity and manual-over-generated precedence. Forward-only; unapplied.
begin;

alter table public.late_records add column if not exists employee_id uuid references public.employees(id);
alter table public.generated_undertimes add column if not exists employee_id uuid references public.employees(id);
alter table public.manual_undertimes
  add column if not exists employee_id uuid references public.employees(id),
  add column if not exists source_attendance_id uuid references public.main_daily_attendance(id);

-- Resolve historical names only when exactly one active employee in the same workspace matches.
with candidates as (
  select u.id,array_agg(e.id order by e.id) ids from public.late_records u
  join public.employees e on e.workspace=u.workspace and not e.is_deleted and e.employment_status='active' and
    (public.employee_name_key(e.full_name)=public.employee_name_key(u.employee_name) or
     public.employee_name_key(e.attendance_name)=public.employee_name_key(u.employee_name))
  where u.employee_id is null group by u.id having count(*)=1
) update public.late_records u set employee_id=c.ids[1] from candidates c where u.id=c.id;
with candidates as (
  select u.id,array_agg(e.id order by e.id) ids from public.generated_undertimes u
  join public.employees e on e.workspace=u.workspace and not e.is_deleted and e.employment_status='active' and
    (public.employee_name_key(e.full_name)=public.employee_name_key(u.employee_name) or
     public.employee_name_key(e.attendance_name)=public.employee_name_key(u.employee_name))
  where u.employee_id is null group by u.id having count(*)=1
) update public.generated_undertimes u set employee_id=c.ids[1] from candidates c where u.id=c.id;
with candidates as (
  select u.id,array_agg(e.id order by e.id) ids from public.manual_undertimes u
  join public.employees e on e.workspace=u.workspace and not e.is_deleted and e.employment_status='active' and
    (public.employee_name_key(e.full_name)=public.employee_name_key(u.employee_name) or
     public.employee_name_key(e.attendance_name)=public.employee_name_key(u.employee_name))
  where u.employee_id is null group by u.id having count(*)=1
) update public.manual_undertimes u set employee_id=c.ids[1] from candidates c where u.id=c.id;

-- Backfill a MAIN source only when exactly one complete active row has a valid early final checkout.
with candidates as (
  select u.id,array_agg(a.id order by a.id) ids from public.manual_undertimes u
  join public.main_daily_attendance a on a.workspace='WAIS' and a.employee_id=u.employee_id
    and a.work_date=u.work_date and not a.is_deleted and a.status='complete' and a.last_out is not null
    and extract(dow from a.work_date) between 1 and 6
    and a.last_out < case when extract(dow from a.work_date)=6 then time '15:15' else time '17:00' end
  where u.workspace='WAIS' and u.source_attendance_id is null and u.employee_id is not null
  group by u.id having count(*)=1
) update public.manual_undertimes u set source_attendance_id=c.ids[1] from candidates c where u.id=c.id;

-- Unresolved history remains auditable in Trash and cannot remain active name-only data.
update public.generated_undertimes set is_deleted=true,deleted_at=coalesce(deleted_at,now()),
  deleted_reason=coalesce(deleted_reason,'unresolved_employee_identity') where not is_deleted and employee_id is null;
update public.manual_undertimes set is_deleted=true,deleted_at=coalesce(deleted_at,now()),
  deleted_reason=coalesce(deleted_reason,'unresolved_employee_identity') where not is_deleted and employee_id is null;

-- Preflight: remove cross-table overlap, then reconcile within-table duplicates.
update public.generated_undertimes g set is_deleted=true,deleted_at=coalesce(g.deleted_at,now()),
  deleted_reason=coalesce(g.deleted_reason,'superseded_by_manual_undertime'),removed_from_recycle_bin=false
where not g.is_deleted and g.employee_id is not null and exists(select 1 from public.manual_undertimes m
  where not m.is_deleted and m.workspace=g.workspace and m.employee_id=g.employee_id and m.work_date=g.work_date);
with duplicates as (
  select id,row_number() over(partition by workspace,employee_id,work_date order by created_at desc nulls last,id desc) rn
  from public.generated_undertimes where not is_deleted and employee_id is not null
) update public.generated_undertimes g set is_deleted=true,deleted_at=coalesce(g.deleted_at,now()),
  deleted_reason=coalesce(g.deleted_reason,'duplicate_active_undertime_reconciled')
  from duplicates d where g.id=d.id and d.rn>1;
with duplicates as (
  select id,row_number() over(partition by workspace,employee_id,work_date order by created_at desc nulls last,id desc) rn
  from public.manual_undertimes where not is_deleted and employee_id is not null
) update public.manual_undertimes m set is_deleted=true,deleted_at=coalesce(m.deleted_at,now()),
  deleted_reason=coalesce(m.deleted_reason,'duplicate_active_undertime_reconciled')
  from duplicates d where m.id=d.id and d.rn>1;

create unique index if not exists generated_undertimes_one_active_employee_date
  on public.generated_undertimes(workspace,employee_id,work_date) where not is_deleted and employee_id is not null;
create unique index if not exists manual_undertimes_one_active_employee_date
  on public.manual_undertimes(workspace,employee_id,work_date) where not is_deleted and employee_id is not null;

-- All canonical writes for one workspace/employee/date share this transaction-scoped lock.
create or replace function public.lock_undertime_identity(p_workspace text,p_employee_id uuid,p_work_date date)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_workspace is null or p_employee_id is null or p_work_date is null then raise exception 'Complete undertime identity required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workspace||':'||p_employee_id::text||':'||p_work_date::text,0));
end $$;

create or replace function public.guard_generated_undertime_identity()
returns trigger language plpgsql security definer set search_path='' as $$
declare matches uuid[];
begin
  if new.employee_id is null then
    select array_agg(e.id order by e.id) into matches from public.employees e
    where e.workspace=new.workspace and not e.is_deleted and e.employment_status='active' and
      (public.employee_name_key(e.full_name)=public.employee_name_key(new.employee_name) or
       public.employee_name_key(e.attendance_name)=public.employee_name_key(new.employee_name));
    if pg_catalog.cardinality(matches)=1 then new.employee_id:=matches[1]; end if;
  end if;
  if not new.is_deleted and new.employee_id is null then return null; end if;
  if not new.is_deleted then
    perform public.lock_undertime_identity(new.workspace,new.employee_id,new.work_date);
    if exists(select 1 from public.manual_undertimes m where m.workspace=new.workspace and
      m.employee_id=new.employee_id and m.work_date=new.work_date and not m.is_deleted) then return null; end if;
  end if;
  return new;
end $$;
drop trigger if exists generated_undertime_identity_guard on public.generated_undertimes;
create trigger generated_undertime_identity_guard before insert or update on public.generated_undertimes
for each row execute function public.guard_generated_undertime_identity();

create or replace function public.apply_manual_undertime_precedence()
returns trigger language plpgsql security definer set search_path='' as $$
declare matches uuid[];
begin
  if new.employee_id is null then
    select array_agg(e.id order by e.id) into matches from public.employees e
    where e.workspace=new.workspace and not e.is_deleted and e.employment_status='active' and
      (public.employee_name_key(e.full_name)=public.employee_name_key(new.employee_name) or
       public.employee_name_key(e.attendance_name)=public.employee_name_key(new.employee_name));
    if pg_catalog.cardinality(matches)=1 then new.employee_id:=matches[1]; end if;
  end if;
  if not new.is_deleted and new.employee_id is null then return null; end if;
  if not new.is_deleted then
    perform public.lock_undertime_identity(new.workspace,new.employee_id,new.work_date);
    update public.generated_undertimes set is_deleted=true,deleted_at=coalesce(deleted_at,now()),deleted_by=auth.uid(),
      deleted_reason=coalesce(deleted_reason,'superseded_by_manual_undertime'),removed_from_recycle_bin=false
    where workspace=new.workspace and employee_id=new.employee_id and work_date=new.work_date and not is_deleted;
  end if;
  return new;
end $$;
drop trigger if exists manual_undertime_precedence on public.manual_undertimes;
create trigger manual_undertime_precedence before insert or update on public.manual_undertimes
for each row execute function public.apply_manual_undertime_precedence();

create or replace function public.create_manual_undertime(
  p_employee_id uuid,p_work_date date,p_reason text,p_undertime_hours text,p_informed text[] default '{}',
  p_source_attendance_id uuid default null,p_source_late_record_id bigint default null,p_original_time_in time default null,
  p_source_type text default 'manual-entry',p_is_manual_override boolean default true
) returns text language plpgsql security definer set search_path='' as $$
declare e public.employees%rowtype; a public.main_daily_attendance%rowtype; l public.late_records%rowtype;
  shift_end time; canonical_minutes integer; canonical_hours text; new_id text;
begin
  if auth.uid() is null or public.attendance_role()<>'HR' then raise exception 'HR access required'; end if;
  select * into e from public.employees where id=p_employee_id and workspace=public.attendance_workspace()
    and hr_scope=public.attendance_hr_scope() and not is_deleted and employment_status='active';
  if e.id is null then raise exception 'Employee is outside your HR scope'; end if;
  if nullif(btrim(p_reason),'') is null or nullif(btrim(p_undertime_hours),'') is null then raise exception 'Valid undertime details required'; end if;
  if p_source_type not in ('manual-entry','late-conversion') then raise exception 'Invalid manual undertime source type'; end if;
  perform public.lock_undertime_identity(public.attendance_workspace(),e.id,p_work_date);

  if public.attendance_hr_scope()='MAIN' then
    select * into a from public.main_daily_attendance where id=p_source_attendance_id and workspace='WAIS'
      and employee_id=e.id and work_date=p_work_date and not is_deleted and status='complete';
    if a.id is null or a.last_out is null then raise exception 'A complete canonical attendance record with a valid checkout is required'; end if;
    shift_end:=case when extract(dow from a.work_date)=6 then time '15:15'
      when extract(dow from a.work_date) between 1 and 5 then time '17:00' else null end;
    canonical_minutes:=case when shift_end is null then 0 else greatest(0,
      (extract(hour from shift_end)::integer*60+extract(minute from shift_end)::integer)-
      (extract(hour from a.last_out)::integer*60+extract(minute from a.last_out)::integer)) end;
    if canonical_minutes<=0 then
      raise exception 'Canonical attendance does not contain a valid undertime duration';
    end if;
    canonical_hours:=to_char(a.last_out,'HH24:MI')||' to '||to_char(shift_end,'HH24:MI')||' ('||
      (canonical_minutes/60)::text||' hour'||case when canonical_minutes/60=1 then '' else 's' end||
      case when canonical_minutes%60>0 then ' '||(canonical_minutes%60)::text||' minute'||
        case when canonical_minutes%60=1 then '' else 's' end else '' end||')';
  else
    if p_source_attendance_id is not null then raise exception 'ITC undertime cannot link MAIN attendance'; end if;
    select * into l from public.late_records where id=p_source_late_record_id and workspace=public.attendance_workspace()
      and employee_id=e.id and work_date=p_work_date and not is_deleted;
    if l.id is null then raise exception 'An active matching ITC Late Record is required'; end if;
    if not exists(select 1 from public.uploaded_files f where f.id=l.source_file_id and f.workspace=l.workspace and not f.is_deleted)
      then raise exception 'The linked ITC Late Record source is not active'; end if;
    canonical_hours:=btrim(p_undertime_hours);
  end if;

  if exists(select 1 from public.manual_undertimes where workspace=public.attendance_workspace() and
    employee_id=e.id and work_date=p_work_date and not is_deleted) then raise exception 'An active manual undertime already exists for this employee and date'; end if;
  update public.generated_undertimes set is_deleted=true,deleted_at=coalesce(deleted_at,now()),deleted_by=auth.uid(),
    deleted_reason=coalesce(deleted_reason,'superseded_by_manual_undertime'),removed_from_recycle_bin=false
  where workspace=public.attendance_workspace() and employee_id=e.id and work_date=p_work_date and not is_deleted;
  insert into public.manual_undertimes(workspace,employee_id,employee_name,work_date,reason,undertime_hours,
    source_attendance_id,source_late_record_id,original_time_in,source_type,is_manual_override,informed_to)
  values(public.attendance_workspace(),e.id,e.full_name,p_work_date,btrim(p_reason),canonical_hours,
    p_source_attendance_id,p_source_late_record_id,p_original_time_in,p_source_type,p_is_manual_override,coalesce(p_informed,'{}'))
  returning id::text into new_id;
  return new_id;
end $$;

revoke all on function public.lock_undertime_identity(text,uuid,date) from public,anon;
revoke all on function public.create_manual_undertime(uuid,date,text,text,text[],uuid,bigint,time,text,boolean) from public,anon;
grant execute on function public.create_manual_undertime(uuid,date,text,text,text[],uuid,bigint,time,text,boolean) to authenticated;
commit;
