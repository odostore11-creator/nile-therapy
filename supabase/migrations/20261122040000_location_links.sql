-- Location links: every session/visit can carry a map link (Google Maps etc.).
-- Doctors MUST give one when they log a session or book a visit (founders may leave it empty).
-- Visits created from a patient request get a link from the request's map pin automatically.

alter table public.sessions add column location_url text not null default ''
  check (length(location_url) <= 500 and (location_url = '' or location_url ~* '^https://'));
alter table public.appointments add column location_url text not null default ''
  check (length(location_url) <= 500 and (location_url = '' or location_url ~* '^https://'));

grant insert (location_url), update (location_url) on public.sessions to authenticated;
grant insert (location_url), update (location_url) on public.appointments to authenticated;

-- Doctors: a link is required when adding (and when editing their own sessions).
drop policy "doctors add own sessions, founders add for any doctor" on public.sessions;
create policy "doctors add own sessions, founders add for any doctor" on public.sessions
  for insert to authenticated
  with check (((select private.is_founder()) and private.is_doctor(doctor_id))
              or (doctor_id = (select auth.uid()) and (select private.is_active_doctor()) and location_url <> ''));

drop policy "doctors edit own sessions, founders edit all" on public.sessions;
create policy "doctors edit own sessions, founders edit all" on public.sessions
  for update to authenticated
  using ((select private.is_founder())
         or (doctor_id = (select auth.uid()) and (select private.is_active_doctor())))
  with check ((select private.is_founder())
         or (doctor_id = (select auth.uid()) and (select private.is_active_doctor()) and location_url <> ''));

drop policy "doctors book own visits, founders book for any doctor" on public.appointments;
create policy "doctors book own visits, founders book for any doctor" on public.appointments
  for insert to authenticated
  with check (((select private.is_founder()) and private.is_doctor(doctor_id))
              or (doctor_id = (select auth.uid()) and (select private.is_active_doctor()) and location_url <> ''));

-- Patient requests: the booked visit gets a Google Maps link from the pin.
create or replace function private.book_request(r public.patient_requests, doc uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare appt bigint;
begin
  insert into public.appointments (doctor_id, patient_name, location, location_url, session_type, appt_date, appt_time, duration_min, notes)
  values (doc, r.patient_name, coalesce(nullif(r.address, ''), 'Map pin ' || round(r.lat::numeric, 5) || ', ' || round(r.lng::numeric, 5)),
          'https://www.google.com/maps?q=' || round(r.lat::numeric, 6) || ',' || round(r.lng::numeric, 6),
          r.session_type, r.preferred_date, r.preferred_time, r.duration_min,
          trim(both ' ·' from r.notes || case when r.phone <> '' then ' · Tel: ' || r.phone else '' end))
  returning id into appt;
  return appt;
end $$;

update public.appointments a set location_url = 'https://www.google.com/maps?q=' || round(r.lat::numeric, 6) || ',' || round(r.lng::numeric, 6)
  from public.patient_requests r where r.appointment_id = a.id and a.location_url = '';

-- "Mark done" now carries the link into the logged session.
drop function public.complete_appointment(bigint, text, text, date, time, text, integer, text);
create function public.complete_appointment(
  appt_id bigint, p_patient_name text, p_location text, p_session_date date, p_session_time time,
  p_session_type text, p_duration_min integer, p_notes text, p_location_url text default ''
) returns bigint
language plpgsql security invoker set search_path = ''
as $$
declare
  a public.appointments;
  new_id bigint;
begin
  select * into a from public.appointments where id = appt_id for update;
  if not found then raise exception 'Visit not found'; end if;
  if a.status <> 'planned' then raise exception 'This visit is already closed'; end if;
  insert into public.sessions (doctor_id, patient_name, location, location_url, session_date, session_time, session_type, duration_min, notes)
  values (a.doctor_id, p_patient_name, p_location, coalesce(nullif(p_location_url, ''), a.location_url), p_session_date, p_session_time,
          coalesce(p_session_type, ''), p_duration_min, coalesce(p_notes, ''))
  returning id into new_id;
  update public.appointments set status = 'done', session_id = new_id where id = appt_id;
  return new_id;
end $$;
revoke all on function public.complete_appointment(bigint, text, text, date, time, text, integer, text, text) from public, anon;
grant execute on function public.complete_appointment(bigint, text, text, date, time, text, integer, text, text) to authenticated;
