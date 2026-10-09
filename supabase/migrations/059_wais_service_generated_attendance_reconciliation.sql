-- MAIN / WAIS only. Apply manually after 058. No APP functions are replaced.
begin;

-- Keep exact row identities in the existing effect ledger, including rolled-back
-- history. generated_undertimes IDs are BIGINT; absence/Half-Day IDs are UUID.
-- JSON stores their textual identities without introducing incompatible FKs.
alter table public.service_event_effects
  add column if not exists suppressed_half_day boolean not null default false,
  add column if not exists generated_records jsonb not null default '[]'::jsonb;
create index if not exists service_effects_main_employee_date on public.service_event_effects(employee_id,work_date);

-- MAIN schedule: attendanceForms.halfDayRange / MAIN checkout rules (020/037/041).
-- Saturday has no lunch gap and ends at 15:15, not the old Service 15:00 cutoff.
create or replace function public.main_service_work_period(p_date date,p_period text default null)
returns tstzmultirange language sql immutable set search_path='' as $$
  select coalesce(range_agg(tstzrange((p_date+s) at time zone 'Asia/Manila',
                                    (p_date+e) at time zone 'Asia/Manila','[)')), '{}'::tstzmultirange)
  from (values
    ('morning',case when extract(dow from p_date)=6 then time '07:00' else time '08:00' end,
               case when extract(dow from p_date)=6 then time '11:00' else time '12:00' end),
    ('afternoon',case when extract(dow from p_date)=6 then time '11:00' else time '13:00' end,
                 case when extract(dow from p_date)=6 then time '15:15' else time '17:00' end)
  ) w(period,s,e)
  where extract(dow from p_date) between 1 and 6 and (p_period is null or period=p_period);
$$;

create or replace function public.main_service_coverage(p_employee uuid,p_date date,
  p_exclude uuid default null,p_candidate uuid default null)
returns tstzmultirange language sql stable security definer set search_path='' as $$
  select coalesce(range_agg(tstzrange(e.service_start,least(coalesce(e.service_end,now()),now()),'[)')),
                  '{}'::tstzmultirange)
  from public.service_events e
  where e.workspace='WAIS' and not e.is_deleted and e.status in ('in_service','completed')
    and (e.status<>'completed' or e.service_end is not null)
    and e.id is distinct from p_exclude
    and e.service_start<least(coalesce(e.service_end,now()),now())
    and e.service_start<((p_date+1)::timestamp at time zone 'Asia/Manila')
    and coalesce(e.service_end,now())>(p_date::timestamp at time zone 'Asia/Manila')
    and (e.id=p_candidate or exists(select 1 from public.service_event_employees l
      where l.service_event_id=e.id and l.workspace='WAIS' and l.employee_id=p_employee));
$$;

create or replace function public.main_service_office_coverage(p_employee uuid,p_date date)
returns tstzmultirange language sql stable security definer set search_path='' as $$
  select coalesce(range_agg(tstzrange((p_date+a.first_in) at time zone 'Asia/Manila',
    least((p_date+v.last_out) at time zone 'Asia/Manila',now()),'[)')), '{}'::tstzmultirange)
  from public.main_daily_attendance a
  cross join lateral (select case when a.checkout_source='manual' then a.last_out
    else coalesce(a.biometric_last_out,(a.biometric_last_out_at at time zone 'Asia/Manila')::time,
                  case when a.checkout_source='biometric' then a.last_out end) end last_out) v
  where a.workspace='WAIS' and a.employee_id=p_employee and a.work_date=p_date and not a.is_deleted
    and a.first_in is not null and v.last_out>=a.first_in
    and (a.status='complete' or a.checkout_source='service')
    and (p_date+a.first_in) at time zone 'Asia/Manila'<now();
$$;

