-- Nile Therapy: initial schema (ported from server.js v0.1)
--
-- Who can do what is enforced HERE, by Row Level Security, not by the frontend:
--   * Doctors read/add/edit/delete only their own sessions, and read only their own profile.
--   * Founders (role 'admin') read everything, add sessions for any doctor, edit doctor profiles.
--   * Each founder reads/deletes only their OWN chat messages and memories.
--   * Creating accounts, resetting passwords and writing chat/memory rows happen in Edge
--     Functions with the service-role key (which bypasses RLS). The browser never has that key.
--   * Deactivated users (active = false) get nothing.

-- ---------- helpers (private schema: not exposed through the Data API) ----------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------- tables ----------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique check (username ~ '^[a-z0-9._-]{3,40}$'),
  role        text not null check (role in ('admin', 'doctor')),
  full_name   text not null check (length(full_name) between 1 and 120),
  title       text not null default '' check (length(title) <= 80),
  specialty   text not null default '' check (length(specialty) <= 120),
  phone       text not null default '' check (length(phone) <= 40),
  area        text not null default '' check (length(area) <= 120),
  bio         text not null default '' check (length(bio) <= 2000),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table public.profiles is 'One row per login. Login email is <username>@nile.local behind the scenes.';

create table public.sessions (
  id            bigint generated always as identity primary key,
  doctor_id     uuid not null references public.profiles (id),
  patient_name  text not null check (length(patient_name) between 1 and 120),
  location      text not null check (length(location) between 1 and 200),
  session_date  date not null,
  session_time  time,
  session_type  text not null default '' check (length(session_type) <= 40),
  duration_min  integer check (duration_min between 0 and 600),
  notes         text not null default '' check (length(notes) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);
create index sessions_doctor_date_idx on public.sessions (doctor_id, session_date desc);
create index sessions_date_idx on public.sessions (session_date desc);

create table public.chat_messages (
  id          bigint generated always as identity primary key,
  founder_id  uuid not null references public.profiles (id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  model       text,
  created_at  timestamptz not null default now()
);
create index chat_messages_founder_idx on public.chat_messages (founder_id, id);

create table public.founder_memory (
  id          bigint generated always as identity primary key,
  founder_id  uuid not null references public.profiles (id) on delete cascade,
  content     text not null check (length(content) between 1 and 500),
  created_at  timestamptz not null default now()
);
create index founder_memory_founder_idx on public.founder_memory (founder_id, id);

-- ---------- helper functions ----------
-- security definer so policies can look up the caller's role without tripping profiles' own RLS.
create function private.my_role() returns text
language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = auth.uid() and active $$;

create function private.is_founder() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.my_role() = 'admin', false) $$;

create function private.is_active_doctor() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.my_role() = 'doctor', false) $$;

create function private.is_doctor(uid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where id = uid and role = 'doctor') $$;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

revoke all on function private.my_role(), private.is_founder(), private.is_active_doctor(), private.is_doctor(uuid) from public;
grant execute on function private.my_role(), private.is_founder(), private.is_active_doctor(), private.is_doctor(uuid) to authenticated;

create trigger sessions_touch_updated_at before update on public.sessions
  for each row execute function private.touch_updated_at();

-- ---------- table privileges ----------
-- Start from nothing, then grant only what each role needs. RLS then filters the rows.
revoke all on public.profiles, public.sessions, public.chat_messages, public.founder_memory from anon, authenticated;
grant all on public.profiles, public.sessions, public.chat_messages, public.founder_memory to service_role;
grant usage on all sequences in schema public to service_role, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, title, specialty, phone, area, bio, active) on public.profiles to authenticated;

grant select, delete on public.sessions to authenticated;
grant insert (doctor_id, patient_name, location, session_date, session_time, session_type, duration_min, notes)
  on public.sessions to authenticated;
grant update (patient_name, location, session_date, session_time, session_type, duration_min, notes)
  on public.sessions to authenticated;

grant select, delete on public.chat_messages to authenticated;
grant select, delete on public.founder_memory to authenticated;

-- ---------- row level security ----------
alter table public.profiles       enable row level security;
alter table public.sessions       enable row level security;
alter table public.chat_messages  enable row level security;
alter table public.founder_memory enable row level security;

-- profiles
create policy "own profile, or founders see all" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_founder()));

create policy "founders edit doctor profiles" on public.profiles
  for update to authenticated
  using ((select private.is_founder()) and role = 'doctor')
  with check ((select private.is_founder()) and role = 'doctor');

-- sessions
create policy "doctors see own sessions, founders see all" on public.sessions
  for select to authenticated
  using ((select private.is_founder())
         or (doctor_id = (select auth.uid()) and (select private.is_active_doctor())));

create policy "doctors add own sessions, founders add for any doctor" on public.sessions
  for insert to authenticated
  with check (((select private.is_founder()) and private.is_doctor(doctor_id))
              or (doctor_id = (select auth.uid()) and (select private.is_active_doctor())));

create policy "doctors edit own sessions, founders edit all" on public.sessions
  for update to authenticated
  using ((select private.is_founder())
         or (doctor_id = (select auth.uid()) and (select private.is_active_doctor())))
  with check ((select private.is_founder())
         or (doctor_id = (select auth.uid()) and (select private.is_active_doctor())));

create policy "doctors delete own sessions, founders delete all" on public.sessions
  for delete to authenticated
  using ((select private.is_founder())
         or (doctor_id = (select auth.uid()) and (select private.is_active_doctor())));

-- chat + memory: strictly per founder, even other founders can't read them
create policy "founder reads own chat" on public.chat_messages
  for select to authenticated
  using (founder_id = (select auth.uid()) and (select private.is_founder()));
create policy "founder clears own chat" on public.chat_messages
  for delete to authenticated
  using (founder_id = (select auth.uid()) and (select private.is_founder()));

create policy "founder reads own memory" on public.founder_memory
  for select to authenticated
  using (founder_id = (select auth.uid()) and (select private.is_founder()));
create policy "founder deletes own memory" on public.founder_memory
  for delete to authenticated
  using (founder_id = (select auth.uid()) and (select private.is_founder()));

-- ---------- per-doctor stats (respects RLS of the person asking) ----------
create view public.doctor_stats with (security_invoker = true) as
select doctor_id,
       count(*)                                                                   as total,
       count(*) filter (where date_trunc('month', session_date) = date_trunc('month', current_date)) as this_month,
       count(distinct patient_name)                                               as patients,
       max(session_date)                                                          as last_session
from public.sessions
group by doctor_id;

revoke all on public.doctor_stats from anon, authenticated;
grant select on public.doctor_stats to authenticated, service_role;
