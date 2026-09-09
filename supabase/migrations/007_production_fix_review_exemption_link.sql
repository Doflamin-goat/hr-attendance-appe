-- PRODUCTION FIX — NOT APPLIED.
-- This guard prevents a legacy exemption without an exact late_record_id from
-- being approved and accidentally excluding an unrelated late record.
begin;

create or replace function public.review_exemption(p_id bigint,p_status text,p_remarks text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare x public.exemptions%rowtype;
begin
 if auth.uid() is null or public.attendance_role() <> 'Admin' then raise exception 'Only Admin can review exemptions'; end if;
 if p_status not in ('approved','declined') then raise exception 'Invalid review status'; end if;
 select * into x from public.exemptions where id=p_id and not is_deleted for update;
 if x.id is null or x.approval_status <> 'pending' then raise exception 'Pending exemption required'; end if;
 if x.submitted_by=auth.uid() then raise exception 'Self-approval is not allowed'; end if;
 if x.late_record_id is null then raise exception 'Linked late record required'; end if;
 update public.exemptions set approval_status=p_status,reviewed_by=auth.uid(),reviewed_at=now(),review_remarks=nullif(btrim(p_remarks),'') where id=x.id;
end $$;

commit;
