-- Safely reconcile APP/ITC generated attendance when an employee is covered by Service.
-- generated_undertimes.time_in is text in this schema; parse only supported clock forms.
begin;

create or replace function public.reconcile_itc_service_attendance(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.service_events%rowtype;
  service_employee record;
  half_day_row record;
  undertime_row record;
  effect_row record;
  supporting_service_id uuid;
  coverage_ok boolean;
  parsed_time time;
  affected_count integer := 0;
begin
  if auth.uid() is null
     or public.attendance_role() is distinct from 'HR'
     or public.attendance_workspace() is distinct from 'APP' then
    raise exception 'Only APP HR can reconcile ITC Service attendance';
  end if;

  select se.*
    into event_row
    from public.service_events as se
   where se.id = p_event_id
     and se.workspace = 'APP'
   for update;

  if event_row.id is null then
    raise exception 'APP Service record not found';
  end if;

  -- Restore this Service's stale suppressions unless remaining Service coverage
  -- (including overlapping windows) still justifies the generated classification.
  for effect_row in
    select e.* from public.itc_service_attendance_effects e
    where e.service_event_id=event_row.id and e.restored_at is null for update
  loop
    supporting_service_id := null;
    if effect_row.half_day_id is not null then
      select coalesce(range_agg(tstzrange(s.service_start,s.service_end + interval '10 minutes','[]')), '{}'::tstzmultirange)
             @> tstzrange((effect_row.work_date + time '08:00') at time zone 'Asia/Manila',
                          (effect_row.work_date + coalesce(h.source_time_in,time '13:05:46')) at time zone 'Asia/Manila','[]')
        into coverage_ok
        from public.service_events s
        join public.service_event_employees m on m.service_event_id=s.id and m.employee_id=effect_row.employee_id and m.workspace='APP'
        join public.half_day_records h on h.id=effect_row.half_day_id and h.absent_period='morning' and h.source_type='attendance_upload'
       where s.id<>event_row.id and s.workspace='APP' and s.status in ('in_service','completed') and not s.is_deleted;
      if not coalesce(coverage_ok,false) then
        update public.half_day_records set is_deleted=false,deleted_at=null,deleted_by=null,deleted_reason=null where id=effect_row.half_day_id and workspace='APP' and is_deleted and deleted_reason='reconciled_by_itc_service';
      else
        select s.id into supporting_service_id from public.service_events s
        join public.service_event_employees m on m.service_event_id=s.id and m.employee_id=effect_row.employee_id and m.workspace='APP'
        where s.id<>event_row.id and s.workspace='APP' and s.status in ('in_service','completed') and not s.is_deleted and s.service_end is not null
          and s.service_start <= ((effect_row.work_date + coalesce((select h.source_time_in from public.half_day_records h where h.id=effect_row.half_day_id),time '13:05:46')) at time zone 'Asia/Manila')
          and s.service_end + interval '10 minutes' >= ((effect_row.work_date + time '08:00') at time zone 'Asia/Manila')
        order by s.service_end desc limit 1;
        if supporting_service_id is not null and not exists(select 1 from public.itc_service_attendance_effects x where x.service_event_id=supporting_service_id and x.half_day_id=effect_row.half_day_id and x.restored_at is null) then
          insert into public.itc_service_attendance_effects(service_event_id,employee_id,work_date,half_day_id) values(supporting_service_id,effect_row.employee_id,effect_row.work_date,effect_row.half_day_id);
        end if;
      end if;
    elsif effect_row.undertime_id is not null then
      select coalesce(range_agg(tstzrange(s.service_start,s.service_end + interval '10 minutes','[]')), '{}'::tstzmultirange)
             @> tstzrange((effect_row.work_date + time '08:00') at time zone 'Asia/Manila',
                          (effect_row.work_date + btrim(u.time_in)::time) at time zone 'Asia/Manila','[]')
        into coverage_ok
        from public.service_events s
        join public.service_event_employees m on m.service_event_id=s.id and m.employee_id=effect_row.employee_id and m.workspace='APP'
        join public.generated_undertimes u on u.id=effect_row.undertime_id and nullif(btrim(u.time_in),'') is not null
       where s.id<>event_row.id and s.workspace='APP' and s.status in ('in_service','completed') and not s.is_deleted
         and btrim(u.time_in) ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$';
      if not coalesce(coverage_ok,false) then
        update public.generated_undertimes set is_deleted=false,deleted_at=null,deleted_by=null,deleted_reason=null where id=effect_row.undertime_id and workspace='APP' and is_deleted and deleted_reason='reconciled_by_itc_service';
      else
        select s.id into supporting_service_id from public.service_events s
        join public.service_event_employees m on m.service_event_id=s.id and m.employee_id=effect_row.employee_id and m.workspace='APP'
        where s.id<>event_row.id and s.workspace='APP' and s.status in ('in_service','completed') and not s.is_deleted and s.service_end is not null
          and s.service_start <= ((effect_row.work_date + time '23:59:59') at time zone 'Asia/Manila')
          and s.service_end + interval '10 minutes' >= ((effect_row.work_date + time '08:00') at time zone 'Asia/Manila')
        order by s.service_end desc limit 1;
        if supporting_service_id is not null and not exists(select 1 from public.itc_service_attendance_effects x where x.service_event_id=supporting_service_id and x.undertime_id=effect_row.undertime_id and x.restored_at is null) then
          insert into public.itc_service_attendance_effects(service_event_id,employee_id,work_date,undertime_id) values(supporting_service_id,effect_row.employee_id,effect_row.work_date,effect_row.undertime_id);
        end if;
      end if;
    end if;
    update public.itc_service_attendance_effects set restored_at=now() where id=effect_row.id;
  end loop;

  if event_row.status not in ('in_service','completed') or event_row.is_deleted then return 0; end if;

  for service_employee in
    select membership.employee_id
      from public.service_event_employees as membership
     where membership.service_event_id = event_row.id
       and membership.workspace = 'APP'
  loop
    -- Reconcile only upload-generated Half-Days. HR-created/manual rows remain authoritative.
    for half_day_row in
      select hd.*
        from public.half_day_records as hd
       where hd.workspace = 'APP'
         and hd.employee_id = service_employee.employee_id
         and hd.source_type = 'attendance_upload'
         and hd.absent_period = 'morning'
         and not hd.is_deleted
         and hd.work_date between
             (event_row.service_start at time zone 'Asia/Manila')::date
         and coalesce(
               (event_row.service_end at time zone 'Asia/Manila')::date,
               (event_row.service_start at time zone 'Asia/Manila')::date
         )
         and event_row.service_end is not null
       for update
    loop
      select coalesce(range_agg(tstzrange(s.service_start,s.service_end + interval '10 minutes','[]')), '{}'::tstzmultirange)
             @> tstzrange((half_day_row.work_date + time '08:00') at time zone 'Asia/Manila',
                          (half_day_row.work_date + coalesce(half_day_row.source_time_in,time '13:05:46')) at time zone 'Asia/Manila','[]')
        into coverage_ok
        from public.service_events s
        join public.service_event_employees m on m.service_event_id=s.id and m.employee_id=service_employee.employee_id and m.workspace='APP'
       where s.workspace='APP' and s.status in ('in_service','completed') and not s.is_deleted and s.service_end is not null;
      if coalesce(coverage_ok,false) then
        update public.half_day_records as hd
           set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(), deleted_reason = 'reconciled_by_itc_service'
         where hd.id = half_day_row.id and hd.workspace = 'APP' and not hd.is_deleted;
        if found then
          insert into public.itc_service_attendance_effects(service_event_id,employee_id,work_date,half_day_id)
          values(event_row.id,service_employee.employee_id,half_day_row.work_date,half_day_row.id) on conflict do nothing;
          affected_count := affected_count + 1;
        end if;
      end if;
    end loop;

    -- The text value is validated before casting. Unexpected legacy values are skipped,
    -- so one malformed historical row cannot abort a Service save.
    for undertime_row in
      select gu.*
        from public.generated_undertimes as gu
       where gu.workspace = 'APP'
         and gu.employee_id = service_employee.employee_id
         and not gu.is_deleted
         and gu.work_date between (event_row.service_start at time zone 'Asia/Manila')::date
                              and coalesce((event_row.service_end at time zone 'Asia/Manila')::date,(event_row.service_start at time zone 'Asia/Manila')::date)
         and event_row.service_end is not null
         and nullif(btrim(gu.time_in), '') is not null
         and btrim(gu.time_in) ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
       for update
    loop
      parsed_time := null;
      begin
        parsed_time := btrim(undertime_row.time_in)::time;
      exception
        when invalid_text_representation or datetime_field_overflow then
          parsed_time := null;
      end;

      if parsed_time is not null then
        select coalesce(range_agg(tstzrange(s.service_start,s.service_end + interval '10 minutes','[]')), '{}'::tstzmultirange)
               @> tstzrange((undertime_row.work_date + time '08:00') at time zone 'Asia/Manila',
                            (undertime_row.work_date + parsed_time) at time zone 'Asia/Manila','[]')
          into coverage_ok
          from public.service_events s
          join public.service_event_employees m on m.service_event_id=s.id and m.employee_id=service_employee.employee_id and m.workspace='APP'
         where s.workspace='APP' and s.status in ('in_service','completed') and not s.is_deleted and s.service_end is not null;
        if coalesce(coverage_ok,false) then
          update public.generated_undertimes as gu
             set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(), deleted_reason = 'reconciled_by_itc_service'
           where gu.id = undertime_row.id and gu.workspace = 'APP' and not gu.is_deleted;
          if found then
            insert into public.itc_service_attendance_effects(service_event_id,employee_id,work_date,undertime_id)
            values(event_row.id,service_employee.employee_id,undertime_row.work_date,undertime_row.id) on conflict do nothing;
            affected_count := affected_count + 1;
          end if;
        end if;
      end if;
    end loop;
  end loop;

  return affected_count;
end;
$$;

revoke all on function public.reconcile_itc_service_attendance(uuid) from public, anon;
grant execute on function public.reconcile_itc_service_attendance(uuid) to authenticated;

-- Service saves reconcile after the final membership set is committed in this same transaction.
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
  if p_workspace='WAIS' then perform public.reconcile_main_service_attendance(event_id,true); else perform public.reconcile_itc_service_attendance(event_id); end if;
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
  if p_workspace='WAIS' then perform public.reconcile_main_service_attendance(p_id,true); else perform public.reconcile_itc_service_attendance(p_id); end if;
  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload) values(p_workspace,auth.uid(),'service_event',p_id::text,'update',jsonb_build_object('service_ref',ref,'status',p_status,'service_start',p_service_start,'service_end',p_service_end,'employee_ids',p_employee_ids));
