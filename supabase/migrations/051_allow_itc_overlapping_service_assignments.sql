-- Allow overlapping Service assignments for APP/ITC while preserving WAIS rules.
begin;

create or replace function public.create_service_event(p_service_ref text,p_workspace text,p_service_start timestamptz,p_service_end timestamptz,p_employee_ids uuid[],p_client text default null,p_location text default null,p_purpose text default null,p_remarks text default null,p_status text default 'in_service')
returns uuid language plpgsql security definer set search_path='' as $$
declare event_id uuid; employee_id uuid; ref text:=nullif(btrim(p_service_ref),'');
begin
  perform public.service_require_hr(p_workspace);
  if p_service_start is null or p_status not in ('in_service','completed','cancelled') or (p_status='completed' and p_service_end is null) then raise exception 'Valid service details required'; end if;
  perform public.service_validate_employees(p_workspace,p_employee_ids);
  if p_workspace='WAIS' then perform public.service_validate_overlap(null,p_employee_ids,p_service_start,p_service_end); end if;
  if ref is null then ref:=public.service_reference(to_char(p_service_start at time zone 'Asia/Manila','YYYY')); end if;
  insert into public.service_events(service_ref,workspace,service_start,service_end,client,location,purpose,remarks,status,created_by,updated_by) values(ref,p_workspace,p_service_start,p_service_end,nullif(btrim(p_client),''),nullif(btrim(p_location),''),nullif(btrim(p_purpose),''),nullif(btrim(p_remarks),''),p_status,auth.uid(),auth.uid()) returning id into event_id;
  foreach employee_id in array p_employee_ids loop insert into public.service_event_employees(service_event_id,employee_id,workspace) values(event_id,employee_id,p_workspace); end loop;
  if p_workspace='WAIS' then perform public.reconcile_main_service_attendance(event_id,true); end if;
  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload) values(p_workspace,auth.uid(),'service_event',event_id::text,'create',jsonb_build_object('service_ref',ref,'status',p_status,'service_start',p_service_start,'service_end',p_service_end,'employee_ids',p_employee_ids)); return event_id;
end $$;

create or replace function public.update_service_event(p_id uuid,p_service_ref text,p_workspace text,p_service_start timestamptz,p_service_end timestamptz,p_employee_ids uuid[],p_client text default null,p_location text default null,p_purpose text default null,p_remarks text default null,p_status text default 'in_service')
returns void language plpgsql security definer set search_path='' as $$
declare old_event public.service_events%rowtype; ref text;
begin
  perform public.service_require_hr(p_workspace); select * into old_event from public.service_events where id=p_id and workspace=p_workspace and not is_deleted for update; if old_event.id is null then raise exception 'Service record not found'; end if;
  if p_service_start is null or p_status not in ('in_service','completed','cancelled') or (p_status='completed' and p_service_end is null) then raise exception 'Valid service details required'; end if;
  perform public.service_validate_employees(p_workspace,p_employee_ids); if p_workspace='WAIS' then perform public.service_validate_overlap(p_id,p_employee_ids,p_service_start,p_service_end); end if; ref:=coalesce(nullif(btrim(p_service_ref),''),old_event.service_ref);
  if p_workspace='WAIS' then perform set_config('watts.service_reconcile','1',true); perform public.reconcile_main_service_attendance(p_id,false); end if;
  update public.service_events set service_ref=ref,service_start=p_service_start,service_end=p_service_end,client=nullif(btrim(p_client),''),location=nullif(btrim(p_location),''),purpose=nullif(btrim(p_purpose),''),remarks=nullif(btrim(p_remarks),''),status=p_status,updated_by=auth.uid(),updated_at=now() where id=p_id;
  delete from public.service_event_employees where service_event_id=p_id;
  insert into public.service_event_employees(service_event_id,employee_id,workspace) select p_id,id,p_workspace from public.employees where id=any(p_employee_ids);
  if p_workspace='WAIS' then perform public.reconcile_main_service_attendance(p_id,true); end if;
  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload) values(p_workspace,auth.uid(),'service_event',p_id::text,'update',jsonb_build_object('service_ref',ref,'status',p_status,'service_start',p_service_start,'service_end',p_service_end,'employee_ids',p_employee_ids));
end $$;

