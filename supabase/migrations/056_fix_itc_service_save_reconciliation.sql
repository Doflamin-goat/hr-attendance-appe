-- Avoid reconciling APP Service attendance while update_service_event is
-- temporarily replacing the employee membership set. Reconcile once after
-- the final set is present; independent membership changes remain trigger-driven.
begin;

create or replace function public.update_service_event(
  p_id uuid,
  p_service_ref text,
  p_workspace text,
  p_service_start timestamptz,
  p_service_end timestamptz,
  p_employee_ids uuid[],
  p_client text default null,
  p_location text default null,
  p_purpose text default null,
  p_remarks text default null,
  p_status text default 'in_service'
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  old_event public.service_events%rowtype;
  ref text;
  previous_itc_guard text;
begin
  perform public.service_require_hr(p_workspace);
  select * into old_event
    from public.service_events
   where id=p_id and workspace=p_workspace and not is_deleted
   for update;
  if old_event.id is null then raise exception 'Service record not found'; end if;
  if p_service_start is null
     or p_status not in ('in_service','completed','cancelled')
     or (p_status='completed' and p_service_end is null) then
    raise exception 'Valid service details required';
  end if;

  perform public.service_validate_employees(p_workspace,p_employee_ids);
  if p_workspace='WAIS' then
    perform public.service_validate_overlap(p_id,p_employee_ids,p_service_start,p_service_end);
  end if;
  ref:=coalesce(nullif(btrim(p_service_ref),''),old_event.service_ref);

  if p_workspace='WAIS' then
    perform set_config('watts.service_reconcile','1',true);
    perform public.reconcile_main_service_attendance(p_id,false);
  else
    previous_itc_guard:=current_setting('watts.itc_service_reconcile',true);
    perform set_config('watts.itc_service_reconcile','1',true);
  end if;

  update public.service_events
     set service_ref=ref,
         service_start=p_service_start,
         service_end=p_service_end,
         client=nullif(btrim(p_client),''),
         location=nullif(btrim(p_location),''),
         purpose=nullif(btrim(p_purpose),''),
         remarks=nullif(btrim(p_remarks),''),
         status=p_status,
         updated_by=auth.uid(),
         updated_at=now()
   where id=p_id;

  delete from public.service_event_employees where service_event_id=p_id;
  insert into public.service_event_employees(service_event_id,employee_id,workspace)
  select p_id,id,p_workspace
    from public.employees
   where id=any(p_employee_ids);

  if p_workspace='WAIS' then
    perform public.reconcile_main_service_attendance(p_id,true);
  else
    -- Direct calls are not suppressed by the trigger guard. Run against the
    -- final Service and membership state, then restore the caller's guard.
    perform public.reconcile_itc_service_attendance(p_id);
    perform set_config('watts.itc_service_reconcile',coalesce(previous_itc_guard,''),true);
  end if;

  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload)
  values(p_workspace,auth.uid(),'service_event',p_id::text,'update',
         jsonb_build_object('service_ref',ref,'status',p_status,
                            'service_start',p_service_start,'service_end',p_service_end,
                            'employee_ids',p_employee_ids));
end;
$$;

create or replace function public.reconcile_itc_service_membership_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  event_id uuid;
  event_workspace text;
begin
  if tg_op='DELETE' then
    event_id:=old.service_event_id;
    event_workspace:=old.workspace;
  else
    event_id:=new.service_event_id;
    event_workspace:=new.workspace;
  end if;

  if event_workspace='APP'
     and current_setting('watts.itc_service_reconcile',true) is distinct from '1' then
    perform public.reconcile_itc_service_attendance(event_id);
  end if;

  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.update_service_event(uuid,text,text,timestamptz,timestamptz,uuid[],text,text,text,text,text) from public,anon;
grant execute on function public.update_service_event(uuid,text,text,timestamptz,timestamptz,uuid[],text,text,text,text,text) to authenticated;

commit;
