-- READ-ONLY preview for the separately approved historical Saturday correction.
-- This script intentionally contains SELECT statements only and must not be applied as a migration.
with candidate as (
  select lr.id as request_id, lr.employee_id, lr.employee_name, lr.leave_date,
         lr.duration_minutes as existing_duration_minutes, 450 as corrected_duration_minutes,
         lr.status, lr.workspace,
         case when extract(dow from lr.leave_date)=6
                   and lr.start_time=time '07:00' and lr.end_time=time '15:15'
                   and lr.duration_minutes <> 450 then true else false end as affected
  from public.leave_requests lr
  where extract(dow from lr.leave_date)=6
    and lr.start_time=time '07:00' and lr.end_time=time '15:15'
    and not lr.is_deleted
)
select c.*, (c.corrected_duration_minutes-c.existing_duration_minutes) as duration_delta_minutes,
       a.adjustment_minutes as manual_adjustment_minutes
from candidate c
left join public.employee_leave_adjustments a
  on a.employee_id=c.employee_id and a.leave_year=extract(year from c.leave_date)::integer
where c.affected
order by c.leave_date, c.employee_name;