-- When one overlapping APP Service is cancelled or edited, restore only when
-- no other active/completed APP Service still covers the same generated row.
create or replace function public.reconcile_itc_service_attendance(p_event_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare ev public.service_events%rowtype; link record; hd record; ut record; n integer:=0;
begin
  if auth.uid() is null or public.attendance_role()<>'HR' or public.attendance_workspace()<>'APP' then raise exception 'Only APP HR can reconcile ITC Service attendance'; end if;
  select * into ev from public.service_events where id=p_event_id and workspace='APP' for update;
  if ev.id is null then raise exception 'APP Service record not found'; end if;
  if ev.status='cancelled' or ev.is_deleted then
    for hd in select e.* from public.itc_service_attendance_effects e where e.service_event_id=ev.id and e.half_day_id is not null and e.restored_at is null loop
      if not exists(select 1 from public.itc_service_attendance_effects x join public.service_events s on s.id=x.service_event_id where x.half_day_id=hd.half_day_id and x.restored_at is null and x.service_event_id<>ev.id and s.workspace='APP' and s.status<>'cancelled' and not s.is_deleted) then update public.half_day_records set is_deleted=false,deleted_at=null,deleted_by=null,deleted_reason=null where id=hd.half_day_id and is_deleted; end if;
      update public.itc_service_attendance_effects set restored_at=now() where id=hd.id;
    end loop;
    for ut in select e.* from public.itc_service_attendance_effects e where e.service_event_id=ev.id and e.undertime_id is not null and e.restored_at is null loop
      if not exists(select 1 from public.itc_service_attendance_effects x join public.service_events s on s.id=x.service_event_id where x.undertime_id=ut.undertime_id and x.restored_at is null and x.service_event_id<>ev.id and s.workspace='APP' and s.status<>'cancelled' and not s.is_deleted) then update public.generated_undertimes set is_deleted=false,deleted_at=null,deleted_by=null,deleted_reason=null where id=ut.undertime_id and is_deleted; end if;
      update public.itc_service_attendance_effects set restored_at=now() where id=ut.id;
    end loop;
    return 0;
  end if;
  for link in select employee_id from public.service_event_employees where service_event_id=ev.id and workspace='APP' loop
    for hd in select h.* from public.half_day_records h where h.workspace='APP' and h.employee_id=link.employee_id and h.source_type='attendance_upload' and not h.is_deleted and h.work_date between (ev.service_start at time zone 'Asia/Manila')::date and coalesce((ev.service_end at time zone 'Asia/Manila')::date,(ev.service_start at time zone 'Asia/Manila')::date) and ev.service_end is not null and ev.service_start <= ((h.work_date + case when h.absent_period='morning' then time '12:00' else time '17:00' end) at time zone 'Asia/Manila') loop
      update public.half_day_records set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='reconciled_by_itc_service' where id=hd.id;
      insert into public.itc_service_attendance_effects(service_event_id,employee_id,work_date,half_day_id) values(ev.id,link.employee_id,hd.work_date,hd.id) on conflict do nothing; n:=n+1;
    end loop;
    for ut in select u.* from public.generated_undertimes u where u.workspace='APP' and u.employee_id=link.employee_id and not u.is_deleted and u.work_date=(ev.service_start at time zone 'Asia/Manila')::date and ev.service_end is not null and ev.service_end >= ((u.work_date + u.time_in) at time zone 'Asia/Manila') loop
      update public.generated_undertimes set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='reconciled_by_itc_service' where id=ut.id;
      insert into public.itc_service_attendance_effects(service_event_id,employee_id,work_date,undertime_id) values(ev.id,link.employee_id,ut.work_date,ut.id) on conflict do nothing; n:=n+1;
    end loop;
  end loop;
  return n;
end $$;

revoke all on function public.create_service_event(text,text,timestamptz,timestamptz,uuid[],text,text,text,text,text),public.update_service_event(uuid,text,text,timestamptz,timestamptz,uuid[],text,text,text,text,text) from public,anon;
grant execute on function public.create_service_event(text,text,timestamptz,timestamptz,uuid[],text,text,text,text,text),public.update_service_event(uuid,text,text,timestamptz,timestamptz,uuid[],text,text,text,text,text) to authenticated;
commit;
