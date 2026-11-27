-- Fixes from the portal sweep (2026-11-27).
-- 1. Cancelling a visit that came from a request sends the request back to the founders (unchanged), but now remembers the
--    visit (appointment_id stays). If the visit is then REOPENED, the request goes back to "assigned" instead of staying in the
--    Inbox, where a founder could assign it a second time (two visits for one patient).
create or replace function private.visit_closed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or (new.status = 'cancelled' and old.status <> 'cancelled') then
    update public.patient_requests
       set status = 'open', reason = 'visit_cancelled', assigned_doctor_id = null, opened_at = now(), resolved_at = null,
           appointment_id = case when tg_op = 'DELETE' then null else appointment_id end
     where appointment_id = old.id and status in ('assigned', 'claimed', 'founder_assigned');
  elsif tg_op = 'UPDATE' and old.status = 'cancelled' and new.status = 'planned' then
    update public.patient_requests
       set status = 'founder_assigned', reason = '', assigned_doctor_id = new.doctor_id, resolved_at = now()
     where appointment_id = new.id and status = 'open' and reason = 'visit_cancelled';
  end if;
  return coalesce(new, old);
end $$;

-- 2. Deleting a session that closed a visit used to leave the visit "done" with no session behind it (lost from the money
--    totals without any sign). Now the visit goes back to "planned", so it shows up as an open visit to log again or cancel.
create or replace function private.session_deleted() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.appointments set status = 'planned', session_id = null where session_id = old.id and status = 'done';
  return old;
end $$;
create trigger sessions_reopen_visit before delete on public.sessions for each row execute function private.session_deleted();

-- 3. Cancelling a request someone already took (a doctor claimed it a second earlier) used to say "cancelled" and do nothing.
create or replace function public.cancel_patient_request(req_id bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_founder() then raise exception 'Only founders can do this'; end if;
  update public.patient_requests set status = 'cancelled', resolved_at = now() where id = req_id and status in ('open', 'new');
  if not found then raise exception 'This patient was already taken'; end if;
end $$;

-- 4. Hygiene: the app never needs TRUNCATE / TRIGGER / REFERENCES on its tables (TRUNCATE would skip the row rules).
--    The API cannot run these, but nothing should hold them.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, trigger, references on public.%I from authenticated, anon', t);
  end loop;
end $$;
