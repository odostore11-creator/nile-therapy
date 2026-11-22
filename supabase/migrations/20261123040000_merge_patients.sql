-- Founders merge two records of the same person: everything moves to the one kept, the other is removed.
create function public.merge_patients(src bigint, dst bigint) returns void
language plpgsql security definer set search_path = ''
as $$
declare a public.patients; b public.patients;
begin
  if not private.is_founder() then raise exception 'Only founders can do this'; end if;
  if src = dst then raise exception 'Pick a different patient'; end if;
  select * into a from public.patients where id = src for update;
  select * into b from public.patients where id = dst for update;
  if a.id is null or b.id is null then raise exception 'Patient not found'; end if;
  update public.sessions set patient_id = dst where patient_id = src;
  update public.appointments set patient_id = dst where patient_id = src;
  update public.patient_requests set patient_id = dst where patient_id = src;
  update public.patients set phone = case when phone = '' then a.phone else phone end,
         condition = case when condition = '' then a.condition else condition end,
         notes = trim(both E'\n' from notes || case when a.notes <> '' then E'\n' || a.notes else '' end)
   where id = dst;
  delete from public.patients where id = src;
end $$;
revoke all on function public.merge_patients(bigint, bigint) from public, anon;
grant execute on function public.merge_patients(bigint, bigint) to authenticated;
