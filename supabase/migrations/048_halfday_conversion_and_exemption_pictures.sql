-- HR workflow improvements: atomic generated-undertime conversion and exemption pictures.
begin;

create or replace function public.move_generated_undertime_to_half_day(p_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  u public.generated_undertimes%rowtype;
  e public.employees%rowtype;
  hid uuid;
  s time;
  f time;
begin
  if auth.uid() is null or public.attendance_role() <> 'HR' then raise exception 'Only HR can move undertime to half-day'; end if;
  select * into u from public.generated_undertimes where id=p_id and workspace=public.attendance_workspace() and not is_deleted for update;
  if u.id is null then raise exception 'Active system-generated undertime not found'; end if;
  select * into e from public.employees where id=u.employee_id and workspace=u.workspace and not is_deleted and employment_status='active' for update;
  if e.id is null then raise exception 'Employee is not in the current workspace'; end if;
  if exists(select 1 from public.half_day_records h where h.workspace=u.workspace and h.employee_id=e.id and h.work_date=u.work_date and not h.is_deleted) then
    raise exception 'A Half-Day record already exists for this employee and date.';
  end if;
  if extract(dow from u.work_date)=0 then raise exception 'Sunday has no half-day schedule'; end if;
  if extract(dow from u.work_date)=6 then s='11:00'; f='15:15'; else s='13:00'; f='17:00'; end if;
  insert into public.half_day_records(workspace,employee_id,employee_name,work_date,absent_period,scheduled_start,scheduled_end,reason,created_by,source_type,source_file_name,source_time_in,source_generated_undertime_id)
  values(u.workspace,e.id,e.full_name,u.work_date,'afternoon',s,f,nullif(btrim(u.reason),''),auth.uid(),'system_generated',u.source_file_name,u.time_in,u.id::text)
  returning id into hid;
  update public.generated_undertimes set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='reclassified_as_half_day' where id=u.id and not is_deleted;
  if not found then raise exception 'Undertime changed before conversion'; end if;
  return hid;
end $$;

create table if not exists public.exemption_pictures (
  id uuid primary key default gen_random_uuid(),
  exemption_id bigint not null references public.exemptions(id) on delete cascade,
  workspace text not null check (workspace in ('APP','WAIS')),
  storage_path text not null,
  file_name text not null,
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists exemption_pictures_exemption_idx on public.exemption_pictures(exemption_id);
alter table public.exemption_pictures enable row level security;
drop policy if exists exemption_pictures_scoped_read on public.exemption_pictures;
create policy exemption_pictures_scoped_read on public.exemption_pictures for select to authenticated using (public.attendance_role() in ('HR','Admin') and exemption_pictures.workspace=public.attendance_workspace() and exists(select 1 from public.exemptions e where e.id=exemption_pictures.exemption_id and e.workspace=exemption_pictures.workspace));
drop policy if exists exemption_pictures_hr_write on public.exemption_pictures;
create policy exemption_pictures_hr_write on public.exemption_pictures for all to authenticated using (public.attendance_role()='HR' and workspace=public.attendance_workspace()) with check (public.attendance_role()='HR' and workspace=public.attendance_workspace());

create or replace function public.update_exemption_evidence(p_id bigint,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare x public.exemptions%rowtype;
begin
  if auth.uid() is null or public.attendance_role() <> 'HR' then raise exception 'Only HR can edit exemptions'; end if;
  select * into x from public.exemptions where id=p_id and workspace=public.attendance_workspace() and not is_deleted for update;
  if x.id is null then raise exception 'Exemption not found'; end if;
  update public.exemptions set reason=btrim(p_reason), approval_status=case when x.approval_status in ('approved','declined') then 'pending' else x.approval_status end, reviewed_by=case when x.approval_status in ('approved','declined') then null else reviewed_by end, reviewed_at=case when x.approval_status in ('approved','declined') then null else reviewed_at end, review_remarks=case when x.approval_status in ('approved','declined') then null else review_remarks end where id=x.id;
end $$;

revoke all on function public.move_generated_undertime_to_half_day(uuid),public.update_exemption_evidence(bigint,text) from public,anon;
grant execute on function public.move_generated_undertime_to_half_day(uuid),public.update_exemption_evidence(bigint,text) to authenticated;
commit;
