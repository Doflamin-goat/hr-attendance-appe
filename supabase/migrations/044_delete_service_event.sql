-- Soft-delete Service records through the existing scoped reconciliation path.
begin;

create or replace function public.delete_service_event(p_id uuid,p_workspace text)
returns void language plpgsql security definer set search_path='' as $$
declare event_row public.service_events%rowtype;
begin
  perform public.service_require_hr(p_workspace);
  select * into event_row
  from public.service_events
  where id=p_id and workspace=p_workspace and not is_deleted
  for update;
  if event_row.id is null then raise exception 'Service record not found in this workspace'; end if;
  if event_row.workspace='WAIS' and event_row.status in ('in_service','completed') then
    perform set_config('watts.service_reconcile','1',true);
    perform public.reconcile_main_service_attendance(event_row.id,false);
  end if;
  update public.service_events
  set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),updated_by=auth.uid(),updated_at=now()
  where id=event_row.id;
  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload)
  values(event_row.workspace,auth.uid(),'service_event',event_row.id::text,'delete',jsonb_build_object('service_ref',event_row.service_ref,'status',event_row.status,'service_start',event_row.service_start,'service_end',event_row.service_end));
end $$;

revoke all on function public.delete_service_event(uuid,text) from public,anon;
grant execute on function public.delete_service_event(uuid,text) to authenticated;
commit;
