-- Scope Service references by workspace and preserve canonical employee matching.
-- Forward-only migration. Do not apply automatically.
begin;

drop index if exists public.service_events_active_service_ref_key;
create unique index if not exists service_events_active_workspace_service_ref_key
  on public.service_events(workspace, service_ref)
  where is_deleted = false;

drop function if exists public.service_reference(text);
create or replace function public.service_reference(p_workspace text, p_year text default null)
returns text language plpgsql security definer set search_path=public as $$
declare next_number integer;
begin
  if p_workspace not in ('APP','WAIS') then
    raise exception 'Valid Service workspace required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('service-ref:'||p_workspace,0));
  select coalesce(max((substring(service_ref from '^SR-([0-9]+)$'))::integer),0)+1
    into next_number
    from public.service_events
   where workspace=p_workspace and is_deleted=false;
  return 'SR-'||lpad(next_number::text,4,'0');
end;
$$;

create or replace function public.create_service_event(
  p_service_ref text,p_workspace text,p_service_start timestamptz,p_service_end timestamptz,
  p_employee_ids uuid[],p_client text default null,p_location text default null,
  p_purpose text default null,p_remarks text default null,p_status text default 'in_service'
) returns uuid language plpgsql security definer set search_path='' as $$
declare event_id uuid; employee_id uuid; ref text:=nullif(btrim(p_service_ref),'');
begin
  perform public.service_require_hr(p_workspace);
  if p_service_start is null or p_status not in ('in_service','completed','cancelled') or (p_status='completed' and p_service_end is null) then raise exception 'Valid service details required'; end if;
  perform public.service_validate_employees(p_workspace,p_employee_ids); perform public.service_validate_overlap(null,p_employee_ids,p_service_start,p_service_end);
  if ref is null then ref:=public.service_reference(p_workspace,to_char(p_service_start at time zone 'Asia/Manila','YYYY')); end if;
  insert into public.service_events(service_ref,workspace,service_start,service_end,client,location,purpose,remarks,status,created_by,updated_by) values(ref,p_workspace,p_service_start,p_service_end,nullif(btrim(p_client),''),nullif(btrim(p_location),''),nullif(btrim(p_purpose),''),nullif(btrim(p_remarks),''),p_status,auth.uid(),auth.uid()) returning id into event_id;
  foreach employee_id in array p_employee_ids loop insert into public.service_event_employees(service_event_id,employee_id,workspace) values(event_id,employee_id,p_workspace); end loop;
  if p_workspace='WAIS' then perform public.reconcile_main_service_attendance(event_id,true); end if;
  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload) values(p_workspace,auth.uid(),'service_event',event_id::text,'create',jsonb_build_object('service_ref',ref,'status',p_status,'service_start',p_service_start,'service_end',p_service_end,'employee_ids',p_employee_ids)); return event_id;
end $$;

revoke all on function public.service_reference(text,text) from public,anon,authenticated;
grant execute on function public.service_reference(text,text) to authenticated;

create or replace function public.restore_service_event(p_id uuid,p_workspace text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.service_events%rowtype;
begin
  if auth.uid() is null or public.attendance_role() <> 'HR' or public.attendance_workspace() is distinct from p_workspace then raise exception 'Not authorized'; end if;
  select * into r from public.service_events where id=p_id and workspace=p_workspace and is_deleted for update;
  if r.id is null then raise exception 'Service record not found'; end if;
  if exists(select 1 from public.service_events e where e.workspace=r.workspace and e.service_ref=r.service_ref and not e.is_deleted and e.id<>r.id) then raise exception 'Service Reference % is already in use',r.service_ref; end if;
  update public.service_events set is_deleted=false,deleted_at=null,deleted_by=null,updated_by=auth.uid(),updated_at=now() where id=r.id;
end $$;

revoke all on function public.restore_service_event(uuid,text) from public,anon;
grant execute on function public.restore_service_event(uuid,text) to authenticated;
commit;
