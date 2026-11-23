-- 1) Session price and commission are founders-only.
--    They were typed into sessions.notes during the PDF import, and doctors can read their own notes.
--    They now live in session_fees, which only founders can read or change (RLS).
create table public.session_fees (
  session_id bigint primary key references public.sessions(id) on delete cascade,
  price integer check (price between 0 and 1000000),
  commission integer check (commission between 0 and 1000000),
  updated_at timestamptz not null default now()
);
alter table public.session_fees enable row level security;
create policy "founders manage fees" on public.session_fees for all to authenticated
  using ((select private.is_founder())) with check ((select private.is_founder()));
create trigger session_fees_touch before update on public.session_fees for each row execute function private.touch_updated_at();

insert into public.session_fees (session_id, price, commission)
select id,
       nullif(substring(notes from 'السعر ([0-9]+)'), '')::int,
       nullif(substring(notes from 'عمولة ([0-9]+)'), '')::int
from public.sessions where notes ~ 'عمولة [0-9]+';

-- Doctors keep the price line; the commission part is removed from the notes they can see.
update public.sessions set notes = btrim(regexp_replace(notes, '\s*·\s*عمولة [0-9]+ ج\.م', '', 'g'))
where notes ~ 'عمولة';

-- 2) Each founder's own calendar: their sessions, meetings, reminders and anything else.
--    Founders can look at each other's calendars (not entries marked private); only the owner changes them.
create table public.founder_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind text not null default 'meeting' check (kind in ('session', 'meeting', 'reminder', 'other')),
  title text not null default '' check (length(title) <= 200),
  event_date date not null,
  start_time time,
  end_time time,
  location text not null default '' check (length(location) <= 300),
  location_url text not null default '' check (location_url = '' or location_url ~* '^https://\S+$'),
  patient_name text not null default '' check (length(patient_name) <= 200),
  patient_id bigint references public.patients(id) on delete set null,
  price integer check (price between 0 and 1000000),
  notes text not null default '' check (length(notes) <= 4000),
  done boolean not null default false,
  private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time is null or start_time is null or end_time >= start_time),
  check (kind <> 'session' or patient_name <> '' or title <> '')
);
create index founder_events_owner_date on public.founder_events (owner_id, event_date);
create index founder_events_date on public.founder_events (event_date);
create index founder_events_patient on public.founder_events (patient_id);
alter table public.founder_events enable row level security;
create policy "founders see own and shared entries" on public.founder_events for select to authenticated
  using ((select private.is_founder()) and (owner_id = (select auth.uid()) or not private));
create policy "founders add to their own calendar" on public.founder_events for insert to authenticated
  with check ((select private.is_founder()) and owner_id = (select auth.uid()));
create policy "founders edit their own calendar" on public.founder_events for update to authenticated
  using ((select private.is_founder()) and owner_id = (select auth.uid()))
  with check ((select private.is_founder()) and owner_id = (select auth.uid()));
create policy "founders delete from their own calendar" on public.founder_events for delete to authenticated
  using ((select private.is_founder()) and owner_id = (select auth.uid()));
create trigger founder_events_touch before update on public.founder_events for each row execute function private.touch_updated_at();

-- This project's default grants are locked down: grant explicitly (RLS still decides which rows).
grant select, insert, update, delete on public.session_fees to authenticated;
grant select, insert, update, delete on public.founder_events to authenticated;
