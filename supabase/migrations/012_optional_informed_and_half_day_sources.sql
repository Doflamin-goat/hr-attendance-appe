-- Forward-only attendance-rules-v2 preparation. NOT APPLIED.
begin;

alter table if exists public.absences
  add column if not exists informed_to text[] not null default '{}';

update public.half_day_records
set source_type = 'manual'
where source_type is null;

alter table public.half_day_records
  alter column source_type set default 'manual';

create or replace function public.create_half_day(p_employee_id uuid,p_date date,p_period text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.employees%rowtype; s time; f time; new_id uuid; dow int;
begin
  if auth.uid() is null or public.attendance_role()<>'HR' then raise exception 'Only HR can create half-day records'; end if;
  select * into e from public.employees where id=p_employee_id and not is_deleted and employment_status='active';
  if e.id is null then raise exception 'Active employee required'; end if;
  dow=extract(dow from p_date); if dow=0 then raise exception 'Sunday has no half-day schedule'; end if;
  if dow=6 then
    if p_period='morning' then s='07:00';f='11:00'; elsif p_period='afternoon' then s='11:00';f='15:15'; else raise exception 'Invalid period'; end if;
  else
    if p_period='morning' then s='08:00';f='12:00'; elsif p_period='afternoon' then s='13:00';f='17:00'; else raise exception 'Invalid period'; end if;
  end if;
  insert into public.half_day_records(workspace,employee_id,employee_name,work_date,absent_period,scheduled_start,scheduled_end,reason,created_by,source_type)
  values(e.workspace,e.id,e.full_name,p_date,p_period,s,f,nullif(btrim(p_reason),''),auth.uid(),'manual') returning id into new_id;
  return new_id;
end $$;

create or replace function public.create_generated_half_day(p_workspace text,p_employee_name text,p_date date,p_period text,p_reason text,p_source_file_name text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.employees%rowtype; s time; f time; new_id uuid; dow int;
begin
  if auth.uid() is null or public.attendance_role()<>'HR' then raise exception 'Only HR can generate half-day records'; end if;
  if p_period<>'morning' then raise exception 'Uploaded attendance supports morning-absent half-day only'; end if;
  select * into e from public.employees where workspace=p_workspace and not is_deleted and employment_status='active' and public.employee_name_key(full_name)=public.employee_name_key(p_employee_name);
  if e.id is null then raise exception 'Active employee required'; end if;
  dow=extract(dow from p_date); if dow=0 then raise exception 'Sunday has no generated half-day schedule'; end if;
  if dow=6 then s='07:00';f='11:00'; else s='08:00';f='12:00'; end if;
  update public.generated_undertimes set is_deleted=true,deleted_at=now(),deleted_reason='reclassified_as_half_day'
    where workspace=p_workspace and work_date=p_date and not is_deleted and public.employee_name_key(employee_name)=public.employee_name_key(e.full_name);
  update public.late_records set is_deleted=true,deleted_at=now(),deleted_reason='reclassified_as_half_day'
    where workspace=p_workspace and work_date=p_date and not is_deleted and public.employee_name_key(employee_name)=public.employee_name_key(e.full_name);
  insert into public.half_day_records(workspace,employee_id,employee_name,work_date,absent_period,scheduled_start,scheduled_end,reason,created_by,source_type,source_file_name)
  values(e.workspace,e.id,e.full_name,p_date,'morning',s,f,nullif(btrim(p_reason),''),auth.uid(),'attendance_upload',nullif(btrim(p_source_file_name),''))
  on conflict (employee_id,work_date,absent_period) do update set scheduled_start=excluded.scheduled_start,scheduled_end=excluded.scheduled_end,reason=excluded.reason,source_type='attendance_upload',source_file_name=excluded.source_file_name,is_deleted=false,restored_at=now(),restored_by=auth.uid(),removed_from_recycle_bin=false
  returning id into new_id;
  return new_id;
end $$;

revoke all on function public.create_half_day(uuid,date,text,text),public.create_generated_half_day(text,text,date,text,text,text) from public,anon;
grant execute on function public.create_half_day(uuid,date,text,text),public.create_generated_half_day(text,text,date,text,text,text) to authenticated;

commit;
