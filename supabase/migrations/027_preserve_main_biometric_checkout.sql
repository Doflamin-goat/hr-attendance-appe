-- Preserve MAIN biometric check-outs while allowing an effective manual final check-out.
-- FORWARD-ONLY. DO NOT APPLY AUTOMATICALLY. Requires migrations 020-026.
begin;

alter table public.main_daily_attendance
  add column if not exists biometric_last_out time;

create or replace function public.set_main_manual_checkout(p_record_id uuid,p_checkout_time time,p_note text default null)
returns void language plpgsql security definer set search_path='' as $$
declare
  a public.main_daily_attendance%rowtype;
  shift_end time;
  mins integer;
  file_id public.uploaded_files.id%type;
  original_biometric time;
  previous_effective time;
begin
  if auth.uid() is null or public.attendance_role()<>'HR' or public.attendance_hr_scope()<>'MAIN' then
    raise exception 'MAIN HR access required';
  end if;
  select * into a from public.main_daily_attendance
  where id=p_record_id and workspace='WAIS' and employee_id is not null
  for update;
  if a.id is null then raise exception 'MAIN attendance record not found'; end if;

  previous_effective := a.last_out;
  original_biometric := coalesce(
    a.biometric_last_out,
    case when a.checkout_source='biometric' then a.last_out else null end
  );
  shift_end=case when extract(dow from a.work_date)=6 then time '15:15' else time '17:00' end;
  mins=greatest(0,(extract(epoch from (shift_end-p_checkout_time))/60)::integer);

  update public.main_daily_attendance
  set biometric_last_out=original_biometric,
      last_out=p_checkout_time,
      checkout_source='manual',
      status='complete',
      undertime_minutes=mins,
      manual_checkout_by=auth.uid(),
      manual_checkout_at=now(),
      manual_checkout_note=nullif(btrim(p_note),''),
      updated_at=now()
  where id=a.id;

  update public.generated_undertimes u
  set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='Manual checkout corrected'
  where u.workspace='WAIS' and u.work_date=a.work_date and not u.is_deleted
    and public.employee_name_key(u.employee_name)=public.employee_name_key(a.employee_name)
    and (u.source_file_id::text=a.source_file_id::text or exists(
      select 1 from public.main_attendance_sources s
      where s.daily_attendance_id=a.id and s.source_file_id::text=u.source_file_id::text
    ));

  if mins>0 then
    select id into file_id from public.uploaded_files
    where workspace='WAIS' and file_name=a.source_file_name and not is_deleted
    order by uploaded_at desc limit 1;
    insert into public.generated_undertimes(
      workspace,employee_name,work_date,time_in,minutes_undertime,source_file_id,source_file_name
    ) values('WAIS',a.employee_name,a.work_date,p_checkout_time,mins,file_id,a.source_file_name);
  end if;

  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload)
  values(
    'WAIS',auth.uid(),'main_daily_attendance',a.id::text,'manual_checkout',
    jsonb_build_object(
      'checkout_time',p_checkout_time,
      'note',nullif(btrim(p_note),''),
      'original_biometric_last_out',original_biometric,
      'previous_effective_last_out',previous_effective
    )
  );
end $$;

revoke all on function public.set_main_manual_checkout(uuid,time,text) from public,anon;
grant execute on function public.set_main_manual_checkout(uuid,time,text) to authenticated;
commit;
