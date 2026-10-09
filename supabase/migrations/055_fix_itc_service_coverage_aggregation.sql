-- Fix APP/ITC range_agg queries by resolving attendance endpoints before aggregation.
-- The clock parser and reversible effect model are provided by migration 054.
begin;

create or replace function public.reconcile_itc_service_attendance_053(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  event_row public.service_events%rowtype;
  service_employee record;
  half_day_row record;
  undertime_row record;
  effect_row record;
  supporting_service_id uuid;
  coverage_ok boolean;
  parsed_time time;
  affected_count integer := 0;
begin
  if auth.uid() is null
     or public.attendance_role() is distinct from 'HR'
     or public.attendance_workspace() is distinct from 'APP' then
    raise exception 'Only APP HR can reconcile ITC Service attendance';
  end if;

  select se.* into event_row
    from public.service_events se
   where se.id=p_event_id and se.workspace='APP'
   for update;
  if event_row.id is null then raise exception 'APP Service record not found'; end if;

  -- Reversal: resolve attendance clock values independently, then aggregate only
  -- valid Service intervals. Transfer the effect if remaining APP coverage holds.
  for effect_row in
    select e.* from public.itc_service_attendance_effects e
     where e.service_event_id=event_row.id and e.restored_at is null
     for update
  loop
    supporting_service_id:=null;
    if effect_row.half_day_id is not null then
      select coalesce(h.source_time_in,time '13:05:46') into parsed_time
        from public.half_day_records h
       where h.id=effect_row.half_day_id and h.workspace='APP'
         and h.source_type='attendance_upload' and h.absent_period='morning';
      if parsed_time is not null then
        select coalesce(range_agg(tstzrange(s.service_start,s.service_end+interval '10 minutes','[]')),'{}'::tstzmultirange)
                 @> tstzrange((effect_row.work_date+time '08:00') at time zone 'Asia/Manila',
                              (effect_row.work_date+parsed_time) at time zone 'Asia/Manila','[]')
          into coverage_ok
          from public.service_events s
          join public.service_event_employees m on m.service_event_id=s.id
            and m.employee_id=effect_row.employee_id and m.workspace='APP'
         where s.id<>event_row.id and s.workspace='APP'
           and s.status in ('in_service','completed') and not s.is_deleted and s.service_end is not null;
      else coverage_ok:=false;
      end if;
      if not coalesce(coverage_ok,false) then
        update public.half_day_records
           set is_deleted=false,deleted_at=null,deleted_by=null,deleted_reason=null
         where id=effect_row.half_day_id and workspace='APP' and is_deleted
           and deleted_reason='reconciled_by_itc_service';
      else
        select s.id into supporting_service_id
          from public.service_events s
          join public.service_event_employees m on m.service_event_id=s.id
            and m.employee_id=effect_row.employee_id and m.workspace='APP'
         where s.id<>event_row.id and s.workspace='APP'
           and s.status in ('in_service','completed') and not s.is_deleted
           and s.service_end is not null
           and s.service_start <= ((effect_row.work_date+parsed_time) at time zone 'Asia/Manila')
           and s.service_end+interval '10 minutes' >= ((effect_row.work_date+time '08:00') at time zone 'Asia/Manila')
         order by s.service_end desc limit 1;
        if supporting_service_id is not null and not exists(
          select 1 from public.itc_service_attendance_effects x
           where x.service_event_id=supporting_service_id
             and x.half_day_id=effect_row.half_day_id and x.restored_at is null
        ) then
          insert into public.itc_service_attendance_effects(service_event_id,employee_id,work_date,half_day_id)
          values(supporting_service_id,effect_row.employee_id,effect_row.work_date,effect_row.half_day_id);
        end if;
      end if;

    elsif effect_row.undertime_id is not null then
      select public.parse_itc_clock_time(u.time_in) into parsed_time
        from public.generated_undertimes u
       where u.id=effect_row.undertime_id and u.workspace='APP';
      if parsed_time is not null then
        select coalesce(range_agg(tstzrange(s.service_start,s.service_end+interval '10 minutes','[]')),'{}'::tstzmultirange)
                 @> tstzrange((effect_row.work_date+time '08:00') at time zone 'Asia/Manila',
                              (effect_row.work_date+parsed_time) at time zone 'Asia/Manila','[]')
          into coverage_ok
          from public.service_events s
          join public.service_event_employees m on m.service_event_id=s.id
            and m.employee_id=effect_row.employee_id and m.workspace='APP'
         where s.id<>event_row.id and s.workspace='APP'
           and s.status in ('in_service','completed') and not s.is_deleted and s.service_end is not null;
      else coverage_ok:=false;
      end if;
      if not coalesce(coverage_ok,false) then
        update public.generated_undertimes
           set is_deleted=false,deleted_at=null,deleted_by=null,deleted_reason=null
         where id=effect_row.undertime_id and workspace='APP' and is_deleted
           and deleted_reason='reconciled_by_itc_service';
      else
        select s.id into supporting_service_id
          from public.service_events s
          join public.service_event_employees m on m.service_event_id=s.id
            and m.employee_id=effect_row.employee_id and m.workspace='APP'
         where s.id<>event_row.id and s.workspace='APP'
           and s.status in ('in_service','completed') and not s.is_deleted and s.service_end is not null
           and s.service_start <= ((effect_row.work_date+time '23:59:59') at time zone 'Asia/Manila')
           and s.service_end+interval '10 minutes' >= ((effect_row.work_date+time '08:00') at time zone 'Asia/Manila')
         order by s.service_end desc limit 1;
        if supporting_service_id is not null and not exists(
          select 1 from public.itc_service_attendance_effects x
           where x.service_event_id=supporting_service_id
             and x.undertime_id=effect_row.undertime_id and x.restored_at is null
        ) then
          insert into public.itc_service_attendance_effects(service_event_id,employee_id,work_date,undertime_id)
          values(supporting_service_id,effect_row.employee_id,effect_row.work_date,effect_row.undertime_id);
        end if;
      end if;
    end if;
    update public.itc_service_attendance_effects set restored_at=now() where id=effect_row.id;
  end loop;

  if event_row.status not in ('in_service','completed') or event_row.is_deleted then return 0; end if;

  for service_employee in
    select m.employee_id from public.service_event_employees m
     where m.service_event_id=event_row.id and m.workspace='APP'
  loop
    -- Only upload-generated morning Half-Days are eligible; Manual rows are untouched.
    for half_day_row in
      select h.* from public.half_day_records h
       where h.workspace='APP' and h.employee_id=service_employee.employee_id
         and h.source_type='attendance_upload' and h.absent_period='morning' and not h.is_deleted
         and h.work_date between (event_row.service_start at time zone 'Asia/Manila')::date
           and coalesce((event_row.service_end at time zone 'Asia/Manila')::date,
                        (event_row.service_start at time zone 'Asia/Manila')::date)
         and event_row.service_end is not null
       for update
    loop
      parsed_time:=coalesce(half_day_row.source_time_in,time '13:05:46');
      select coalesce(range_agg(tstzrange(s.service_start,s.service_end+interval '10 minutes','[]')),'{}'::tstzmultirange)
               @> tstzrange((half_day_row.work_date+time '08:00') at time zone 'Asia/Manila',
                            (half_day_row.work_date+parsed_time) at time zone 'Asia/Manila','[]')
        into coverage_ok
        from public.service_events s
        join public.service_event_employees m on m.service_event_id=s.id
          and m.employee_id=service_employee.employee_id and m.workspace='APP'
       where s.workspace='APP' and s.status in ('in_service','completed')
         and not s.is_deleted and s.service_end is not null;
      if coalesce(coverage_ok,false) then
        update public.half_day_records
           set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='reconciled_by_itc_service'
         where id=half_day_row.id and workspace='APP' and not is_deleted;
        if found then
          insert into public.itc_service_attendance_effects(service_event_id,employee_id,work_date,half_day_id)
          values(event_row.id,service_employee.employee_id,half_day_row.work_date,half_day_row.id) on conflict do nothing;
          affected_count:=affected_count+1;
        end if;
      end if;
    end loop;

    for undertime_row in
      select u.* from public.generated_undertimes u
       where u.workspace='APP' and u.employee_id=service_employee.employee_id and not u.is_deleted
         and u.work_date between (event_row.service_start at time zone 'Asia/Manila')::date
           and coalesce((event_row.service_end at time zone 'Asia/Manila')::date,
                        (event_row.service_start at time zone 'Asia/Manila')::date)
         and event_row.service_end is not null
       for update
    loop
      parsed_time:=public.parse_itc_clock_time(undertime_row.time_in);
      if parsed_time is not null then
        select coalesce(range_agg(tstzrange(s.service_start,s.service_end+interval '10 minutes','[]')),'{}'::tstzmultirange)
                 @> tstzrange((undertime_row.work_date+time '08:00') at time zone 'Asia/Manila',
                              (undertime_row.work_date+parsed_time) at time zone 'Asia/Manila','[]')
          into coverage_ok
          from public.service_events s
          join public.service_event_employees m on m.service_event_id=s.id
            and m.employee_id=service_employee.employee_id and m.workspace='APP'
         where s.workspace='APP' and s.status in ('in_service','completed')
           and not s.is_deleted and s.service_end is not null;
        if coalesce(coverage_ok,false) then
          update public.generated_undertimes
             set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='reconciled_by_itc_service'
           where id=undertime_row.id and workspace='APP' and not is_deleted;
          if found then
            insert into public.itc_service_attendance_effects(service_event_id,employee_id,work_date,undertime_id)
            values(event_row.id,service_employee.employee_id,undertime_row.work_date,undertime_row.id) on conflict do nothing;
            affected_count:=affected_count+1;
          end if;
        end if;
      end if;
    end loop;
  end loop;

  return affected_count;
end;
$$;

revoke all on function public.reconcile_itc_service_attendance_053(uuid) from public,anon,authenticated;

commit;
