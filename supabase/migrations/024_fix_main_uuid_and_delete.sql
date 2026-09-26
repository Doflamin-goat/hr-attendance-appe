-- Fix legacy text source-file comparisons in the MAIN reconciliation and delete RPCs.
-- FORWARD-ONLY; DO NOT APPLY AUTOMATICALLY. Requires migration 023.
begin;

create or replace function public.delete_main_attendance_upload(p_file_id uuid,p_batch_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.attendance_role()<>'HR' or public.attendance_hr_scope()<>'MAIN' then raise exception 'MAIN HR access required'; end if;
 if not exists(select 1 from public.uploaded_files where id=p_file_id and workspace='WAIS' and not is_deleted) then raise exception 'Active MAIN upload not found'; end if;
 update public.main_daily_attendance d set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id
 where not d.is_deleted and (d.source_file_id=p_file_id or exists(select 1 from public.main_attendance_sources s where s.daily_attendance_id=d.id and s.source_file_id=p_file_id))
 and not exists(select 1 from public.main_attendance_sources keep where keep.daily_attendance_id=d.id and keep.source_file_id<>p_file_id and exists(select 1 from public.uploaded_files f where f.id=keep.source_file_id and not f.is_deleted));
 update public.late_records set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id,deleted_reason='uploaded_file_deleted' where source_file_id=p_file_id::text and not is_deleted;
 update public.generated_undertimes set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id,deleted_reason='uploaded_file_deleted' where source_file_id=p_file_id::text and not is_deleted;
 update public.half_day_records set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id,deleted_reason='uploaded_file_deleted' where source_file_id=p_file_id and source_type='attendance_upload' and not is_deleted;
 update public.absences set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id,deleted_reason='uploaded_file_deleted' where source_file_id=p_file_id and source_type='system_generated' and not is_deleted;
 update public.uploaded_files set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id,deleted_reason='uploaded_file_deleted',removed_from_recycle_bin=false where id=p_file_id and workspace='WAIS' and not is_deleted;
 if not found then raise exception 'MAIN upload could not be moved to Trash'; end if;
end $$;

create or replace function public.reconcile_main_unmatched_attendance()
returns integer language plpgsql security definer set search_path='' as $$
declare a public.main_daily_attendance%rowtype; e public.employees%rowtype; t public.main_daily_attendance%rowtype; target_id uuid; changed integer:=0; dow integer; minute_in integer; minute_out integer; start_min integer; grace_end integer; late_end integer; half_start integer; half_end integer; shift_end integer;
begin
 if auth.uid() is null or public.attendance_role()<>'HR' or public.attendance_hr_scope()<>'MAIN' then raise exception 'MAIN HR access required'; end if;
 for a in select * from public.main_daily_attendance where workspace='WAIS' and employee_id is null and not is_deleted order by work_date,created_at,id for update loop
   e=null;
   if a.device_no is not null then select emp.* into e from public.main_biometric_mappings m join public.employees emp on emp.id=m.employee_id where m.device_no=a.device_no and emp.hr_scope='MAIN' and not emp.is_deleted; end if;
   if e.id is null then select emp.* into e from public.main_biometric_aliases x join public.employees emp on emp.id=x.employee_id where x.normalized_alias=regexp_replace(regexp_replace(upper(a.raw_name),'[^A-Z0-9]+',' ','g'),'\s+',' ','g') and emp.hr_scope='MAIN' and not emp.is_deleted; end if;
   if e.id is null then select emp.* into e from public.employees emp where emp.hr_scope='MAIN' and not emp.is_deleted and regexp_replace(regexp_replace(upper(coalesce(emp.attendance_name,emp.full_name)),'[^A-Z0-9]+',' ','g'),'\s+',' ','g')=regexp_replace(regexp_replace(upper(a.raw_name),'[^A-Z0-9]+',' ','g'),'\s+',' ','g'); end if;
   if e.id is null then continue; end if;
   select id into target_id from public.main_daily_attendance where employee_id=e.id and work_date=a.work_date and not is_deleted order by created_at,id limit 1;
   if target_id is null then
     update public.main_daily_attendance set employee_id=e.id,employee_name=coalesce(e.attendance_name,e.full_name),status=case when last_out is null then 'missing_checkout' else 'complete' end,updated_at=now() where id=a.id;
     target_id=a.id;
   else
     update public.main_daily_attendance t set
       first_in=case when t.first_in is null then a.first_in when a.first_in is null then t.first_in else least(t.first_in,a.first_in) end,
       last_out=case when t.last_out is null then a.last_out when a.last_out is null then t.last_out else greatest(t.last_out,a.last_out) end,
       employee_name=coalesce(e.attendance_name,e.full_name),updated_at=now() where t.id=target_id;
     insert into public.main_attendance_sources(daily_attendance_id,source_file_id) select target_id,a.source_file_id where a.source_file_id is not null on conflict do nothing;
     update public.main_daily_attendance set is_deleted=true,deleted_at=now(),deleted_by=auth.uid() where id=a.id;
   end if;
   insert into public.main_attendance_sources(daily_attendance_id,source_file_id) select target_id,source_file_id from public.main_daily_attendance where id=target_id and source_file_id is not null on conflict do nothing;
   select * into t from public.main_daily_attendance where id=target_id;
   dow=extract(dow from t.work_date); minute_in=case when t.first_in is null then null else extract(hour from t.first_in)::int*60+extract(minute from t.first_in)::int end; minute_out=case when t.last_out is null then null else extract(hour from t.last_out)::int*60+extract(minute from t.last_out)::int end;
   if dow=6 then start_min=420;grace_end=425;late_end=479;half_start=651;half_end=660;shift_end=915; else start_min=480;grace_end=485;late_end=539;half_start=711;half_end=780;shift_end=1020; end if;
   update public.main_daily_attendance set status=case when last_out is null then 'missing_checkout' else 'complete' end,
     late_minutes=case when minute_in>grace_end and minute_in<=late_end then minute_in-start_min else 0 end,
     late_seconds=case when minute_in>grace_end and minute_in<=late_end then extract(second from first_in)::int else 0 end,
     is_half_day=coalesce(minute_in between half_start and half_end,false),
     undertime_minutes=case when minute_out is null then 0 else greatest(0,shift_end-minute_out) end where id=target_id returning * into t;
   update public.late_records set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='MAIN alias reconciliation' where source_file_id in(select source_file_id::text from public.main_attendance_sources where daily_attendance_id=target_id) and work_date=t.work_date and not is_deleted;
   update public.generated_undertimes set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='MAIN alias reconciliation' where source_file_id in(select source_file_id::text from public.main_attendance_sources where daily_attendance_id=target_id) and work_date=t.work_date and not is_deleted;
   update public.half_day_records set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='MAIN alias reconciliation' where employee_id=e.id and work_date=t.work_date and source_type='attendance_upload' and not is_deleted;
   if t.late_minutes>0 then insert into public.late_records(workspace,employee_name,work_date,time_in,minutes_late,seconds_late,total_seconds_late,source_file_id,source_file_name) values('WAIS',coalesce(e.attendance_name,e.full_name),t.work_date,t.first_in,t.late_minutes,t.late_seconds,t.late_minutes*60+t.late_seconds,t.source_file_id::text,t.source_file_name); end if;
   if t.undertime_minutes>0 and t.last_out is not null then insert into public.generated_undertimes(workspace,employee_name,work_date,time_in,minutes_undertime,source_file_id,source_file_name) values('WAIS',coalesce(e.attendance_name,e.full_name),t.work_date,t.last_out,t.undertime_minutes,t.source_file_id::text,t.source_file_name); end if;
   if t.is_half_day and not exists(select 1 from public.half_day_records where employee_id=e.id and work_date=t.work_date and absent_period='morning' and source_type='manual') then
     insert into public.half_day_records(workspace,employee_id,employee_name,work_date,absent_period,scheduled_start,scheduled_end,reason,created_by,source_type,source_file_name,source_file_id,source_time_in)
     values('WAIS',e.id,coalesce(e.attendance_name,e.full_name),t.work_date,'morning',case when dow=6 then time '07:00' else time '08:00' end,case when dow=6 then time '11:00' else time '12:00' end,'Generated from reconciled MAIN First In',auth.uid(),'attendance_upload',t.source_file_name,t.source_file_id,t.first_in)
     on conflict(employee_id,work_date,absent_period) do update set employee_name=excluded.employee_name,source_type='attendance_upload',source_file_name=excluded.source_file_name,source_file_id=excluded.source_file_id,source_time_in=excluded.source_time_in,is_deleted=false,restored_at=now(),restored_by=auth.uid();
   end if;
   update public.absences set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='MAIN alias reconciliation' where employee_id=e.id and work_date=t.work_date and source_type='system_generated' and not is_deleted;
   changed=changed+1;
 end loop;
 return changed;
end $$;

revoke all on function public.delete_main_attendance_upload(uuid,uuid),public.reconcile_main_unmatched_attendance() from public,anon;
grant execute on function public.delete_main_attendance_upload(uuid,uuid),public.reconcile_main_unmatched_attendance() to authenticated;

commit;
