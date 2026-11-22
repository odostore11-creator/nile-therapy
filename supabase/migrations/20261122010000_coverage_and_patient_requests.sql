-- Coverage areas + patient requests with automatic doctor assignment.
--
-- Rules (enforced here, in the database, so no screen can bypass them):
--  * Each doctor has one area, drawn on the map (a polygon).
--  * A new patient request goes to the NEAREST active doctor (inside their area = distance 0;
--    ties broken by how close the patient is to the middle of the area) IF that doctor has fewer
--    than 5 visits that day. It is then booked straight onto their schedule.
--  * If that doctor is full (or nobody has an area yet), the request is "open": every doctor who
--    still has room that day can see it and take it.
--  * If nobody takes it within 2 hours it is "overdue": doctors no longer see it, and it shows on
--    the founders' dashboards for them to assign by hand (founders may go over the 5-a-day limit).

create extension if not exists postgis with schema extensions;

-- ---------- settings ----------
create function private.daily_limit() returns integer language sql immutable as $$ select 5 $$;
create function private.open_window() returns interval language sql immutable as $$ select interval '2 hours' $$;
grant execute on function private.daily_limit(), private.open_window() to authenticated, service_role;

-- Visits a doctor already has on a day: booked/done visits + logged sessions not linked to a visit.
create function private.day_load(doc uuid, d date) returns integer
language sql stable security definer set search_path = ''
as $$
  select ((select count(*) from public.appointments a where a.doctor_id = doc and a.appt_date = d and a.status in ('planned', 'done'))
        + (select count(*) from public.sessions s where s.doctor_id = doc and s.session_date = d
             and not exists (select 1 from public.appointments a where a.session_id = s.id)))::integer
$$;
revoke all on function private.day_load(uuid, date) from public;
grant execute on function private.day_load(uuid, date) to authenticated, service_role;

-- ---------- doctor areas ----------
create table public.doctor_areas (
  doctor_id  uuid primary key references public.profiles (id) on delete cascade,
  coords     jsonb not null,                 -- outer ring as [[lng, lat], ...], at least 3 points
  color      text not null default '#1a5fa8' check (color ~ '^#[0-9a-fA-F]{6}$'),
  geom       extensions.geometry(Geometry, 4326),
  updated_at timestamptz not null default now()
);

create function private.area_geom() returns trigger
language plpgsql set search_path = ''
as $$
declare ring jsonb;
begin
  if jsonb_typeof(new.coords) <> 'array' or jsonb_array_length(new.coords) < 3 or jsonb_array_length(new.coords) > 500 then
    raise exception 'An area needs between 3 and 500 points';
  end if;
  if exists (select 1 from jsonb_array_elements(new.coords) p
             where jsonb_typeof(p) <> 'array' or (p ->> 0)::float not between 24 and 37.5 or (p ->> 1)::float not between 21 and 32.5) then
    raise exception 'Area points must be inside Egypt';
  end if;
  ring := new.coords || jsonb_build_array(new.coords -> 0);   -- close the shape
  new.geom := extensions.st_makevalid(extensions.st_setsrid(
    extensions.st_geomfromgeojson(jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(ring))::text), 4326));
  new.updated_at := now();
  return new;
end $$;
create trigger doctor_areas_geom before insert or update on public.doctor_areas
  for each row execute function private.area_geom();

revoke all on public.doctor_areas from anon, authenticated;
grant all on public.doctor_areas to service_role;
grant select (doctor_id, coords, color, updated_at) on public.doctor_areas to authenticated;
grant insert (doctor_id, coords, color), update (coords, color), delete on public.doctor_areas to authenticated;
alter table public.doctor_areas enable row level security;
create policy "founders see all areas, doctors their own" on public.doctor_areas for select to authenticated
  using ((select private.is_founder()) or (doctor_id = (select auth.uid()) and (select private.is_active_doctor())));
create policy "founders add areas" on public.doctor_areas for insert to authenticated
  with check ((select private.is_founder()) and private.is_doctor(doctor_id));
create policy "founders change areas" on public.doctor_areas for update to authenticated
  using ((select private.is_founder())) with check ((select private.is_founder()));
create policy "founders remove areas" on public.doctor_areas for delete to authenticated
  using ((select private.is_founder()));