-- A single definition is used by automatic reconciliation and candidate lookup.
create or replace function public.main_service_attendance_target(p_type text,p_id text)
returns table(employee_id uuid,work_date date,required_period tstzmultirange)
language plpgsql stable security definer set search_path='' as $$
declare r record; clock_value time; a public.main_daily_attendance%rowtype;
begin
  if p_type='absence' then
    select x.employee_id,x.work_date,null::text period,null::text clock into r
      from public.absences x where x.id::text=p_id and x.workspace='WAIS' and x.source_type='system_generated';
  elsif p_type='half_day' then
    select x.employee_id,x.work_date,x.absent_period::text period,null::text clock into r
      from public.half_day_records x where x.id::text=p_id and x.workspace='WAIS'
        and x.source_type in ('attendance_upload','system_generated');
  elsif p_type='undertime' then
    select x.employee_id,x.work_date,null::text period,x.time_in::text clock into r
      from public.generated_undertimes x where x.id::text=p_id and x.workspace='WAIS';
  else return;
  end if;
  if r.employee_id is null or not exists(select 1 from public.employees e
      where e.id=r.employee_id and e.workspace='WAIS' and e.hr_scope='MAIN'
        and not e.is_deleted and e.employment_status='active' and (e.start_date is null or e.start_date<=r.work_date)) then return; end if;
  employee_id:=r.employee_id; work_date:=r.work_date;
  required_period:=public.main_service_work_period(r.work_date,r.period);
  if p_type='undertime' then
    select * into a from public.main_daily_attendance d where d.workspace='WAIS'
      and d.employee_id=r.employee_id and d.work_date=r.work_date and not d.is_deleted;
    clock_value:=case when a.checkout_source='manual' then a.last_out
      else coalesce(a.biometric_last_out,(a.biometric_last_out_at at time zone 'Asia/Manila')::time,
                    case when a.checkout_source='biometric' then a.last_out end) end;
    if a.id is not null and (clock_value is null or clock_value<a.first_in) then return; end if;
    -- PostgreSQL accepts both legacy 12-hour and 24-hour TEXT clock values.
    if clock_value is null then
      begin clock_value:=nullif(btrim(r.clock),'')::time;
      exception when invalid_datetime_format or datetime_field_overflow then return; end;
    end if;
    if clock_value is null then return; end if;
    required_period:=required_period * tstzmultirange(tstzrange((r.work_date+clock_value) at time zone 'Asia/Manila',null,'[)'));
  end if;
  -- Open and completed events cannot explain any future portion of a workday.
  required_period:=required_period * tstzmultirange(tstzrange(null,now(),'[)'));
  return next;
end $$;

