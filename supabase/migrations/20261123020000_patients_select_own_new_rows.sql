-- A doctor must be able to read back a patient row they just inserted (insert ... returning):
-- the helper function can't see the new row inside the same statement, so check created_by directly.
drop policy "founders see all patients, doctors their own" on public.patients;
create policy "founders see all patients, doctors their own" on public.patients for select to authenticated
  using (((select private.is_active_doctor()) and created_by = (select auth.uid())) or (select private.can_see_patient(id)));