-- ---------- patient requests ----------
create table public.patient_requests (
  id                 bigint generated always as identity primary key,
  patient_name       text not null check (length(patient_name) between 1 and 120),
  phone              text not null default '' check (length(phone) <= 40),
  address            text not null default '' check (length(address) <= 300),
  lat                double precision not null check (lat between 21 and 32.5),
  lng                double precision not null check (lng between 24 and 37.5),
  preferred_date     date not null,
  preferred_time     time,
  session_type       text not null default '' check (length(session_type) <= 40),
  duration_min       integer default 45 check (duration_min between 0 and 600),
  notes              text not null default '' check (length(notes) <= 2000),
  status             text not null default 'new' check (status in ('new', 'assigned', 'open', 'claimed', 'founder_assigned', 'cancelled')),
  reason             text not null default '' check (reason in ('', 'nearest_full', 'no_area')),
  nearest_doctor_id  uuid references public.profiles (id),
  nearest_km         numeric(8, 2),
  assigned_doctor_id uuid references public.profiles (id),
  appointment_id     bigint references public.appointments (id) on delete set null,
  source             text not null default 'manual' check (source in ('manual', 'ai', 'website')),
  created_by         uuid references public.profiles (id) default auth.uid(),
  created_at         timestamptz not null default now(),
  opened_at          timestamptz,
  resolved_at        timestamptz
);
create index patient_requests_status_idx on public.patient_requests (status, opened_at);
create index patient_requests_date_idx on public.patient_requests (preferred_date);

revoke all on public.patient_requests from anon, authenticated;
grant all on public.patient_requests to service_role;
grant select on public.patient_requests to authenticated;   -- changes only through the functions below
alter table public.patient_requests enable row level security;
create policy "founders see all requests; doctors see open ones they have room for, and their own" on public.patient_requests
  for select to authenticated
  using ((select private.is_founder())
      or ((select private.is_active_doctor()) and (
            assigned_doctor_id = (select auth.uid())
         or (status = 'open' and opened_at > now() - private.open_window()
             and private.day_load((select auth.uid()), preferred_date) < private.daily_limit()))));

