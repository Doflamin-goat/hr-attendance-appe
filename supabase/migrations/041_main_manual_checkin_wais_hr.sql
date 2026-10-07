-- MAIN/WAIS HR manual check-in correction. Forward-only; do not apply automatically.
begin;

alter table public.main_daily_attendance
  add column if not exists biometric_first_in time,
  add column if not exists first_in_source text not null default 'biometric',
  add column if not exists manual_first_in_by uuid references auth.users(id),
  add column if not exists manual_first_in_at timestamptz,
  add column if not exists manual_first_in_note text;

alter table public.main_daily_attendance drop constraint if exists main_daily_first_in_source_check;
alter table public.main_daily_attendance add constraint main_daily_first_in_source_check
  check (first_in_source in ('biometric','manual'));

update public.main_daily_attendance
set biometric_first_in = coalesce(biometric_first_in, first_in),
    first_in_source = coalesce(first_in_source, 'biometric')
where biometric_first_in is null or first_in_source is null;

create or replace function public.preserve_main_biometric_first_in()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Imports do not change the manual audit timestamp, so preserve an existing
  -- correction. A later manual RPC update does change that timestamp and is
  -- therefore allowed to replace the effective First In again.
  if tg_op = 'UPDATE'
     and old.first_in_source = 'manual'
     and new.manual_first_in_at is not distinct from old.manual_first_in_at
     and new.manual_first_in_by is not distinct from old.manual_first_in_by then
    new.first_in := old.first_in;
    new.first_in_source := 'manual';
    new.biometric_first_in := old.biometric_first_in;
    new.manual_first_in_by := old.manual_first_in_by;
    new.manual_first_in_at := old.manual_first_in_at;
    new.manual_first_in_note := old.manual_first_in_note;
  elsif new.first_in_source = 'biometric' then
    new.biometric_first_in := coalesce(new.biometric_first_in, new.first_in);
  end if;
  return new;
end $$;

drop trigger if exists main_biometric_first_in_guard on public.main_daily_attendance;
create trigger main_biometric_first_in_guard
before insert or update on public.main_daily_attendance
for each row execute function public.preserve_main_biometric_first_in();

create or replace function public.set_main_manual_checkin(
  p_record_id uuid,
  p_checkin_time time,
  p_note text default null
) returns void language plpgsql security definer set search_path='' as $$
declare
  a public.main_daily_attendance%rowtype;
  original_first_in time;
  dow integer;
  minute_in integer;
  start_min integer;
  grace_end integer;
  late_end integer;
  half_start integer;
  half_end integer;
  late_min integer := 0;
  late_sec integer := 0;
  is_half boolean := false;
  source_file_id public.uploaded_files.id%type;
