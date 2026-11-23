-- A doctor can cover several areas (drawn by a founder). Each area now has its own id and an
-- optional name (e.g. "Nasr City"). Routing already picks the nearest area of any doctor; the
-- distance shown to a doctor for an open patient is to their NEAREST area.

alter table public.doctor_areas add column id bigint generated always as identity;
alter table public.doctor_areas add column name text not null default '' check (length(name) <= 60);
alter table public.doctor_areas drop constraint doctor_areas_pkey;
alter table public.doctor_areas add primary key (id);
create index doctor_areas_doctor_idx on public.doctor_areas (doctor_id);

grant select (id, name) on public.doctor_areas to authenticated;
grant insert (name), update (name) on public.doctor_areas to authenticated;

create or replace function public.open_requests_for_me() returns table (id bigint, patient_name text, phone text, address text, lat double precision,
  lng double precision, preferred_date date, preferred_time time, session_type text, duration_min integer, notes text, opened_at timestamptz, km numeric)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.patient_name, r.phone, r.address, r.lat, r.lng, r.preferred_date, r.preferred_time, r.session_type, r.duration_min, r.notes, r.opened_at,
         (select round((min(extensions.st_distance(a.geom::extensions.geography,
                 extensions.st_setsrid(extensions.st_makepoint(r.lng, r.lat), 4326)::extensions.geography)) / 1000)::numeric, 1)
            from public.doctor_areas a where a.doctor_id = auth.uid())
    from public.patient_requests r
   where private.is_active_doctor() and r.status = 'open' and r.reason not in ('out_of_area', 'visit_cancelled', 'no_location')
     and r.lat is not null and r.opened_at > now() - private.open_window()
     and private.day_load(auth.uid(), r.preferred_date) < private.daily_limit()
   order by 13 nulls last, r.opened_at
$$;