-- Books the visit for a request onto a doctor's schedule. Internal helper.
create function private.book_request(r public.patient_requests, doc uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare appt bigint;
begin
  insert into public.appointments (doctor_id, patient_name, location, session_type, appt_date, appt_time, duration_min, notes)
  values (doc, r.patient_name, coalesce(nullif(r.address, ''), 'Map pin ' || round(r.lat::numeric, 5) || ', ' || round(r.lng::numeric, 5)),
          r.session_type, r.preferred_date, r.preferred_time, r.duration_min,
          trim(both ' ·' from r.notes || case when r.phone <> '' then ' · Tel: ' || r.phone else '' end))
  returning id into appt;
  return appt;
end $$;
revoke all on function private.book_request(public.patient_requests, uuid) from public;

-- Picks the nearest doctor and either books the visit or opens the request. Internal helper.
create function private.route_request(req_id bigint) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.patient_requests; pt extensions.geometry; best record;
begin
  select * into r from public.patient_requests where id = req_id for update;
  pt := extensions.st_setsrid(extensions.st_makepoint(r.lng, r.lat), 4326);
  select a.doctor_id,
         extensions.st_distance(a.geom::extensions.geography, pt::extensions.geography) / 1000 as km,
         extensions.st_distance(extensions.st_centroid(a.geom)::extensions.geography, pt::extensions.geography) as to_middle
    into best
    from public.doctor_areas a join public.profiles d on d.id = a.doctor_id and d.role = 'doctor' and d.active
   order by 2, 3 limit 1;
  if best.doctor_id is null then
    update public.patient_requests set status = 'open', reason = 'no_area', opened_at = now() where id = req_id;
  elsif private.day_load(best.doctor_id, r.preferred_date) < private.daily_limit() then
    update public.patient_requests set status = 'assigned', reason = '', nearest_doctor_id = best.doctor_id, nearest_km = round(best.km::numeric, 2),
           assigned_doctor_id = best.doctor_id, appointment_id = private.book_request(r, best.doctor_id), resolved_at = now()
     where id = req_id;
  else
    update public.patient_requests set status = 'open', reason = 'nearest_full', nearest_doctor_id = best.doctor_id,
           nearest_km = round(best.km::numeric, 2), opened_at = now() where id = req_id;
  end if;
end $$;
revoke all on function private.route_request(bigint) from public;

-- ---------- what the website calls ----------
-- New patient request (founders now; the AI and the main site's booking form later). Returns the outcome.
create function public.create_patient_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare new_id bigint; r public.patient_requests;
begin
  if not (private.is_founder() or (select auth.role()) = 'service_role') then raise exception 'Only founders can do this'; end if;
  insert into public.patient_requests (patient_name, phone, address, lat, lng, preferred_date, preferred_time, session_type, duration_min, notes, source)
  values (trim(p ->> 'patient_name'), coalesce(trim(p ->> 'phone'), ''), coalesce(trim(p ->> 'address'), ''),
          (p ->> 'lat')::float, (p ->> 'lng')::float, (p ->> 'preferred_date')::date, nullif(p ->> 'preferred_time', '')::time,
          coalesce(p ->> 'session_type', ''), coalesce(nullif(p ->> 'duration_min', '')::int, 45), coalesce(trim(p ->> 'notes'), ''),
          coalesce(nullif(p ->> 'source', ''), 'manual'))
  returning id into new_id;
  perform private.route_request(new_id);
  select * into r from public.patient_requests where id = new_id;
  return jsonb_build_object('id', r.id, 'status', r.status, 'reason', r.reason, 'doctor_id', coalesce(r.assigned_doctor_id, r.nearest_doctor_id),
                            'nearest_km', r.nearest_km, 'appointment_id', r.appointment_id);
end $$;

-- A doctor takes an open request (only while it is still open, within 2 hours, and they have room).
create function public.claim_patient_request(req_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.patient_requests; me uuid := auth.uid();
begin
  if not private.is_active_doctor() then raise exception 'Only doctors can take patients'; end if;
  select * into r from public.patient_requests where id = req_id for update;
  if not found or r.status <> 'open' then raise exception 'This patient was already taken'; end if;
  if r.opened_at <= now() - private.open_window() then raise exception 'This request has passed to the founders'; end if;
  if private.day_load(me, r.preferred_date) >= private.daily_limit() then raise exception 'You already have 5 visits that day'; end if;
  update public.patient_requests set status = 'claimed', assigned_doctor_id = me, appointment_id = private.book_request(r, me), resolved_at = now()
   where id = req_id;
  return jsonb_build_object('id', req_id, 'status', 'claimed');
end $$;

-- A founder assigns a request to any doctor (allowed to go over the daily limit).
create function public.assign_patient_request(req_id bigint, doc uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.patient_requests;
begin
  if not private.is_founder() then raise exception 'Only founders can do this'; end if;
  if not private.is_doctor(doc) then raise exception 'Doctor not found'; end if;
  select * into r from public.patient_requests where id = req_id for update;
  if not found or r.status <> 'open' then raise exception 'This patient was already taken'; end if;
  update public.patient_requests set status = 'founder_assigned', assigned_doctor_id = doc, appointment_id = private.book_request(r, doc), resolved_at = now()
   where id = req_id;
  return jsonb_build_object('id', req_id, 'status', 'founder_assigned', 'over_limit', private.day_load(doc, r.preferred_date) > private.daily_limit());
end $$;

create function public.cancel_patient_request(req_id bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_founder() then raise exception 'Only founders can do this'; end if;
  update public.patient_requests set status = 'cancelled', resolved_at = now() where id = req_id and status in ('open', 'new');
end $$;

-- Open requests for the calling doctor, with how far each patient is from their area (km).
create function public.open_requests_for_me() returns table (id bigint, patient_name text, phone text, address text, lat double precision,
  lng double precision, preferred_date date, preferred_time time, session_type text, duration_min integer, notes text, opened_at timestamptz, km numeric)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.patient_name, r.phone, r.address, r.lat, r.lng, r.preferred_date, r.preferred_time, r.session_type, r.duration_min, r.notes, r.opened_at,
         round((extensions.st_distance(a.geom::extensions.geography,
                extensions.st_setsrid(extensions.st_makepoint(r.lng, r.lat), 4326)::extensions.geography) / 1000)::numeric, 1)
    from public.patient_requests r
    left join public.doctor_areas a on a.doctor_id = auth.uid()
   where private.is_active_doctor() and r.status = 'open' and r.opened_at > now() - private.open_window()
     and private.day_load(auth.uid(), r.preferred_date) < private.daily_limit()
   order by 13 nulls last, r.opened_at
$$;

revoke all on function public.create_patient_request(jsonb), public.claim_patient_request(bigint),
  public.assign_patient_request(bigint, uuid), public.cancel_patient_request(bigint), public.open_requests_for_me() from public, anon;
grant execute on function public.create_patient_request(jsonb), public.claim_patient_request(bigint),
  public.assign_patient_request(bigint, uuid), public.cancel_patient_request(bigint), public.open_requests_for_me() to authenticated, service_role;
