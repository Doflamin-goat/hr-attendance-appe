begin;

alter table public.employees add column if not exists profile_photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-profile-pictures', 'employee-profile-pictures', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=2097152, allowed_mime_types=array['image/jpeg','image/png','image/webp'];

create policy "employee photos scoped read" on storage.objects for select to authenticated
using (bucket_id='employee-profile-pictures' and (storage.foldername(name))[1]='employees' and exists (
  select 1 from public.employees e where e.id::text=(storage.foldername(name))[2] and e.hr_scope=public.attendance_hr_scope() and public.attendance_role() in ('HR','Admin')
));
create policy "employee photos scoped HR insert" on storage.objects for insert to authenticated
with check (bucket_id='employee-profile-pictures' and (storage.foldername(name))[1]='employees' and exists (
  select 1 from public.employees e where e.id::text=(storage.foldername(name))[2] and e.hr_scope=public.attendance_hr_scope() and public.attendance_role()='HR'
));
create policy "employee photos scoped HR update" on storage.objects for update to authenticated
using (bucket_id='employee-profile-pictures' and (storage.foldername(name))[1]='employees' and exists (
  select 1 from public.employees e where e.id::text=(storage.foldername(name))[2] and e.hr_scope=public.attendance_hr_scope() and public.attendance_role()='HR'
)) with check (bucket_id='employee-profile-pictures' and (storage.foldername(name))[1]='employees' and exists (
  select 1 from public.employees e where e.id::text=(storage.foldername(name))[2] and e.hr_scope=public.attendance_hr_scope() and public.attendance_role()='HR'
));
create policy "employee photos scoped HR delete" on storage.objects for delete to authenticated
using (bucket_id='employee-profile-pictures' and (storage.foldername(name))[1]='employees' and exists (
  select 1 from public.employees e where e.id::text=(storage.foldername(name))[2] and e.hr_scope=public.attendance_hr_scope() and public.attendance_role()='HR'
));

commit;
