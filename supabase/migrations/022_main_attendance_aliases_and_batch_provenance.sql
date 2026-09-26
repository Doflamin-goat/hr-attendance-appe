-- MAIN attendance aliases, display names, and upload-batch provenance.
-- FORWARD-ONLY; DO NOT APPLY AUTOMATICALLY. Requires migrations 019-021.
begin;

alter table public.employees add column if not exists attendance_name text;
create table if not exists public.main_biometric_aliases (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id),
  biometric_alias text not null, normalized_alias text not null unique,
  confirmed_by uuid references auth.users(id), confirmed_at timestamptz not null default now()
);
alter table public.main_biometric_aliases enable row level security;
create policy "MAIN scope reads biometric aliases" on public.main_biometric_aliases for select to authenticated using(public.attendance_hr_scope()='MAIN' and public.attendance_role() in ('HR','Admin'));

with names(employee_number,attendance_name) as (values
 ('W-3001704','Marjorie Reyes'),('M-5009402','Armando L. Aquino'),('W-2001802','Rogel Collera'),
 ('W-8001910','Reina Lynn Ong'),('W-3002011','Criselda Abellera'),('M-2009501','Uldarico Codilan'),
 ('W-2001803','Ralvic Bernal'),('M-3002318','Christine Joy Lasam'),('W-3002423','Lea Bael'),
 ('W-2002508','Joben Huerto'),('W-6002627','Eduard Corona Jr'),('W-3002636','Catherine Santos'),
 ('W-3002637','Kimberly Mae Reyes')
) update public.employees e set attendance_name=n.attendance_name from names n where e.employee_number=n.employee_number and e.hr_scope='MAIN';

with aliases(employee_number,alias) as (values
 ('W-3001704','MARJORIE REYES'),('M-5009402','ARMANDO L. AQUINO'),('M-5009402','ARMANDO AQUINO'),
 ('W-2001802','ROGEL COLLERA'),('W-8001910','REINA LYNN ONG'),('W-3002011','CRISELDA ABELLERA'),
 ('M-2009501','ULDARICO CODILAN'),('W-2001803','RALVIC BERNAL'),('M-3002318','CHRISTINE JOY LASAM'),
 ('W-3002423','LEA BAEL'),('W-2002508','JOBEN HUERTO'),('W-3002636','CATHERINE SANTOS'),
 ('W-3002637','KIMBERLY MAE REYES'),('W-6002627','EDUARD CORONA JR')
) insert into public.main_biometric_aliases(employee_id,biometric_alias,normalized_alias)
select e.id,a.alias,regexp_replace(regexp_replace(upper(a.alias),'[^A-Z0-9]+',' ','g'),'\s+',' ','g') from aliases a join public.employees e on e.employee_number=a.employee_number and e.hr_scope='MAIN'
on conflict(normalized_alias) do update set employee_id=excluded.employee_id,biometric_alias=excluded.biometric_alias;

with devices(employee_number,device_no) as (values ('W-3001704','21'),('M-5009402','3'),('M-5009402','99'),('W-2001802','37'))
insert into public.main_biometric_mappings(device_no,employee_id)
select d.device_no,e.id from devices d join public.employees e on e.employee_number=d.employee_number and e.hr_scope='MAIN'
on conflict(device_no) do update set employee_id=excluded.employee_id,confirmed_at=now();

alter table public.main_daily_attendance add column if not exists source_file_id uuid references public.uploaded_files(id);
alter table public.main_daily_attendance add column if not exists is_deleted boolean not null default false;
alter table public.main_daily_attendance add column if not exists deleted_at timestamptz;
alter table public.main_daily_attendance add column if not exists deleted_by uuid references auth.users(id);
alter table public.main_daily_attendance add column if not exists deleted_batch_id uuid;
alter table public.half_day_records add column if not exists source_file_id uuid references public.uploaded_files(id);
alter table public.absences add column if not exists source_file_id uuid references public.uploaded_files(id);
create index if not exists main_daily_source_file_idx on public.main_daily_attendance(source_file_id);
create index if not exists half_day_source_file_idx on public.half_day_records(source_file_id) where source_type='attendance_upload';
create index if not exists absence_source_file_idx on public.absences(source_file_id) where source_type='system_generated';

create or replace function public.attach_main_import_provenance() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source_file_id is null then select id into new.source_file_id from public.uploaded_files where workspace='WAIS' and file_name=new.source_file_name and not is_deleted order by uploaded_at desc limit 1; end if;
 return new;
end $$;
drop trigger if exists trg_main_daily_import_provenance on public.main_daily_attendance;
create trigger trg_main_daily_import_provenance before insert or update of source_file_name on public.main_daily_attendance for each row execute function public.attach_main_import_provenance();
drop trigger if exists trg_half_day_import_provenance on public.half_day_records;
create trigger trg_half_day_import_provenance before insert or update of source_file_name on public.half_day_records for each row when(new.source_type='attendance_upload') execute function public.attach_main_import_provenance();

