-- Live integration fixes for the already-applied HR workflow migration 048.
begin;

-- Keep the existing private attendance bucket convention, but make it explicit
-- and scope exemption objects by workspace folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attendance-files', 'attendance-files', false, 10485760, array['image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public=false;

drop policy if exists "exemption pictures scoped read" on storage.objects;
create policy exemption_pictures_scoped_storage_read on storage.objects for select to authenticated
using (bucket_id='attendance-files' and (storage.foldername(name))[1]='exemptions' and (storage.foldername(name))[2] in ('APP','WAIS') and (storage.foldername(name))[2]=public.attendance_workspace() and public.attendance_role() in ('HR','Admin'));

drop policy if exists "exemption pictures scoped HR insert" on storage.objects;
create policy exemption_pictures_scoped_storage_insert on storage.objects for insert to authenticated
with check (bucket_id='attendance-files' and (storage.foldername(name))[1]='exemptions' and (storage.foldername(name))[2] in ('APP','WAIS') and (storage.foldername(name))[2]=public.attendance_workspace() and public.attendance_role()='HR');

drop policy if exists "exemption pictures scoped HR delete" on storage.objects;
create policy exemption_pictures_scoped_storage_delete on storage.objects for delete to authenticated
using (bucket_id='attendance-files' and (storage.foldername(name))[1]='exemptions' and (storage.foldername(name))[2]=public.attendance_workspace() and public.attendance_role()='HR');

-- Resolve legacy generated undertimes that predate employee_id back to the
-- current-workspace Employee Master row, then perform the same atomic move.
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
  select * into e from public.employees where workspace=u.workspace and not is_deleted and employment_status='active' and ((u.employee_id is not null and id=u.employee_id) or (u.employee_id is null and public.employee_name_key(full_name)=public.employee_name_key(u.employee_name))) order by (id=u.employee_id) desc limit 1 for update;
  if e.id is null then raise exception 'Employee is not in the current workspace'; end if;
  if exists(select 1 from public.half_day_records h where h.workspace=u.workspace and h.employee_id=e.id and h.work_date=u.work_date and not h.is_deleted) then raise exception 'A Half-Day record already exists for this employee and date.'; end if;
  if extract(dow from u.work_date)=0 then raise exception 'Sunday has no half-day schedule'; end if;
  if extract(dow from u.work_date)=6 then s='11:00'; f='15:15'; else s='13:00'; f='17:00'; end if;
  insert into public.half_day_records(workspace,employee_id,employee_name,work_date,absent_period,scheduled_start,scheduled_end,reason,created_by,source_type,source_file_name,source_time_in,source_generated_undertime_id)
  values(u.workspace,e.id,e.full_name,u.work_date,'afternoon',s,f,nullif(btrim(u.reason),''),auth.uid(),'system_generated',u.source_file_name,u.time_in,u.id::text) returning id into hid;
  update public.generated_undertimes set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='reclassified_as_half_day' where id=u.id and not is_deleted;
  if not found then raise exception 'Undertime changed before conversion'; end if;
  return hid;
end $$;

-- Preserve completed review history in audit_logs while clearing the current
-- review marker when evidence changes and re-review is required.
create or replace function public.update_exemption_evidence(p_id bigint,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare x public.exemptions%rowtype;
begin
  if auth.uid() is null or public.attendance_role() <> 'HR' then raise exception 'Only HR can edit exemptions'; end if;
  select * into x from public.exemptions where id=p_id and workspace=public.attendance_workspace() and not is_deleted for update;
  if x.id is null then raise exception 'Exemption not found'; end if;
  if x.approval_status in ('approved','declined') then
    insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload) values(x.workspace,auth.uid(),'exemption',x.id::text,'evidence_changed',jsonb_build_object('previous_status',x.approval_status,'previous_reviewed_by',x.reviewed_by,'previous_reviewed_at',x.reviewed_at,'previous_review_remarks',x.review_remarks));
    update public.exemptions set reason=btrim(p_reason),approval_status='pending',reviewed_by=null,reviewed_at=null,review_remarks=null where id=x.id;
  else
    update public.exemptions set reason=btrim(p_reason) where id=x.id;
  end if;
end $$;

revoke all on function public.move_generated_undertime_to_half_day(uuid),public.update_exemption_evidence(bigint,text) from public,anon;
grant execute on function public.move_generated_undertime_to_half_day(uuid),public.update_exemption_evidence(bigint,text) to authenticated;
commit;