end $$;

-- A selected generated row can add the employee and reconcile atomically; failure rolls back both.
create or replace function public.move_itc_generated_attendance_to_service(p_record_type text,p_record_id text,p_service_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare ev public.service_events%rowtype; emp uuid; d date; changed integer;
begin
  if auth.uid() is null or public.attendance_role()<>'HR' or public.attendance_workspace()<>'APP' then raise exception 'Only APP HR can move generated attendance to Service'; end if;
  select * into ev from public.service_events where id=p_service_id and workspace='APP' and status in ('in_service','completed') and not is_deleted for update;
  if ev.id is null then raise exception 'Eligible APP Service record not found'; end if;
  if p_record_type='half_day' then
    begin
      select employee_id,work_date into emp,d from public.half_day_records where id=p_record_id::uuid and workspace='APP' and source_type='attendance_upload' and absent_period='morning' and not is_deleted for update;
    exception when invalid_text_representation then raise exception 'Invalid generated Half-Day record identifier';
    end;
  elsif p_record_type='undertime' then
    begin
      select employee_id,work_date into emp,d from public.generated_undertimes where id=p_record_id::bigint and workspace='APP' and not is_deleted for update;
    exception when invalid_text_representation then raise exception 'Invalid generated Undertime record identifier';
    end;
  else raise exception 'Unsupported generated attendance type'; end if;
  if emp is null then raise exception 'Active system-generated attendance record not found'; end if;
  if d < (ev.service_start at time zone 'Asia/Manila')::date or d > coalesce((ev.service_end at time zone 'Asia/Manila')::date,(ev.service_start at time zone 'Asia/Manila')::date) then raise exception 'Service does not cover the attendance date'; end if;
  insert into public.service_event_employees(service_event_id,employee_id,workspace) values(ev.id,emp,'APP') on conflict(service_event_id,employee_id) do nothing;
  get diagnostics changed = row_count;
  if changed=1 then insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload) values('APP',auth.uid(),'service_event',ev.id::text,'add_employee_for_generated_attendance',jsonb_build_object('employee_id',emp,'record_type',p_record_type,'record_id',p_record_id)); end if;
  perform public.reconcile_itc_service_attendance(ev.id);
  if p_record_type='half_day' and exists(select 1 from public.half_day_records where id=p_record_id::uuid and not is_deleted) then raise exception 'Selected Service does not qualify to reconcile this Half-Day'; end if;
  if p_record_type='undertime' and exists(select 1 from public.generated_undertimes where id=p_record_id::bigint and not is_deleted) then raise exception 'Selected Service does not qualify to reconcile this Undertime'; end if;
  return 1;
