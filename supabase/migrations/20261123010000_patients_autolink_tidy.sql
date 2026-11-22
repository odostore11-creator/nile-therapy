-- Patients list, automatic linking of logged sessions to booked visits, cancelled visits going back
-- to the founders, offline-safe session logging, and database tidy-ups.
--
--  * patients: one row per patient (name, optional phone, why they come: condition/complaint).
--    Founders see all. Doctors see patients they created or have a session/visit with.
--    Sessions, visits and patient requests point to a patient (patient_id, optional; the typed
--    patient_name stays as the display name so older rows keep working).
--  * A session logged directly (not with "Mark done") closes the matching planned visit
--    (same doctor, same day, same patient), so the schedule and the 5-a-day count stay right.
--  * Cancelling or deleting a visit that came from a patient request sends that request back
--    to the founders (reason 'visit_cancelled') instead of leaving it "booked" with no visit.
--  * sessions.client_ref: a random id from the browser, so a session sent twice (offline retry,
--    double tap) is stored once.
--  * Change history now also covers patients, patient requests and doctor areas.

-- ---------- patients ----------
create table public.patients (
  id          bigint generated always as identity primary key,
  full_name   text not null check (length(trim(full_name)) between 1 and 120),
  phone       text not null default '' check (length(phone) <= 40),
  condition   text not null default '' check (length(condition) <= 500),  -- why they come: symptom / diagnosis
  notes       text not null default '' check (length(notes) <= 2000),
  created_by  uuid references public.profiles (id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);
create index patients_name_idx on public.patients (lower(full_name));
create index patients_created_by_idx on public.patients (created_by);
create trigger patients_touch_updated_at before update on public.patients
  for each row execute function private.touch_updated_at();

alter table public.sessions add column patient_id bigint references public.patients (id) on delete set null;
alter table public.appointments add column patient_id bigint references public.patients (id) on delete set null;
alter table public.patient_requests add column patient_id bigint references public.patients (id) on delete set null;
alter table public.patient_requests add column condition text not null default '' check (length(condition) <= 500);
create index sessions_patient_idx on public.sessions (patient_id);
create index appointments_patient_idx on public.appointments (patient_id);
create index patient_requests_patient_idx on public.patient_requests (patient_id);

grant insert (patient_id), update (patient_id) on public.sessions to authenticated;
grant insert (patient_id), update (patient_id) on public.appointments to authenticated;

-- Can the caller see this patient? Founders: always. Doctors: if they created it or treat them.
create function private.can_see_patient(pid bigint) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_founder() or (private.is_active_doctor() and exists (
    select 1 from public.patients p where p.id = pid and (
      p.created_by = auth.uid()
      or exists (select 1 from public.sessions s where s.patient_id = pid and s.doctor_id = auth.uid())
      or exists (select 1 from public.appointments a where a.patient_id = pid and a.doctor_id = auth.uid()))))
$$;
revoke all on function private.can_see_patient(bigint) from public;
grant execute on function private.can_see_patient(bigint) to authenticated;

revoke all on public.patients from anon, authenticated;
grant all on public.patients to service_role;
grant select, delete on public.patients to authenticated;
grant insert (full_name, phone, condition, notes), update (full_name, phone, condition, notes) on public.patients to authenticated;
alter table public.patients enable row level security;
create policy "founders see all patients, doctors their own" on public.patients for select to authenticated
  using ((select private.can_see_patient(id)));
create policy "founders and doctors add patients" on public.patients for insert to authenticated
  with check ((select private.is_founder()) or ((select private.is_active_doctor()) and created_by = (select auth.uid())));
create policy "founders and their doctors edit patients" on public.patients for update to authenticated
  using ((select private.can_see_patient(id))) with check ((select private.can_see_patient(id)));
create policy "founders remove patients" on public.patients for delete to authenticated
  using ((select private.is_founder()));

-- Nobody can attach a session/visit to a patient they can't see (that would reveal the patient).
create policy "only patients you can see (insert)" on public.sessions as restrictive for insert to authenticated
  with check (patient_id is null or private.can_see_patient(patient_id));
create policy "only patients you can see (update)" on public.sessions as restrictive for update to authenticated
  using (true) with check (patient_id is null or private.can_see_patient(patient_id));
create policy "only patients you can see (insert)" on public.appointments as restrictive for insert to authenticated
  with check (patient_id is null or private.can_see_patient(patient_id));
create policy "only patients you can see (update)" on public.appointments as restrictive for update to authenticated
  using (true) with check (patient_id is null or private.can_see_patient(patient_id));

-- Existing rows: one patient per distinct name (case/spacing ignored), then link.
insert into public.patients (full_name, created_by)
select distinct on (lower(regexp_replace(trim(n), '\s+', ' ', 'g'))) regexp_replace(trim(n), '\s+', ' ', 'g'), null
  from (select patient_name n from public.sessions union all select patient_name from public.appointments
        union all select patient_name from public.patient_requests) x;
update public.sessions s set patient_id = p.id from public.patients p
 where s.patient_id is null and lower(regexp_replace(trim(s.patient_name), '\s+', ' ', 'g')) = lower(p.full_name);
update public.appointments a set patient_id = p.id from public.patients p
 where a.patient_id is null and lower(regexp_replace(trim(a.patient_name), '\s+', ' ', 'g')) = lower(p.full_name);
update public.patient_requests r set patient_id = p.id from public.patients p
 where r.patient_id is null and lower(regexp_replace(trim(r.patient_name), '\s+', ' ', 'g')) = lower(p.full_name);
update public.patients p set phone = r.phone from public.patient_requests r where r.patient_id = p.id and p.phone = '' and r.phone <> '';

-- ---------- offline-safe logging ----------
alter table public.sessions add column client_ref uuid;
create unique index sessions_client_ref_idx on public.sessions (client_ref) where client_ref is not null;
grant insert (client_ref) on public.sessions to authenticated;

-- ---------- a logged session closes the matching planned visit ----------
create function private.autolink_session() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare appt public.appointments;
begin
  if coalesce(current_setting('nile.completing', true), '') = '1' then return new; end if;  -- "Mark done" links it itself
  select * into appt from public.appointments a
   where a.doctor_id = new.doctor_id and a.appt_date = new.session_date and a.status = 'planned' and a.session_id is null
     and ((new.patient_id is not null and a.patient_id = new.patient_id)
       or lower(regexp_replace(trim(a.patient_name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(new.patient_name), '\s+', ' ', 'g')))
   order by abs(extract(epoch from (coalesce(a.appt_time, new.session_time, time '00:00') - coalesce(new.session_time, a.appt_time, time '00:00'))))
   limit 1;
  if appt.id is not null then
    update public.appointments set status = 'done', session_id = new.id, patient_id = coalesce(patient_id, new.patient_id) where id = appt.id;
    if new.patient_id is null and appt.patient_id is not null then
      update public.sessions set patient_id = appt.patient_id where id = new.id;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.autolink_session() from public;
create trigger sessions_autolink after insert on public.sessions
  for each row execute function private.autolink_session();

-- "Mark done" now carries the patient too, and tells the trigger not to link a second visit.
create or replace function public.complete_appointment(
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
  perform set_config('nile.completing', '1', true);
  insert into public.sessions (doctor_id, patient_id, patient_name, location, location_url, session_date, session_time, session_type, duration_min, notes)
  values (a.doctor_id, a.patient_id, p_patient_name, p_location, coalesce(nullif(p_location_url, ''), a.location_url), p_session_date, p_session_time,
          coalesce(p_session_type, ''), p_duration_min, coalesce(p_notes, ''))
  returning id into new_id;
  perform set_config('nile.completing', '', true);
  update public.appointments set status = 'done', session_id = new_id where id = appt_id;
  return new_id;
end $$;

-- ---------- a cancelled/deleted visit sends its patient request back to the founders ----------
alter table public.patient_requests drop constraint patient_requests_reason_check;
alter table public.patient_requests add constraint patient_requests_reason_check
  check (reason in ('', 'nearest_full', 'no_area', 'out_of_area', 'visit_cancelled'));

create function private.visit_closed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or (new.status = 'cancelled' and old.status <> 'cancelled') then
    update public.patient_requests
       set status = 'open', reason = 'visit_cancelled', assigned_doctor_id = null, appointment_id = null, opened_at = now(), resolved_at = null
     where appointment_id = old.id and status in ('assigned', 'claimed', 'founder_assigned');
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.visit_closed() from public;
create trigger appointments_closed_update after update of status on public.appointments
  for each row execute function private.visit_closed();
create trigger appointments_closed_delete before delete on public.appointments
  for each row execute function private.visit_closed();

-- Doctors don't see (or take) requests that went back to the founders.
drop policy "founders see all requests; doctors see open ones they have room for, and their own" on public.patient_requests;
create policy "founders see all requests; doctors see open ones they have room for, and their own" on public.patient_requests
  for select to authenticated
  using ((select private.is_founder())
      or ((select private.is_active_doctor()) and (
            assigned_doctor_id = (select auth.uid())
         or (status = 'open' and reason not in ('out_of_area', 'visit_cancelled') and opened_at > now() - private.open_window()
             and private.day_load((select auth.uid()), preferred_date) < private.daily_limit()))));

create or replace function public.claim_patient_request(req_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.patient_requests; me uuid := auth.uid();
begin
  if not private.is_active_doctor() then raise exception 'Only doctors can take patients'; end if;
  select * into r from public.patient_requests where id = req_id for update;
  if not found or r.status <> 'open' then raise exception 'This patient was already taken'; end if;
  if r.reason in ('out_of_area', 'visit_cancelled') or r.opened_at <= now() - private.open_window() then raise exception 'This request has passed to the founders'; end if;
  if private.day_load(me, r.preferred_date) >= private.daily_limit() then raise exception 'You already have 5 visits that day'; end if;
  update public.patient_requests set status = 'claimed', assigned_doctor_id = me, appointment_id = private.book_request(r, me), resolved_at = now()
   where id = req_id;
  return jsonb_build_object('id', req_id, 'status', 'claimed');
end $$;

create or replace function public.open_requests_for_me() returns table (id bigint, patient_name text, phone text, address text, lat double precision,
  lng double precision, preferred_date date, preferred_time time, session_type text, duration_min integer, notes text, opened_at timestamptz, km numeric)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.patient_name, r.phone, r.address, r.lat, r.lng, r.preferred_date, r.preferred_time, r.session_type, r.duration_min, r.notes, r.opened_at,
         round((extensions.st_distance(a.geom::extensions.geography,
                extensions.st_setsrid(extensions.st_makepoint(r.lng, r.lat), 4326)::extensions.geography) / 1000)::numeric, 1)
    from public.patient_requests r
    left join public.doctor_areas a on a.doctor_id = auth.uid()
   where private.is_active_doctor() and r.status = 'open' and r.reason not in ('out_of_area', 'visit_cancelled') and r.opened_at > now() - private.open_window()
     and private.day_load(auth.uid(), r.preferred_date) < private.daily_limit()
   order by 13 nulls last, r.opened_at
$$;

-- Requests now carry a patient (existing one, or a new one made from the request) and their condition.
create or replace function private.book_request(r public.patient_requests, doc uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare appt bigint;
begin
  insert into public.appointments (doctor_id, patient_id, patient_name, location, location_url, session_type, appt_date, appt_time, duration_min, notes)
  values (doc, r.patient_id, r.patient_name, coalesce(nullif(r.address, ''), 'Map pin ' || round(r.lat::numeric, 5) || ', ' || round(r.lng::numeric, 5)),
          'https://www.google.com/maps?q=' || round(r.lat::numeric, 6) || ',' || round(r.lng::numeric, 6),
          r.session_type, r.preferred_date, r.preferred_time, r.duration_min,
          trim(both ' ·' from r.notes || case when r.phone <> '' then ' · Tel: ' || r.phone else '' end))
  returning id into appt;
  return appt;
end $$;

create or replace function public.create_patient_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare new_id bigint; r public.patient_requests; pid bigint := nullif(p ->> 'patient_id', '')::bigint;
begin
  if not (private.is_founder() or (select auth.role()) = 'service_role') then raise exception 'Only founders can do this'; end if;
  if pid is not null and not exists (select 1 from public.patients where id = pid) then raise exception 'Patient not found'; end if;
  if pid is null then
    insert into public.patients (full_name, phone, condition)
    values (trim(p ->> 'patient_name'), coalesce(trim(p ->> 'phone'), ''), coalesce(trim(p ->> 'condition'), ''))
    returning id into pid;
  end if;
  insert into public.patient_requests (patient_id, patient_name, phone, address, lat, lng, preferred_date, preferred_time, session_type, duration_min, notes, condition, source)
  values (pid, trim(p ->> 'patient_name'), coalesce(trim(p ->> 'phone'), ''), coalesce(trim(p ->> 'address'), ''),
          (p ->> 'lat')::float, (p ->> 'lng')::float, (p ->> 'preferred_date')::date, nullif(p ->> 'preferred_time', '')::time,
          coalesce(p ->> 'session_type', ''), coalesce(nullif(p ->> 'duration_min', '')::int, 45), coalesce(trim(p ->> 'notes'), ''),
          coalesce(trim(p ->> 'condition'), ''), coalesce(nullif(p ->> 'source', ''), 'manual'))
  returning id into new_id;
  perform private.route_request(new_id);
  select * into r from public.patient_requests where id = new_id;
  return jsonb_build_object('id', r.id, 'status', r.status, 'reason', r.reason, 'doctor_id', coalesce(r.assigned_doctor_id, r.nearest_doctor_id),
                            'nearest_km', r.nearest_km, 'appointment_id', r.appointment_id, 'patient_id', pid);
end $$;

-- ---------- "new patients" in the monthly report, without downloading every session ----------
-- For each patient seen in [p_from, p_to]: the date of their first session ever. Uses the caller's RLS.
create function public.patient_first_seen(p_from date, p_to date) returns table (patient_key text, first_date date)
language sql stable security invoker set search_path = ''
as $$
  with k as (select coalesce('p' || patient_id, 'n' || lower(regexp_replace(trim(patient_name), '\s+', ' ', 'g'))) as key, session_date from public.sessions),
       m as (select distinct key from k where session_date between p_from and p_to)
  select k.key, min(k.session_date) from k join m using (key) group by k.key
$$;
revoke all on function public.patient_first_seen(date, date) from public, anon;
grant execute on function public.patient_first_seen(date, date) to authenticated;

-- ---------- change history covers more tables ----------
alter table public.change_log drop constraint change_log_table_name_check;
alter table public.change_log add constraint change_log_table_name_check
  check (table_name in ('sessions', 'appointments', 'profiles', 'patients', 'patient_requests', 'doctor_areas'));

create or replace function private.log_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'geom' end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'geom' end;
begin
  if tg_op = 'UPDATE' and (o - 'updated_at') = (n - 'updated_at') then return new; end if;
  insert into public.change_log (table_name, row_id, action, actor_id, old_data, new_data)
  values (tg_table_name, coalesce(n ->> 'id', o ->> 'id', n ->> 'doctor_id', o ->> 'doctor_id'), lower(tg_op), auth.uid(), o, n);
  return coalesce(new, old);
end $$;

create trigger patients_log after insert or update or delete on public.patients
  for each row execute function private.log_change();
create trigger patient_requests_log after insert or update on public.patient_requests
  for each row execute function private.log_change();
create trigger doctor_areas_log after insert or update or delete on public.doctor_areas
  for each row execute function private.log_change();

-- ---------- tidy-ups: indexes for foreign keys, drop an unused one ----------
create index ai_actions_message_idx on public.ai_actions (message_id);
create index appointments_created_by_idx on public.appointments (created_by);
create index appointments_session_idx on public.appointments (session_id);
create index patient_requests_appointment_idx on public.patient_requests (appointment_id);
create index patient_requests_assigned_idx on public.patient_requests (assigned_doctor_id);
create index patient_requests_created_by_idx on public.patient_requests (created_by);
create index patient_requests_nearest_idx on public.patient_requests (nearest_doctor_id);
drop index public.change_log_created_idx;