create or replace function public.reconcile_main_service_day(p_employee uuid,p_date date,p_exclude uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare
  r record; target record; a public.main_daily_attendance%rowtype;
  coverage tstzmultirange; office tstzmultirange; missing tstzmultirange;
  owner_id uuid; row_key jsonb; tracked boolean; manual_exists boolean; source_active boolean;
  covered boolean; should_restore boolean; old_guard text; old_service_guard text;
  base_out time; base_at timestamptz; checkout_at timestamptz; checkout_event uuid; shift_end time;
  legacy record; legacy_id text; baseline_minutes integer; remaining_minutes integer; partial_coverage boolean;
begin
  if p_employee is null or p_date is null or not exists(select 1 from public.employees e
    where e.id=p_employee and e.workspace='WAIS' and e.hr_scope='MAIN') then return; end if;
  perform public.lock_undertime_identity('WAIS',p_employee,p_date);
  old_guard:=current_setting('watts.main_service_reconcile',true);
  old_service_guard:=current_setting('watts.service_reconcile',true);
  perform set_config('watts.main_service_reconcile','1',true);
  perform set_config('watts.service_reconcile','1',true);
  coverage:=public.main_service_coverage(p_employee,p_date,p_exclude);
  office:=public.main_service_office_coverage(p_employee,p_date);
  select * into a from public.main_daily_attendance d where d.workspace='WAIS'
    and d.employee_id=p_employee and d.work_date=p_date and not d.is_deleted for update;

  -- 042/043 sometimes returned NULL from BEFORE INSERT: no attendance row was
  -- saved. Only a legacy suppression ledger is authority to recover that row.
  -- Never infer a missing row from Service membership alone.
  for legacy in select f.* from public.service_event_effects f
    join public.service_events e on e.id=f.service_event_id and e.workspace='WAIS'
    where f.employee_id=p_employee and f.work_date=p_date and f.applied
      and f.generated_records='[]'::jsonb and (f.suppressed_absence or f.suppressed_undertime)
  loop
    if legacy.suppressed_absence then
      select x.id::text into legacy_id from public.absences x where x.workspace='WAIS' and x.employee_id=p_employee
        and x.work_date=p_date and x.source_type='system_generated' and x.is_deleted
        and x.deleted_reason='Service covered the work date' and not coalesce(x.removed_from_recycle_bin,false)
        order by x.deleted_at desc nulls last limit 1;
      if legacy_id is null and p_date<=(now() at time zone 'Asia/Manila')::date
        and (a.id is null or (a.first_in is null and a.last_out is null))
        and not exists(select 1 from public.absences x where x.workspace='WAIS' and x.employee_id=p_employee and x.work_date=p_date)
        and not exists(select 1 from public.main_daily_attendance d where d.workspace='WAIS' and d.employee_id=p_employee and d.work_date=p_date and d.is_deleted) then
        insert into public.absences(workspace,employee_id,employee_name,work_date,reason,informed_to,source_type,source_attendance_date,is_deleted,deleted_at,deleted_reason)
          select 'WAIS',e.id,e.full_name,p_date,'No biometric attendance record','{}','system_generated',p_date,true,now(),'WAIS Service attendance coverage'
          from public.employees e where e.id=p_employee and e.workspace='WAIS' and e.hr_scope='MAIN'
            and not e.is_deleted and e.employment_status='active' and (e.start_date is null or e.start_date<=p_date)
          returning id::text into legacy_id;
      end if;
      if legacy_id is not null then
        update public.absences set deleted_reason='WAIS Service attendance coverage' where id::text=legacy_id;
        update public.service_event_effects set generated_records=generated_records||jsonb_build_array(jsonb_build_object('type','absence','id',legacy_id))
          where service_event_id=legacy.service_event_id and employee_id=p_employee and work_date=p_date;
      end if;
    end if;
    if legacy.suppressed_undertime then
      select x.id::text into legacy_id from public.generated_undertimes x where x.workspace='WAIS' and x.employee_id=p_employee
        and x.work_date=p_date and x.is_deleted and x.deleted_reason='Completed service supplied final checkout'
        and not coalesce(x.removed_from_recycle_bin,false) order by x.deleted_at desc nulls last limit 1;
      base_out:=coalesce(a.biometric_last_out,(a.biometric_last_out_at at time zone 'Asia/Manila')::time);
      shift_end:=case when extract(dow from p_date)=6 then time '15:15' else time '17:00' end;
      if legacy_id is null and a.id is not null and base_out<shift_end and (a.first_in is null or base_out>=a.first_in)
        and not exists(select 1 from public.generated_undertimes x where x.workspace='WAIS' and x.employee_id=p_employee and x.work_date=p_date)
        and not exists(select 1 from public.manual_undertimes x where x.workspace='WAIS' and x.employee_id=p_employee and x.work_date=p_date and not x.is_deleted) then
        insert into public.generated_undertimes(workspace,employee_id,employee_name,work_date,time_in,minutes_undertime,source_file_id,source_file_name,is_deleted,deleted_at,deleted_reason)
          values('WAIS',p_employee,a.employee_name,p_date,base_out::text,greatest(0,(extract(epoch from (shift_end-base_out))/60)::integer),a.source_file_id::text,a.source_file_name,true,now(),'WAIS Service attendance coverage')
          returning id::text into legacy_id;
      end if;
      if legacy_id is not null then
        update public.generated_undertimes set deleted_reason='WAIS Service attendance coverage' where id::text=legacy_id;
        update public.service_event_effects set generated_records=generated_records||jsonb_build_array(jsonb_build_object('type','undertime','id',legacy_id))
          where service_event_id=legacy.service_event_id and employee_id=p_employee and work_date=p_date;
      end if;
    end if;
  end loop;

  -- Retain ledger history even when coverage moves to another Service.
  update public.service_event_effects f set applied=false,rolled_back_at=now(),
    checkout_applied=false,suppressed_absence=false,suppressed_half_day=false,suppressed_undertime=false
    where f.employee_id=p_employee and f.work_date=p_date and f.applied
      and exists(select 1 from public.service_events e where e.id=f.service_event_id and e.workspace='WAIS');

  for r in
    select 'absence'::text kind,'absences'::text tab,x.id::text id,to_jsonb(x) data from public.absences x
      where x.workspace='WAIS' and x.employee_id=p_employee and x.work_date=p_date and x.source_type='system_generated'
    union all
    select 'half_day','half_day_records',x.id::text,to_jsonb(x) from public.half_day_records x
      where x.workspace='WAIS' and x.employee_id=p_employee and x.work_date=p_date and x.source_type in ('attendance_upload','system_generated')
    union all
    select 'undertime','generated_undertimes',x.id::text,to_jsonb(x) from public.generated_undertimes x
      where x.workspace='WAIS' and x.employee_id=p_employee and x.work_date=p_date
  loop
    row_key:=jsonb_build_object('type',r.kind,'id',r.id);
    tracked:=exists(select 1 from public.service_event_effects f where f.employee_id=p_employee and f.work_date=p_date
      and f.generated_records @> jsonb_build_array(row_key));
    if (r.data->>'is_deleted')::boolean and
       (not tracked or r.data->>'deleted_reason' is distinct from 'WAIS Service attendance coverage'
        or coalesce((r.data->>'removed_from_recycle_bin')::boolean,false)) then continue; end if;
    select * into target from public.main_service_attendance_target(r.kind,r.id);
    if target.employee_id is null then continue; end if;
    missing:=target.required_period-office;
    manual_exists:=case r.kind
      when 'absence' then exists(select 1 from public.absences m where m.workspace='WAIS' and m.employee_id=p_employee and m.work_date=p_date and m.source_type='manual' and not m.is_deleted)
      when 'half_day' then exists(select 1 from public.half_day_records m where m.workspace='WAIS' and m.employee_id=p_employee and m.work_date=p_date and m.absent_period=r.data->>'absent_period' and m.source_type='manual' and not m.is_deleted)
      else exists(select 1 from public.manual_undertimes m where m.workspace='WAIS' and m.employee_id=p_employee and m.work_date=p_date and not m.is_deleted) end;
    source_active:=not exists(select 1 from public.main_daily_attendance d where d.workspace='WAIS'
      and d.employee_id=p_employee and d.work_date=p_date and d.is_deleted)
      and (nullif(r.data->>'source_file_id','') is null or exists(select 1 from public.uploaded_files u
        where u.id::text=r.data->>'source_file_id' and u.workspace='WAIS' and not u.is_deleted));
    covered:=not manual_exists and source_active and missing<>'{}'::tstzmultirange and missing<@coverage;
    partial_coverage:=r.kind='undertime' and not manual_exists and source_active
      and missing && coverage and not covered;
    if r.kind='undertime' and not manual_exists and source_active and (tracked or missing && coverage) then
      select (j->>'original_minutes')::integer into baseline_minutes from public.service_event_effects f
        cross join lateral jsonb_array_elements(f.generated_records) j
        where f.employee_id=p_employee and f.work_date=p_date and j @> row_key
          and j ? 'original_minutes' limit 1;
      baseline_minutes:=coalesce(baseline_minutes,(r.data->>'minutes_undertime')::integer);
      base_out:=case when a.checkout_source='manual' then a.last_out else coalesce(a.biometric_last_out,
        (a.biometric_last_out_at at time zone 'Asia/Manila')::time,case when a.checkout_source='biometric' then a.last_out end) end;
      if base_out is not null then
        baseline_minutes:=greatest(0,(extract(epoch from ((case when extract(dow from p_date)=6 then time '15:15' else time '17:00' end)-base_out))/60)::integer);
      end if;
      row_key:=row_key||jsonb_build_object('original_minutes',baseline_minutes);
      if missing && coverage then
        select coalesce(sum(extract(epoch from (upper(v)-lower(v)))/60),0)::integer into remaining_minutes from unnest(missing-coverage) v;
      else remaining_minutes:=baseline_minutes;
      end if;
      update public.generated_undertimes set minutes_undertime=remaining_minutes where id::text=r.id;
    end if;
    if covered or partial_coverage then
      select e.id into owner_id from public.service_events e
      join public.service_event_employees l on l.service_event_id=e.id and l.workspace='WAIS' and l.employee_id=p_employee
      where e.workspace='WAIS' and not e.is_deleted and e.status in ('in_service','completed')
        and e.id is distinct from p_exclude and e.service_start<least(coalesce(e.service_end,now()),now())
        and tstzmultirange(tstzrange(e.service_start,least(coalesce(e.service_end,now()),now()),'[)')) && missing
      order by e.service_start,e.id limit 1;
      if owner_id is null then continue; end if;
      -- Dynamic table names come exclusively from the three literals above.
      if covered and not (r.data->>'is_deleted')::boolean then
        execute format('update public.%I set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason=$1 where id::text=$2',r.tab)
          using 'WAIS Service attendance coverage',r.id;
        insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload)
          values('WAIS',auth.uid(),r.tab,r.id,'service_suppress',jsonb_build_object('service_event_id',owner_id,'work_date',p_date));
      end if;
      insert into public.service_event_effects(service_event_id,employee_id,work_date,attendance_id,generated_records,
        suppressed_absence,suppressed_half_day,suppressed_undertime,applied,rolled_back_at)
      values(owner_id,p_employee,p_date,a.id,jsonb_build_array(row_key),r.kind='absence',r.kind='half_day',r.kind='undertime' and covered,true,null)
      on conflict(service_event_id,employee_id,work_date) do update set
        attendance_id=excluded.attendance_id,applied=true,rolled_back_at=null,
        suppressed_absence=public.service_event_effects.suppressed_absence or excluded.suppressed_absence,
        suppressed_half_day=public.service_event_effects.suppressed_half_day or excluded.suppressed_half_day,
        suppressed_undertime=public.service_event_effects.suppressed_undertime or excluded.suppressed_undertime,
        generated_records=case when public.service_event_effects.generated_records @> excluded.generated_records
          then public.service_event_effects.generated_records else public.service_event_effects.generated_records||excluded.generated_records end;
    end if;
    if not covered and tracked and (r.data->>'is_deleted')::boolean then
      should_restore:=not manual_exists and source_active and missing<>'{}'::tstzmultirange;
      if r.kind='absence' and a.id is not null and (a.first_in is not null or a.last_out is not null) then should_restore:=false; end if;
      -- Never resurrect an obsolete duplicate, a manually deleted row, or a row
      -- whose upload was deleted. Restores update the original identity only.
      if should_restore then
        if r.kind='half_day' then
          should_restore:=not exists(select 1 from public.half_day_records h where h.workspace='WAIS' and h.employee_id=p_employee and h.work_date=p_date and h.absent_period=r.data->>'absent_period' and not h.is_deleted);
        else
          execute format('select not exists(select 1 from public.%I where workspace=''WAIS'' and employee_id=$1 and work_date=$2 and not is_deleted)',r.tab)
            into should_restore using p_employee,p_date;
        end if;
      end if;
      if should_restore then
        execute format('update public.%I set is_deleted=false,deleted_at=null,deleted_by=null,deleted_reason=null where id::text=$1',r.tab) using r.id;
        insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload)
          values('WAIS',auth.uid(),r.tab,r.id,'service_restore',jsonb_build_object('work_date',p_date));
      end if;
    end if;
  end loop;

  -- Effective checkout uses an actual completed Service end, never now() or a
  -- fabricated end for an open Service. Manual checkout and raw punches win.
  if a.id is not null and a.checkout_source is distinct from 'manual' then
    base_out:=coalesce(a.biometric_last_out,(a.biometric_last_out_at at time zone 'Asia/Manila')::time,
      case when a.checkout_source='biometric' then a.last_out end);
    base_at:=(p_date+base_out) at time zone 'Asia/Manila';
    shift_end:=case when extract(dow from p_date)=6 then time '15:15' else time '17:00' end;
    select e.service_end,e.id into checkout_at,checkout_event from public.service_events e
      join public.service_event_employees l on l.service_event_id=e.id and l.workspace='WAIS' and l.employee_id=p_employee
      where e.workspace='WAIS' and not e.is_deleted and e.status='completed' and e.id is distinct from p_exclude
        and e.service_end<=now() and e.service_end>coalesce(base_at,(p_date+a.first_in) at time zone 'Asia/Manila')
        and e.service_start<((p_date+shift_end) at time zone 'Asia/Manila')
        and e.service_end>(p_date::timestamp at time zone 'Asia/Manila')
        and (public.main_service_work_period(p_date) * tstzmultirange(tstzrange(
          coalesce(base_at,(p_date+a.first_in) at time zone 'Asia/Manila'),e.service_end,'[)'))) <@ coverage
        and (base_out is null or a.first_in is null or base_out>=a.first_in)
      order by e.service_end desc,e.id limit 1;
    if checkout_event is not null then
      update public.main_daily_attendance set effective_last_out_at=checkout_at,
        last_out=(checkout_at at time zone 'Asia/Manila')::time,checkout_source='service',service_event_id=checkout_event,
        status='complete',undertime_minutes=case when checkout_at>=(p_date+shift_end) at time zone 'Asia/Manila' then 0
          else greatest(0,(extract(epoch from ((p_date+shift_end) at time zone 'Asia/Manila'-checkout_at))/60)::integer) end,
        updated_at=now() where id=a.id;
      insert into public.service_event_effects(service_event_id,employee_id,work_date,attendance_id,checkout_applied,applied)
        values(checkout_event,p_employee,p_date,a.id,true,true)
        on conflict(service_event_id,employee_id,work_date) do update set checkout_applied=true,applied=true,rolled_back_at=null;
    elsif a.checkout_source='service' then
      update public.main_daily_attendance set effective_last_out_at=base_at,last_out=base_out,
        checkout_source=case when base_out is null then null else 'biometric' end,service_event_id=null,
        status=case when base_out is null or base_out<a.first_in then 'missing_checkout' else 'complete' end,
        undertime_minutes=case when base_out is null or base_out<a.first_in then 0 else greatest(0,(extract(epoch from (shift_end-base_out))/60)::integer) end,
        updated_at=now() where id=a.id;
    end if;
  end if;
  perform set_config('watts.main_service_reconcile',coalesce(old_guard,''),true);
  perform set_config('watts.service_reconcile',coalesce(old_service_guard,''),true);
