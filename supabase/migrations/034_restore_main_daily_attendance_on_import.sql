-- Restore canonical MAIN daily rows when a previously deleted employee/date is re-imported.
-- Forward-only; do not apply automatically. Requires migrations through 033.
begin;

create or replace function public.import_main_attendance(p_file_name text,p_records jsonb,p_roster jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r jsonb; d date; e public.employees%rowtype; file_id public.uploaded_files.id%type; daily_id uuid; first_time time; last_time time;
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
      insert into public.main_daily_attendance(
        workspace,employee_id,employee_name,raw_name,device_no,work_date,first_in,last_out,
        biometric_last_out,checkout_source,status,late_minutes,late_seconds,is_half_day,
        undertime_minutes,source_file_name
      ) values(
        'WAIS',e.id,coalesce(e.attendance_name,e.full_name),r->>'rawName',nullif(r->>'deviceNo',''),d,
        first_time,last_time,last_time,nullif(r->>'checkoutSource',''),r->>'status',
        coalesce((r->>'lateMinutes')::int,0),coalesce((r->>'lateSeconds')::int,0),
        coalesce((r->>'halfDay')::boolean,false),coalesce((r->>'undertimeMinutes')::int,0),p_file_name
      )
      on conflict(employee_id,work_date) where employee_id is not null do update set
        employee_name=excluded.employee_name,raw_name=excluded.raw_name,device_no=excluded.device_no,
        first_in=excluded.first_in,biometric_last_out=excluded.biometric_last_out,
        last_out=case when public.main_daily_attendance.checkout_source='manual' then public.main_daily_attendance.last_out else excluded.last_out end,
        checkout_source=case when public.main_daily_attendance.checkout_source='manual' then 'manual' else excluded.checkout_source end,
        status=case when public.main_daily_attendance.checkout_source='manual' then 'complete' else excluded.status end,
        late_minutes=excluded.late_minutes,late_seconds=excluded.late_seconds,is_half_day=excluded.is_half_day,
        undertime_minutes=case when public.main_daily_attendance.checkout_source='manual' then public.main_daily_attendance.undertime_minutes else excluded.undertime_minutes end,
        source_file_name=excluded.source_file_name,source_file_id=excluded.source_file_id,
        is_deleted=false,deleted_at=null,deleted_by=null,deleted_batch_id=null,updated_at=now()
      returning id into daily_id;
    else
      insert into public.main_daily_attendance(
        workspace,employee_id,employee_name,raw_name,device_no,work_date,first_in,last_out,
        biometric_last_out,checkout_source,status,late_minutes,late_seconds,is_half_day,
        undertime_minutes,source_file_name
      ) values(
        'WAIS',null,r->>'employeeName',r->>'rawName',nullif(r->>'deviceNo',''),d,
        first_time,last_time,last_time,nullif(r->>'checkoutSource',''),'unmatched_employee',0,0,false,0,p_file_name
      )
      on conflict(workspace,raw_name,work_date) where employee_id is null do update set
        device_no=excluded.device_no,first_in=excluded.first_in,last_out=excluded.last_out,
        biometric_last_out=excluded.biometric_last_out,checkout_source=excluded.checkout_source,
        status='unmatched_employee',source_file_name=excluded.source_file_name,
        source_file_id=excluded.source_file_id,is_deleted=false,deleted_at=null,deleted_by=null,
        deleted_batch_id=null,updated_at=now()
      returning id into daily_id;
    end if;

    if e.id is not null then
      update public.late_records set is_deleted=true,deleted_at=now(),deleted_reason='MAIN attendance re-imported'
      where workspace='WAIS' and work_date=d and public.employee_name_key(employee_name)=public.employee_name_key(e.full_name) and not is_deleted;
      update public.generated_undertimes set is_deleted=true,deleted_at=now(),deleted_reason='MAIN attendance re-imported'
      where workspace='WAIS' and work_date=d and public.employee_name_key(employee_name)=public.employee_name_key(e.full_name) and not is_deleted;
      if coalesce((r->>'lateMinutes')::int,0)>0 then
        insert into public.late_records(workspace,employee_name,work_date,time_in,minutes_late,seconds_late,total_seconds_late,source_file_id,source_file_name)
        values('WAIS',coalesce(e.attendance_name,e.full_name),d,first_time,coalesce((r->>'lateMinutes')::int,0),coalesce((r->>'lateSeconds')::int,0),coalesce((r->>'lateMinutes')::int,0)*60+coalesce((r->>'lateSeconds')::int,0),file_id,p_file_name);
      end if;
      update public.half_day_records set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='MAIN attendance re-imported',removed_from_recycle_bin=false
      where workspace='WAIS' and employee_id=e.id and work_date=d and source_type='attendance_upload' and not is_deleted;
      if coalesce((r->>'halfDay')::boolean,false)
         and not exists(select 1 from public.half_day_records where employee_id=e.id and work_date=d and absent_period='morning' and source_type='manual') then
        insert into public.half_day_records(workspace,employee_id,employee_name,work_date,absent_period,scheduled_start,scheduled_end,reason,created_by,source_type,source_file_name,source_file_id,source_time_in)
        values('WAIS',e.id,coalesce(e.attendance_name,e.full_name),d,'morning',case when extract(dow from d)=6 then time '07:00' else time '08:00' end,case when extract(dow from d)=6 then time '11:00' else time '12:00' end,'Generated from MAIN attendance first C/In',auth.uid(),'attendance_upload',p_file_name,file_id,first_time)
        on conflict(employee_id,work_date,absent_period) do update set employee_name=excluded.employee_name,source_type='attendance_upload',source_file_name=excluded.source_file_name,source_file_id=excluded.source_file_id,source_time_in=excluded.source_time_in,is_deleted=false,restored_at=now(),restored_by=auth.uid();
      end if;
      if last_time is not null and coalesce((r->>'undertimeMinutes')::int,0)>0 then
        insert into public.generated_undertimes(workspace,employee_name,work_date,time_in,minutes_undertime,source_file_id,source_file_name)
        values('WAIS',coalesce(e.attendance_name,e.full_name),d,last_time,coalesce((r->>'undertimeMinutes')::int,0),file_id,p_file_name);
      end if;
      update public.absences set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='Corrected MAIN attendance import'
      where employee_id=e.id and work_date=d and source_type='system_generated' and not is_deleted;
    end if;
  end loop;

  for d in select distinct (value->>'workDate')::date from jsonb_array_elements(p_records) loop
    insert into public.absences(workspace,employee_id,employee_name,work_date,reason,informed_to,source_type,source_attendance_date,source_file_id)
    select 'WAIS',e2.id,e2.full_name,d,'No biometric attendance record','{}','system_generated',d,file_id
    from public.employees e2
    where e2.hr_scope='MAIN' and e2.workspace='WAIS' and e2.employment_status='active' and not e2.is_deleted and (e2.start_date is null or e2.start_date<=d)
      and not exists(select 1 from public.main_daily_attendance a where a.employee_id=e2.id and a.work_date=d and not a.is_deleted and (a.first_in is not null or a.last_out is not null))
      and not exists(select 1 from public.absences a where a.employee_id=e2.id and a.work_date=d and not a.is_deleted);
  end loop;
end $$;

-- Repair canonical rows already refreshed by an active upload but left soft-deleted
-- by the previous conflict-update path.
update public.main_daily_attendance d
set is_deleted=false,deleted_at=null,deleted_by=null,deleted_batch_id=null,
    source_file_id=f.id,updated_at=now()
from public.uploaded_files f
where d.workspace='WAIS' and d.is_deleted
  and f.workspace='WAIS' and not f.is_deleted
  and (f.id=d.source_file_id or f.file_name=d.source_file_name);

insert into public.main_attendance_sources(daily_attendance_id,source_file_id)
select d.id,d.source_file_id from public.main_daily_attendance d
where d.workspace='WAIS' and not d.is_deleted and d.source_file_id is not null
on conflict(daily_attendance_id,source_file_id) do nothing;

revoke all on function public.import_main_attendance(text,jsonb,jsonb) from public,anon;
grant execute on function public.import_main_attendance(text,jsonb,jsonb) to authenticated;

commit;