begin
  -- The legacy nullable forms public.attendance_role() <> 'HR' and
  -- public.attendance_hr_scope() <> 'MAIN' are intentionally replaced below
  -- with NULL-safe IS DISTINCT FROM authorization checks.
  if auth.uid() is null
     or public.attendance_role() is distinct from 'HR'
     or public.attendance_hr_scope() is distinct from 'MAIN'
     or public.attendance_workspace() is distinct from 'WAIS' then
    raise exception 'MAIN HR access required';
  end if;
  if p_checkin_time is null then
    raise exception 'A valid MAIN check-in time is required';
  end if;

  select * into a
  from public.main_daily_attendance
  where id = p_record_id
    and workspace = 'WAIS'
    and employee_id is not null
    and not is_deleted
  for update;
  if a.id is null then raise exception 'MAIN attendance record not found'; end if;

  if not exists (
    select 1 from public.employees e
    where e.id = a.employee_id and e.workspace = 'WAIS' and e.hr_scope = 'MAIN'
      and not e.is_deleted
  ) then
    raise exception 'MAIN employee is outside the authorized scope';
  end if;

  original_first_in := coalesce(a.biometric_first_in, a.first_in);
  dow := extract(dow from a.work_date)::integer;
  minute_in := extract(hour from p_checkin_time)::integer * 60
    + extract(minute from p_checkin_time)::integer;
  if dow = 6 then
    start_min := 420; grace_end := 425; late_end := 479;
    half_start := 651; half_end := 660;
  elsif dow between 1 and 5 then
    start_min := 480; grace_end := 485; late_end := 539;
    half_start := 711; half_end := 780;
  else
    start_min := 0; grace_end := -1; late_end := -1;
    half_start := -1; half_end := -1;
  end if;
  if minute_in > grace_end and minute_in <= late_end then
    late_min := minute_in - start_min;
    late_sec := extract(second from p_checkin_time)::integer;
  end if;
  is_half := minute_in between half_start and half_end;

  update public.main_daily_attendance
  set first_in = p_checkin_time,
      biometric_first_in = original_first_in,
      first_in_source = 'manual',
      manual_first_in_by = auth.uid(),
      manual_first_in_at = now(),
      manual_first_in_note = nullif(btrim(p_note),''),
      late_minutes = late_min,
      late_seconds = late_sec,
      is_half_day = is_half,
      status = case when last_out is null then 'missing_checkout' else 'complete' end,
      updated_at = now()
  where id = a.id;

  select a.source_file_id into source_file_id;

  -- Only upload-derived late rows tied to this attendance source are
  -- recalculated. Manual HR late entries have no upload provenance and remain
  -- untouched. Reviewed exemption history stays linked to its original late;
  -- actionable pending requests are closed as declined with an audit remark so
  -- they cannot approve a deleted/replaced generated late.
  perform set_config('app.approval_review', '1', true);
  with generated_lates as (
    select id
    from public.late_records
    where workspace = 'WAIS' and work_date = a.work_date and not is_deleted
      and (employee_id = a.employee_id or
        (employee_id is null and public.employee_name_key(employee_name) = public.employee_name_key(a.employee_name)))
      and ((source_file_id is not null and source_file_id = a.source_file_id::text)
        or (source_file_id is null and source_file_name is not null and source_file_name = a.source_file_name))
  )
  update public.exemptions x
  set approval_status = 'declined',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_remarks = concat_ws('; ', nullif(x.review_remarks, ''), 'Closed because the generated Late Record was replaced by a manual Check-In correction')
  where x.late_record_id in (select id from generated_lates)
    and x.approval_status = 'pending'
    and not x.is_deleted;

  update public.late_records
  set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
      deleted_reason = 'MAIN manual check-in corrected'
  where workspace = 'WAIS' and work_date = a.work_date
    and not is_deleted
    and (employee_id = a.employee_id or
      (employee_id is null and public.employee_name_key(employee_name) = public.employee_name_key(a.employee_name)))
    and ((source_file_id is not null and source_file_id = a.source_file_id::text)
      or (source_file_id is null and source_file_name is not null and source_file_name = a.source_file_name));
  if late_min > 0 then
    insert into public.late_records(
      workspace, employee_id, employee_name, work_date, time_in,
      minutes_late, seconds_late, total_seconds_late, source_file_id, source_file_name
    ) values (
      'WAIS', a.employee_id, a.employee_name, a.work_date, p_checkin_time,
      late_min, late_sec, late_min * 60 + late_sec, source_file_id::text, a.source_file_name
    );
  end if;

  update public.half_day_records
  set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
      deleted_reason = 'MAIN manual check-in corrected'
  where workspace = 'WAIS' and employee_id = a.employee_id
    and work_date = a.work_date and source_type = 'attendance_upload' and not is_deleted;
  if is_half and not exists (
    select 1 from public.half_day_records
    where workspace = 'WAIS' and employee_id = a.employee_id and work_date = a.work_date
      and absent_period = 'morning' and source_type = 'manual' and not is_deleted
  ) then
    insert into public.half_day_records(
      workspace, employee_id, employee_name, work_date, absent_period,
      scheduled_start, scheduled_end, reason, created_by, source_type,
      source_file_name, source_file_id, source_time_in
    ) values (
      'WAIS', a.employee_id, a.employee_name, a.work_date, 'morning',
      case when dow = 6 then time '07:00' else time '08:00' end,
      case when dow = 6 then time '11:00' else time '12:00' end,
      'Generated from MAIN manual check-in', auth.uid(), 'attendance_upload',
      a.source_file_name, source_file_id, p_checkin_time
    );
  end if;

  update public.absences
  set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
      deleted_reason = 'MAIN manual check-in corrected'
  where workspace = 'WAIS' and employee_id = a.employee_id
    and work_date = a.work_date and source_type = 'system_generated' and not is_deleted;

  insert into public.audit_logs(workspace, actor_id, entity, entity_id, action, payload)
  values (
    'WAIS', auth.uid(), 'main_daily_attendance', a.id::text, 'manual_checkin',
    jsonb_build_object(
      'original_biometric_first_in', original_first_in,
      'effective_first_in', p_checkin_time,
      'note', nullif(btrim(p_note),'')
    )
  );
end $$;

revoke all on function public.set_main_manual_checkin(uuid,time,text) from public, anon;
grant execute on function public.set_main_manual_checkin(uuid,time,text) to authenticated;

commit;
