-- Bookings from the public website (niletherapy.org) arrive as patient requests (source 'website').
--  * A website booking may have no map pin: lat/lng are now optional. Without a pin the request
--    goes straight to the founders (reason 'no_location'); doctors never see those.
--  * Extra booking details: governorate, preferred time of day (slot), chosen service, language,
--    and a hash of the sender's IP (for rate limiting only; the IP itself is never stored).
--  * Only the Edge Function `submit-booking` (service role) creates website bookings.

alter table public.patient_requests alter column lat drop not null, alter column lng drop not null;
alter table public.patient_requests
  add column governorate text not null default '' check (length(governorate) <= 40),
  add column preferred_slot text not null default '' check (preferred_slot in ('', 'any', 'morning', 'afternoon', 'evening')),
  add column service text not null default '' check (length(service) <= 40),
  add column lang text not null default '' check (lang in ('', 'ar', 'en')),
  add column ip_hash text check (length(ip_hash) <= 80);
create index patient_requests_ip_idx on public.patient_requests (ip_hash, created_at) where ip_hash is not null;
create index patient_requests_phone_idx on public.patient_requests (phone, created_at);

alter table public.patient_requests drop constraint patient_requests_reason_check;
alter table public.patient_requests add constraint patient_requests_reason_check
  check (reason in ('', 'nearest_full', 'no_area', 'out_of_area', 'visit_cancelled', 'no_location'));

-- Routing: no pin -> founders.
create or replace function private.route_request(req_id bigint) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.patient_requests; pt extensions.geometry; best record;
begin
  select * into r from public.patient_requests where id = req_id for update;
  if r.lat is null or r.lng is null then
    update public.patient_requests set status = 'open', reason = 'no_location', opened_at = now() where id = req_id;
    return;
  end if;
  pt := extensions.st_setsrid(extensions.st_makepoint(r.lng, r.lat), 4326);
  select a.doctor_id,
         extensions.st_distance(a.geom::extensions.geography, pt::extensions.geography) / 1000 as km,
         extensions.st_distance(extensions.st_centroid(a.geom)::extensions.geography, pt::extensions.geography) as to_middle
    into best
    from public.doctor_areas a join public.profiles d on d.id = a.doctor_id and d.role = 'doctor' and d.active
   order by 2, 3 limit 1;
  if best.doctor_id is null then
    update public.patient_requests set status = 'open', reason = 'no_area', opened_at = now() where id = req_id;
  elsif best.km > private.max_outside_km() then
    update public.patient_requests set status = 'open', reason = 'out_of_area', nearest_doctor_id = best.doctor_id,
           nearest_km = round(best.km::numeric, 2), opened_at = now() where id = req_id;
  elsif private.day_load(best.doctor_id, r.preferred_date) < private.daily_limit() then
    update public.patient_requests set status = 'assigned', reason = '', nearest_doctor_id = best.doctor_id, nearest_km = round(best.km::numeric, 2),
           assigned_doctor_id = best.doctor_id, appointment_id = private.book_request(r, best.doctor_id), resolved_at = now()
     where id = req_id;
  else
    update public.patient_requests set status = 'open', reason = 'nearest_full', nearest_doctor_id = best.doctor_id,
           nearest_km = round(best.km::numeric, 2), opened_at = now() where id = req_id;
  end if;
end $$;