end $$;

-- Also reconcile soft-delete/restore transitions for APP Service rows.
create or replace function public.reconcile_itc_service_event_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.workspace='APP' and current_setting('watts.itc_service_reconcile',true) is distinct from '1' then
    perform set_config('watts.itc_service_reconcile','1',true);
    perform public.reconcile_itc_service_attendance(new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_reconcile_itc_service_event_change on public.service_events;
create trigger trg_reconcile_itc_service_event_change after insert or update of service_start,service_end,status,is_deleted on public.service_events for each row execute function public.reconcile_itc_service_event_change();

-- Membership changes are not service_events updates. Reconcile after each link mutation
-- so removed employees regain eligible rows and remaining members stay reconciled.
create or replace function public.reconcile_itc_service_membership_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare event_id uuid; event_workspace text;
begin
  if tg_op='DELETE' then event_id:=old.service_event_id; event_workspace:=old.workspace;
  else event_id:=new.service_event_id; event_workspace:=new.workspace; end if;
  if event_workspace='APP' then perform public.reconcile_itc_service_attendance(event_id); end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
drop trigger if exists trg_reconcile_itc_service_membership_change on public.service_event_employees;
create trigger trg_reconcile_itc_service_membership_change after insert or delete on public.service_event_employees for each row execute function public.reconcile_itc_service_membership_change();

-- Explicitly roll back APP effects before trashing the Service; WAIS path is unchanged.
create or replace function public.delete_service_event(p_id uuid,p_workspace text)
returns void language plpgsql security definer set search_path='' as $$
declare event_row public.service_events%rowtype;
begin
  perform public.service_require_hr(p_workspace);
  select * into event_row from public.service_events where id=p_id and workspace=p_workspace and not is_deleted for update;
  if event_row.id is null then raise exception 'Service record not found in this workspace'; end if;
  if event_row.workspace='APP' then perform public.reconcile_itc_service_attendance(event_row.id);
  elsif event_row.workspace='WAIS' and event_row.status in ('in_service','completed') then
    perform set_config('watts.service_reconcile','1',true);
    perform public.reconcile_main_service_attendance(event_row.id,false);
  end if;
  update public.service_events set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),updated_by=auth.uid(),updated_at=now() where id=event_row.id;
  insert into public.audit_logs(workspace,actor_id,entity,entity_id,action,payload)
  values(event_row.workspace,auth.uid(),'service_event',event_row.id::text,'delete',jsonb_build_object('service_ref',event_row.service_ref,'status',event_row.status,'service_start',event_row.service_start,'service_end',event_row.service_end));
end $$;

revoke all on function public.create_service_event(text,text,timestamptz,timestamptz,uuid[],text,text,text,text,text),public.update_service_event(uuid,text,text,timestamptz,timestamptz,uuid[],text,text,text,text,text) from public,anon;
grant execute on function public.create_service_event(text,text,timestamptz,timestamptz,uuid[],text,text,text,text,text),public.update_service_event(uuid,text,text,timestamptz,timestamptz,uuid[],text,text,text,text,text) to authenticated;
revoke all on function public.delete_service_event(uuid,text) from public,anon;
grant execute on function public.delete_service_event(uuid,text) to authenticated;

commit;