end $$;

create or replace function public.reconcile_main_service_attendance(p_event_id uuid,p_apply boolean)
returns void language plpgsql security definer set search_path='' as $$
declare d record;
begin
  if not exists(select 1 from public.service_events e where e.id=p_event_id and e.workspace='WAIS') then return; end if;
  -- Include old ledger dates/members after a shortening or employee removal.
  -- Only existing attendance dates are evaluated: no fabricated future records.
  for d in
    select f.employee_id,f.work_date from public.service_event_effects f where f.service_event_id=p_event_id
    union
    select l.employee_id,x.work_date from public.service_event_employees l
      cross join lateral (
        select a.work_date from public.absences a where a.workspace='WAIS' and a.employee_id=l.employee_id
        union select h.work_date from public.half_day_records h where h.workspace='WAIS' and h.employee_id=l.employee_id
        union select u.work_date from public.generated_undertimes u where u.workspace='WAIS' and u.employee_id=l.employee_id
        union select a.work_date from public.main_daily_attendance a where a.workspace='WAIS' and a.employee_id=l.employee_id
      ) x where l.service_event_id=p_event_id and l.workspace='WAIS'
    order by employee_id,work_date
  loop
    perform public.reconcile_main_service_day(d.employee_id,d.work_date,case when p_apply then null else p_event_id end);
  end loop;