-- The booked visit carries everything the doctor needs (address, governorate, time of day, service, phone, complaint).
create or replace function private.book_request(r public.patient_requests, doc uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare appt bigint;
begin
  insert into public.appointments (doctor_id, patient_id, patient_name, location, location_url, session_type, appt_date, appt_time, duration_min, notes)
  values (doc, r.patient_id, r.patient_name,
          left(coalesce(nullif(concat_ws(', ', nullif(r.address, ''), nullif(r.governorate, '')), ''),
                        'Map pin ' || round(r.lat::numeric, 5) || ', ' || round(r.lng::numeric, 5), ''), 200),
          case when r.lat is null then '' else 'https://www.google.com/maps?q=' || round(r.lat::numeric, 6) || ',' || round(r.lng::numeric, 6) end,
          r.session_type, r.preferred_date, r.preferred_time, r.duration_min,
          left(trim(both ' ·' from concat_ws(' · ', nullif(r.notes, ''), case when r.phone <> '' then 'Tel: ' || r.phone end,
               case when r.preferred_slot not in ('', 'any') then 'Time: ' || r.preferred_slot end,
               case when r.service <> '' then 'Service: ' || r.service end)), 2000))
  returning id into appt;
  return appt;
end $$;

-- Doctors never see or take requests without a pin (founders handle them).
drop policy "founders see all requests; doctors see open ones they have room for, and their own" on public.patient_requests;
create policy "founders see all requests; doctors see open ones they have room for, and their own" on public.patient_requests
  for select to authenticated
  using ((select private.is_founder())
      or ((select private.is_active_doctor()) and (
            assigned_doctor_id = (select auth.uid())
         or (status = 'open' and reason not in ('out_of_area', 'visit_cancelled', 'no_location') and opened_at > now() - private.open_window()
             and private.day_load((select auth.uid()), preferred_date) < private.daily_limit()))));

create or replace function public.claim_patient_request(req_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.patient_requests; me uuid := auth.uid();
begin
  if not private.is_active_doctor() then raise exception 'Only doctors can take patients'; end if;
  select * into r from public.patient_requests where id = req_id for update;
  if not found or r.status <> 'open' then raise exception 'This patient was already taken'; end if;
  if r.reason in ('out_of_area', 'visit_cancelled', 'no_location') or r.opened_at <= now() - private.open_window() then raise exception 'This request has passed to the founders'; end if;
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
   where private.is_active_doctor() and r.status = 'open' and r.reason not in ('out_of_area', 'visit_cancelled', 'no_location')
     and r.lat is not null and r.opened_at > now() - private.open_window()
     and private.day_load(auth.uid(), r.preferred_date) < private.daily_limit()
   order by 13 nulls last, r.opened_at
$$;

-- create_patient_request: pin optional; website details accepted.
create or replace function public.create_patient_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare new_id bigint; r public.patient_requests; pid bigint := nullif(p ->> 'patient_id', '')::bigint;
begin
  if not (private.is_founder() or (select auth.role()) = 'service_role') then raise exception 'Only founders can do this'; end if;
  if pid is not null and not exists (select 1 from public.patients where id = pid) then raise exception 'Patient not found'; end if;
  if pid is null then
    insert into public.patients (full_name, phone, condition, created_by)
    values (trim(p ->> 'patient_name'), coalesce(trim(p ->> 'phone'), ''), left(coalesce(trim(p ->> 'condition'), ''), 500), auth.uid())
    returning id into pid;
  end if;
  insert into public.patient_requests (patient_id, patient_name, phone, address, lat, lng, preferred_date, preferred_time, session_type, duration_min,
                                       notes, condition, source, governorate, preferred_slot, service, lang, ip_hash)
  values (pid, trim(p ->> 'patient_name'), coalesce(trim(p ->> 'phone'), ''), coalesce(trim(p ->> 'address'), ''),
          nullif(p ->> 'lat', '')::float, nullif(p ->> 'lng', '')::float, (p ->> 'preferred_date')::date, nullif(p ->> 'preferred_time', '')::time,
          coalesce(p ->> 'session_type', ''), coalesce(nullif(p ->> 'duration_min', '')::int, 45), coalesce(trim(p ->> 'notes'), ''),
          left(coalesce(trim(p ->> 'condition'), ''), 500), coalesce(nullif(p ->> 'source', ''), 'manual'),
          coalesce(p ->> 'governorate', ''), coalesce(p ->> 'preferred_slot', ''), coalesce(p ->> 'service', ''), coalesce(p ->> 'lang', ''), nullif(p ->> 'ip_hash', ''))
  returning id into new_id;
  perform private.route_request(new_id);
  select * into r from public.patient_requests where id = new_id;
  return jsonb_build_object('id', r.id, 'status', r.status, 'reason', r.reason, 'doctor_id', coalesce(r.assigned_doctor_id, r.nearest_doctor_id),
                            'nearest_km', r.nearest_km, 'appointment_id', r.appointment_id, 'patient_id', pid);
end $$;
