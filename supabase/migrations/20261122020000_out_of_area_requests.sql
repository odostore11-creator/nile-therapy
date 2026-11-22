-- A patient more than 10 km outside every doctor's area is NOT given to the "nearest" doctor
-- (who could be hundreds of km away). It goes straight to the founders instead (reason 'out_of_area').

create function private.max_outside_km() returns numeric language sql immutable as $$ select 10::numeric $$;
grant execute on function private.max_outside_km() to authenticated, service_role;

alter table public.patient_requests drop constraint patient_requests_reason_check;
alter table public.patient_requests add constraint patient_requests_reason_check
  check (reason in ('', 'nearest_full', 'no_area', 'out_of_area'));

create or replace function private.route_request(req_id bigint) returns void
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

-- Doctors never see out-of-area requests (founders handle them).
drop policy "founders see all requests; doctors see open ones they have room for, and their own" on public.patient_requests;
create policy "founders see all requests; doctors see open ones they have room for, and their own" on public.patient_requests
  for select to authenticated
  using ((select private.is_founder())
      or ((select private.is_active_doctor()) and (
            assigned_doctor_id = (select auth.uid())
         or (status = 'open' and reason <> 'out_of_area' and opened_at > now() - private.open_window()
             and private.day_load((select auth.uid()), preferred_date) < private.daily_limit()))));

create or replace function public.claim_patient_request(req_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.patient_requests; me uuid := auth.uid();
begin
  if not private.is_active_doctor() then raise exception 'Only doctors can take patients'; end if;
  select * into r from public.patient_requests where id = req_id for update;
  if not found or r.status <> 'open' then raise exception 'This patient was already taken'; end if;
  if r.reason = 'out_of_area' or r.opened_at <= now() - private.open_window() then raise exception 'This request has passed to the founders'; end if;
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
   where private.is_active_doctor() and r.status = 'open' and r.reason <> 'out_of_area' and r.opened_at > now() - private.open_window()
     and private.day_load(auth.uid(), r.preferred_date) < private.daily_limit()
   order by 13 nulls last, r.opened_at
$$;