end $$;

-- Replace the old BEFORE INSERT filters (which discarded row identity) with
-- AFTER triggers. Inserts retain an auditable row even when immediately hidden.
drop trigger if exists trg_service_generated_absence on public.absences;
drop trigger if exists trg_service_generated_undertime on public.generated_undertimes;
create or replace function public.reconcile_main_service_attendance_row()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.workspace='WAIS' and new.employee_id is not null
     and current_setting('watts.main_service_reconcile',true) is distinct from '1' then
    perform public.reconcile_main_service_day(new.employee_id,new.work_date);
  end if;
  return new;
end $$;
create trigger trg_main_service_absence after insert or update on public.absences
  for each row when (new.workspace='WAIS' and new.source_type='system_generated') execute function public.reconcile_main_service_attendance_row();
create trigger trg_main_service_half_day after insert or update on public.half_day_records
  for each row when (new.workspace='WAIS' and new.source_type in ('attendance_upload','system_generated')) execute function public.reconcile_main_service_attendance_row();
create trigger trg_main_service_undertime after insert or update on public.generated_undertimes
  for each row when (new.workspace='WAIS') execute function public.reconcile_main_service_attendance_row();

-- Deferred triggers see final membership after update_service_event replaces
-- links. Existing APP event/membership triggers and RPC branches are unchanged.
create or replace function public.main_service_final_state()
returns trigger language plpgsql security definer set search_path='' as $$
declare event_id uuid; event_workspace text;
begin
  if tg_table_name='service_events' then event_id:=new.id; event_workspace:=new.workspace;
  elsif tg_op='DELETE' then event_id:=old.service_event_id; event_workspace:=old.workspace;
  else event_id:=new.service_event_id; event_workspace:=new.workspace; end if;
  if event_workspace='WAIS' then perform public.reconcile_main_service_attendance(event_id,true); end if;
  return null;
