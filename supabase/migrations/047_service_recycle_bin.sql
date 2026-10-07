-- Service Recycle Bin operations.
begin;
create or replace function public.restore_service_event(p_id uuid,p_workspace text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.service_events%rowtype;
begin
  if auth.uid() is null or public.attendance_role() <> 'HR' or public.attendance_workspace() is distinct from p_workspace then raise exception 'Not authorized'; end if;
  select * into r from public.service_events where id=p_id and workspace=p_workspace and is_deleted for update;
  if r.id is null then raise exception 'Service record not found'; end if;
  if exists(select 1 from public.service_events e where e.service_ref=r.service_ref and not e.is_deleted and e.id<>r.id) then raise exception 'Service Reference % is already in use',r.service_ref; end if;
  update public.service_events set is_deleted=false,deleted_at=null,deleted_by=null,updated_by=auth.uid(),updated_at=now() where id=r.id;
end $$;
create or replace function public.permanently_delete_service_event(p_id uuid,p_workspace text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.service_events%rowtype;
begin
  if auth.uid() is null or public.attendance_role() <> 'HR' or public.attendance_workspace() is distinct from p_workspace then raise exception 'Not authorized'; end if;
  select * into r from public.service_events where id=p_id and workspace=p_workspace and is_deleted for update;
  if r.id is null then raise exception 'Service record not found in Recycle Bin'; end if;
  delete from public.service_event_effects where service_event_id=r.id;
  delete from public.service_event_employees where service_event_id=r.id;
  delete from public.service_events where id=r.id;
end $$;
revoke all on function public.restore_service_event(uuid,text),public.permanently_delete_service_event(uuid,text) from public,anon;
grant execute on function public.restore_service_event(uuid,text),public.permanently_delete_service_event(uuid,text) to authenticated;
commit;