create or replace function public.attach_main_absence_provenance() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.workspace='WAIS' and new.source_type='system_generated' and new.source_file_id is null then select id into new.source_file_id from public.uploaded_files where workspace='WAIS' and not is_deleted order by uploaded_at desc limit 1; end if;
 return new;
end $$;
drop trigger if exists trg_main_absence_import_provenance on public.absences;
create trigger trg_main_absence_import_provenance before insert on public.absences for each row execute function public.attach_main_absence_provenance();

create or replace function public.map_main_attendance_record(p_record_id uuid,p_employee_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare a public.main_daily_attendance%rowtype; e public.employees%rowtype;
begin
 if auth.uid() is null or public.attendance_role()<>'HR' or public.attendance_hr_scope()<>'MAIN' then raise exception 'MAIN HR access required'; end if;
 select * into a from public.main_daily_attendance where id=p_record_id and workspace='WAIS' and employee_id is null for update;
 select * into e from public.employees where id=p_employee_id and hr_scope='MAIN' and workspace='WAIS' and employment_status='active' and not is_deleted;
 if a.id is null or e.id is null then raise exception 'Unmatched attendance and active MAIN employee required'; end if;
 insert into public.main_biometric_aliases(employee_id,biometric_alias,normalized_alias,confirmed_by)
 values(e.id,a.raw_name,regexp_replace(regexp_replace(upper(a.raw_name),'[^A-Z0-9]+',' ','g'),'\s+',' ','g'),auth.uid()) on conflict(normalized_alias) do update set employee_id=excluded.employee_id,confirmed_by=auth.uid(),confirmed_at=now();
 if a.device_no is not null then insert into public.main_biometric_mappings(device_no,employee_id,confirmed_by) values(a.device_no,e.id,auth.uid()) on conflict(device_no) do update set employee_id=excluded.employee_id,confirmed_by=auth.uid(),confirmed_at=now(); end if;
 if exists(select 1 from public.main_daily_attendance where employee_id=e.id and work_date=a.work_date and not is_deleted) then
   update public.main_daily_attendance set is_deleted=true,deleted_at=now(),deleted_by=auth.uid() where id=a.id;
 else
   update public.main_daily_attendance set employee_id=e.id,employee_name=coalesce(e.attendance_name,e.full_name),status=case when last_out is null then 'missing_checkout' else 'complete' end,updated_at=now() where id=a.id;
   if a.late_minutes>0 then insert into public.late_records(workspace,employee_name,work_date,time_in,minutes_late,seconds_late,total_seconds_late,source_file_id,source_file_name) values('WAIS',coalesce(e.attendance_name,e.full_name),a.work_date,a.first_in,a.late_minutes,a.late_seconds,a.late_minutes*60+a.late_seconds,a.source_file_id,a.source_file_name); end if;
   if a.is_half_day then perform public.create_generated_half_day('WAIS',e.full_name,a.work_date,'morning','Generated from MAIN attendance first C/In',a.source_file_name); update public.half_day_records set employee_name=coalesce(e.attendance_name,e.full_name),source_file_id=a.source_file_id,source_time_in=a.first_in where employee_id=e.id and work_date=a.work_date and source_type='attendance_upload' and not is_deleted; end if;
   if a.last_out is not null and a.undertime_minutes>0 then insert into public.generated_undertimes(workspace,employee_name,work_date,time_in,minutes_undertime,source_file_id,source_file_name) values('WAIS',coalesce(e.attendance_name,e.full_name),a.work_date,a.last_out,a.undertime_minutes,a.source_file_id,a.source_file_name); end if;
   update public.absences set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='Biometric mapping confirmed' where employee_id=e.id and work_date=a.work_date and source_type='system_generated' and not is_deleted;
 end if;
 insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload) values('WAIS',auth.uid(),'main_daily_attendance',a.id::text,'confirm_biometric_mapping',jsonb_build_object('employee_id',e.id,'raw_name',a.raw_name,'device_no',a.device_no));
end $$;

create or replace function public.delete_main_attendance_upload(p_file_id uuid,p_batch_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.attendance_role()<>'HR' or public.attendance_hr_scope()<>'MAIN' then raise exception 'MAIN HR access required'; end if;
 update public.main_daily_attendance set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id where source_file_id=p_file_id and not is_deleted;
 update public.late_records set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id where source_file_id=p_file_id and not is_deleted;
 update public.generated_undertimes set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id where source_file_id=p_file_id and not is_deleted;
 update public.half_day_records set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id where source_file_id=p_file_id and source_type='attendance_upload' and not is_deleted;
 update public.absences set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id where source_file_id=p_file_id and source_type='system_generated' and not is_deleted;
 update public.uploaded_files set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_batch_id=p_batch_id,deleted_reason='uploaded_file_deleted' where id=p_file_id and workspace='WAIS' and not is_deleted;
end $$;

revoke all on function public.map_main_attendance_record(uuid,uuid),public.delete_main_attendance_upload(uuid,uuid) from public,anon;
grant execute on function public.map_main_attendance_record(uuid,uuid),public.delete_main_attendance_upload(uuid,uuid) to authenticated;
commit;