end $$;
create constraint trigger trg_main_service_final_event after insert or update on public.service_events
  deferrable initially deferred for each row execute function public.main_service_final_state();
create constraint trigger trg_main_service_final_membership after insert or update or delete on public.service_event_employees
  deferrable initially deferred for each row execute function public.main_service_final_state();

create or replace function public.list_eligible_main_services(p_record_type text,p_record_id text)
returns setof public.service_events language plpgsql stable security definer set search_path='' as $$
declare t record; missing tstzmultirange; active_row boolean;
begin
  perform public.service_require_hr('WAIS');
  select * into t from public.main_service_attendance_target(p_record_type,p_record_id);
  if t.employee_id is null then raise exception 'Generated MAIN attendance record not found'; end if;
  if p_record_type not in ('absence','half_day','undertime') then raise exception 'Invalid attendance type'; end if;
  execute format('select not is_deleted from public.%I where id::text=$1',case p_record_type when 'absence' then 'absences' when 'half_day' then 'half_day_records' else 'generated_undertimes' end)
    into active_row using p_record_id;
  if active_row is distinct from true then raise exception 'Generated MAIN attendance record is no longer active'; end if;
  missing:=t.required_period-public.main_service_office_coverage(t.employee_id,t.work_date);
  if missing='{}'::tstzmultirange then return; end if;
  return query select e.* from public.service_events e
    where e.workspace='WAIS' and not e.is_deleted and e.status in ('in_service','completed')
      and e.service_start<least(coalesce(e.service_end,now()),now())
      and tstzmultirange(tstzrange(e.service_start,least(coalesce(e.service_end,now()),now()),'[)')) && missing
      and missing <@ public.main_service_coverage(t.employee_id,t.work_date,null,e.id)
      and not exists(select 1 from public.service_events other join public.service_event_employees l on l.service_event_id=other.id
        where l.employee_id=t.employee_id and other.id<>e.id and not other.is_deleted and other.status in ('in_service','completed')
          and other.service_start<coalesce(e.service_end,'infinity'::timestamptz)
          and coalesce(other.service_end,'infinity'::timestamptz)>e.service_start
          and not exists(select 1 from public.service_event_employees own where own.service_event_id=e.id and own.employee_id=t.employee_id and own.workspace='WAIS'))
    order by e.service_start,e.service_ref;
