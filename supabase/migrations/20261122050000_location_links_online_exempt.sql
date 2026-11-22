-- Online (video) sessions/visits have no place to link to, so doctors don't need a map link for them.
drop policy "doctors add own sessions, founders add for any doctor" on public.sessions;
create policy "doctors add own sessions, founders add for any doctor" on public.sessions
  for insert to authenticated
  with check (((select private.is_founder()) and private.is_doctor(doctor_id))
              or (doctor_id = (select auth.uid()) and (select private.is_active_doctor()) and (location_url <> '' or session_type = 'Online')));

drop policy "doctors edit own sessions, founders edit all" on public.sessions;
create policy "doctors edit own sessions, founders edit all" on public.sessions
  for update to authenticated
  using ((select private.is_founder())
         or (doctor_id = (select auth.uid()) and (select private.is_active_doctor())))
  with check ((select private.is_founder())
         or (doctor_id = (select auth.uid()) and (select private.is_active_doctor()) and (location_url <> '' or session_type = 'Online')));

drop policy "doctors book own visits, founders book for any doctor" on public.appointments;
create policy "doctors book own visits, founders book for any doctor" on public.appointments
  for insert to authenticated
  with check (((select private.is_founder()) and private.is_doctor(doctor_id))
              or (doctor_id = (select auth.uid()) and (select private.is_active_doctor()) and (location_url <> '' or session_type = 'Online')));
