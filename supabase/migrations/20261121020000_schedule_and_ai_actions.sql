-- Shared schedule (appointments) + AI actions that wait for a founder's Confirm.

-- ---------- appointments: upcoming visits ----------
-- Founders book for any doctor; doctors book their own. Doctors see only their own.
-- "Mark done" turns a visit into a logged session (complete_appointment below).
create table public.appointments (
  id            bigint generated always as identity primary key,
  doctor_id     uuid not null references public.profiles (id),
  patient_name  text not null check (length(patient_name) between 1 and 120),
  location      text not null default '' check (length(location) <= 200),
  session_type  text not null default '' check (length(session_type) <= 40),
  appt_date     date not null,
  appt_time     time,
  duration_min  integer check (duration_min between 0 and 600),
  notes         text not null default '' check (length(notes) <= 2000),
  status        text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  session_id    bigint references public.sessions (id) on delete set null,
  created_by    uuid references public.profiles (id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);
create index appointments_date_idx on public.appointments (appt_date, appt_time);
create index appointments_doctor_date_idx on public.appointments (doctor_id, appt_date);

create trigger appointments_touch_updated_at before update on public.appointments
  for each row execute function private.touch_updated_at();

revoke all on public.appointments from anon, authenticated;
grant all on public.appointments to service_role;
grant select on public.appointments to authenticated;
grant insert (doctor_id, patient_name, location, session_type, appt_date, appt_time, duration_min, notes)
  on public.appointments to authenticated;
grant update (doctor_id, patient_name, location, session_type, appt_date, appt_time, duration_min, notes, status, session_id)
  on public.appointments to authenticated;
grant delete on public.appointments to authenticated;
alter table public.appointments enable row level security;

create policy "doctors see own visits, founders see all" on public.appointments
  for select to authenticated
  using ((select private.is_founder())
         or (doctor_id = (select auth.uid()) and (select private.is_active_doctor())));

create policy "doctors book own visits, founders book for any doctor" on public.appointments
  for insert to authenticated
  with check (((select private.is_founder()) and private.is_doctor(doctor_id))
              or (doctor_id = (select auth.uid()) and (select private.is_active_doctor())));

-- Doctors can change their own visits but can't hand them to someone else (with check).
create policy "doctors edit own visits, founders edit all" on public.appointments
  for update to authenticated
  using ((select private.is_founder())
         or (doctor_id = (select auth.uid()) and (select private.is_active_doctor())))
  with check (((select private.is_founder()) and private.is_doctor(doctor_id))
              or (doctor_id = (select auth.uid()) and (select private.is_active_doctor())));

create policy "founders delete visits" on public.appointments
  for delete to authenticated
  using ((select private.is_founder()));

-- Mark a visit done: logs the session and links it, in one step.
-- security invoker = the caller's own permissions (RLS) apply to both tables.
create function public.complete_appointment(
  appt_id bigint, p_patient_name text, p_location text, p_session_date date, p_session_time time,
  p_session_type text, p_duration_min integer, p_notes text
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
  insert into public.sessions (doctor_id, patient_name, location, session_date, session_time, session_type, duration_min, notes)
  values (a.doctor_id, p_patient_name, p_location, p_session_date, p_session_time, coalesce(p_session_type, ''), p_duration_min, coalesce(p_notes, ''))
  returning id into new_id;
  update public.appointments set status = 'done', session_id = new_id where id = appt_id;
  return new_id;
end $$;
revoke all on function public.complete_appointment(bigint, text, text, date, time, text, integer, text) from public, anon;
grant execute on function public.complete_appointment(bigint, text, text, date, time, text, integer, text) to authenticated;

-- ---------- AI actions: proposed by the AI, run only after the founder clicks Confirm ----------
create table public.ai_actions (
  id          bigint generated always as identity primary key,
  founder_id  uuid not null references public.profiles (id) on delete cascade,
  message_id  bigint references public.chat_messages (id) on delete set null,
  kind        text not null check (kind in ('add_session', 'update_session', 'book_appointment', 'update_appointment', 'update_doctor')),
  payload     jsonb not null,           -- { target_id?, target_label?, before?, after }
  status      text not null default 'pending' check (status in ('pending', 'done', 'cancelled', 'failed')),
  result      text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index ai_actions_founder_idx on public.ai_actions (founder_id, id);

revoke all on public.ai_actions from anon, authenticated;
grant all on public.ai_actions to service_role;
grant select on public.ai_actions to authenticated;
alter table public.ai_actions enable row level security;
create policy "founder sees own AI actions" on public.ai_actions
  for select to authenticated
  using (founder_id = (select auth.uid()) and (select private.is_founder()));
-- No insert/update from the browser: only the ai-chat function (service role) writes here,
-- and it carries out a confirmed action with the founder's own login, so RLS still applies.