end $$;

create or replace function public.move_main_generated_attendance_to_service(p_record_type text,p_record_id text,p_service_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare t record; e public.service_events%rowtype; still_active boolean; table_name text;
begin
  perform public.service_require_hr('WAIS');
  select * into t from public.main_service_attendance_target(p_record_type,p_record_id);
  if t.employee_id is null then raise exception 'Generated MAIN attendance record not found'; end if;
  perform public.service_validate_employees('WAIS',array[t.employee_id]);
  select * into e from public.service_events s where s.id=p_service_id and s.workspace='WAIS' and not s.is_deleted for update;
  if e.id is null then raise exception 'Eligible WAIS Service record not found'; end if;
  perform public.service_validate_overlap(e.id,array[t.employee_id],e.service_start,e.service_end);
  perform public.lock_undertime_identity('WAIS',t.employee_id,t.work_date);
  if not exists(select 1 from public.list_eligible_main_services(p_record_type,p_record_id) s where s.id=e.id) then
    raise exception 'Selected Service does not cover this attendance record'; end if;
  insert into public.service_event_employees(service_event_id,employee_id,workspace)
    values(e.id,t.employee_id,'WAIS') on conflict(service_event_id,employee_id) do nothing;
  perform public.reconcile_main_service_attendance(e.id,true);
  table_name:=case p_record_type when 'absence' then 'absences' when 'half_day' then 'half_day_records' else 'generated_undertimes' end;
  execute format('select not is_deleted from public.%I where id::text=$1',table_name) into still_active using p_record_id;
  if still_active is distinct from false then raise exception 'Attendance could not be reconciled; no membership changes were saved'; end if;
  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload)
    values('WAIS',auth.uid(),table_name,p_record_id,'move_to_service',jsonb_build_object('service_event_id',e.id,'employee_id',t.employee_id));
