-- Compatibility patch for the text-typed generated_undertimes.time_in column.
-- Migration 042 remains unchanged and must already be applied.
begin;

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
            and ((e.service_start at time zone 'Asia/Manila')::date<day_value or ((e.service_start at time zone 'Asia/Manila')::date=day_value and (e.service_start at time zone 'Asia/Manila')::time<=gu.time_in::time))
        ) then
          update public.generated_undertimes set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='Completed service supplied final checkout' where workspace='WAIS' and employee_id=link.employee_id and work_date=day_value and not is_deleted
            and public.service_work_window_overlaps(e.service_start,e.service_end,day_value)
            and ((coalesce(e.service_end,now()) at time zone 'Asia/Manila')::date>day_value or ((coalesce(e.service_end,now()) at time zone 'Asia/Manila')::date=day_value and (coalesce(e.service_end,now()) at time zone 'Asia/Manila')::time>=shift_end))
            and ((e.service_start at time zone 'Asia/Manila')::date<day_value or ((e.service_start at time zone 'Asia/Manila')::date=day_value and (e.service_start at time zone 'Asia/Manila')::time<=time_in::time));
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
      and ((e.service_start at time zone 'Asia/Manila')::date<new.work_date or ((e.service_start at time zone 'Asia/Manila')::date=new.work_date and (e.service_start at time zone 'Asia/Manila')::time<=new.time_in::time)) limit 1;
    if event_id is not null then
      select a.id into attendance_id from public.main_daily_attendance a where a.employee_id=new.employee_id and a.workspace='WAIS' and a.work_date=new.work_date and not a.is_deleted limit 1;
      insert into public.service_event_effects(service_event_id,employee_id,work_date,attendance_id,suppressed_undertime,applied) values(event_id,new.employee_id,new.work_date,attendance_id,true,true)
      on conflict(service_event_id,employee_id,work_date) do update set attendance_id=coalesce(excluded.attendance_id,public.service_event_effects.attendance_id),suppressed_undertime=true,applied=true,rolled_back_at=null;
      return null;
    end if;
  end if;
  return new;
end $$;

commit;
