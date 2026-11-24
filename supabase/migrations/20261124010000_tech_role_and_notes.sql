-- Technical team: a third role ('tech') with its own small page, and notes the founders send to the team.
-- The tech account logs in from either login tab; it sees only founders' names and the notes. It has no
-- access to patients, sessions, doctors or fees (those policies check is_founder / is_doctor).
-- The account itself is created outside this file, so no password ever sits in the repo.

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'doctor', 'tech'));

create function private.is_tech() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.my_role() = 'tech', false) $$;
revoke all on function private.is_tech() from public;
grant execute on function private.is_tech() to authenticated;

-- The tech page shows who sent each note.
create policy "tech reads founders' names" on public.profiles for select to authenticated
  using ((select private.is_tech()) and role in ('admin', 'tech'));

create table public.tech_notes (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body        text not null check (length(btrim(body)) between 1 and 2000),
  status      text not null default 'new' check (status in ('new', 'in_progress', 'done')),
  reply       text not null default '' check (length(reply) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index tech_notes_created_idx on public.tech_notes (created_at desc);
create index tech_notes_author_idx on public.tech_notes (author_id);
create trigger tech_notes_touch before update on public.tech_notes for each row execute function private.touch_updated_at();

alter table public.tech_notes enable row level security;

-- Founders see every founder's notes (so they don't send the same request twice); the tech team sees all.
create policy "founders and tech read notes" on public.tech_notes for select to authenticated
  using ((select private.is_founder()) or (select private.is_tech()));
-- Founders write new notes as themselves.
create policy "founders send notes" on public.tech_notes for insert to authenticated
  with check ((select private.is_founder()) and author_id = (select auth.uid()) and status = 'new' and reply = '');
-- A founder can take back their own note until the team starts on it.
create policy "founders delete own new notes" on public.tech_notes for delete to authenticated
  using ((select private.is_founder()) and author_id = (select auth.uid()) and status = 'new');
-- The tech team moves notes along and replies (column grants below limit it to status + reply).
create policy "tech updates notes" on public.tech_notes for update to authenticated
  using ((select private.is_tech())) with check ((select private.is_tech()));

grant select, insert, delete on public.tech_notes to authenticated;
grant update (status, reply) on public.tech_notes to authenticated;
grant all on public.tech_notes to service_role;