end $$;

create or replace function public.refresh_main_service_attendance()
returns void language plpgsql security definer set search_path='' as $$
declare event_id uuid;
begin
  perform public.service_require_hr('WAIS');
  for event_id in select e.id from public.service_events e where e.workspace='WAIS'
    and ((not e.is_deleted and e.status in ('in_service','completed')) or exists(select 1 from public.service_event_effects f where f.service_event_id=e.id and f.applied))
    order by e.id loop perform public.reconcile_main_service_attendance(event_id,true); end loop;
end $$;

revoke all on function public.main_service_work_period(date,text),public.main_service_coverage(uuid,date,uuid,uuid),
  public.main_service_office_coverage(uuid,date),public.main_service_attendance_target(text,text),
  public.reconcile_main_service_day(uuid,date,uuid),public.reconcile_main_service_attendance(uuid,boolean),
  public.reconcile_main_service_attendance_row(),public.main_service_final_state() from public,anon,authenticated;
revoke all on function public.list_eligible_main_services(text,text),public.move_main_generated_attendance_to_service(text,text,uuid),
  public.refresh_main_service_attendance() from public,anon;
grant execute on function public.list_eligible_main_services(text,text),public.move_main_generated_attendance_to_service(text,text,uuid),
  public.refresh_main_service_attendance() to authenticated;

commit;
