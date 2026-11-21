-- Change history: every add / edit / delete of a session, visit or doctor profile is recorded
-- automatically by the database (who, when, before, after). Founders can read it and use it to
-- put back something deleted by mistake. Nobody can edit or delete the history from the app.

create table public.change_log (
  id          bigint generated always as identity primary key,
  table_name  text not null check (table_name in ('sessions', 'appointments', 'profiles')),
  row_id      text not null,
  action      text not null check (action in ('insert', 'update', 'delete')),
  actor_id    uuid,                      -- who did it (null = done by the system, e.g. the seed)
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);
create index change_log_created_idx on public.change_log (created_at desc);
create index change_log_row_idx on public.change_log (table_name, row_id, id);

revoke all on public.change_log from anon, authenticated;
grant all on public.change_log to service_role;
grant select on public.change_log to authenticated;
alter table public.change_log enable row level security;
create policy "founders read the change history" on public.change_log
  for select to authenticated using ((select private.is_founder()));

-- Runs as the table owner so it can always write the log; the browser can't write to it directly.
create function private.log_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  -- Skip updates that change nothing but the updated_at timestamp.
  if tg_op = 'UPDATE' and (o - 'updated_at') = (n - 'updated_at') then return new; end if;
  insert into public.change_log (table_name, row_id, action, actor_id, old_data, new_data)
  values (tg_table_name, coalesce(n ->> 'id', o ->> 'id'), lower(tg_op), auth.uid(), o, n);
  return coalesce(new, old);
end $$;
revoke all on function private.log_change() from public;

create trigger sessions_log after insert or update or delete on public.sessions
  for each row execute function private.log_change();
create trigger appointments_log after insert or update or delete on public.appointments
  for each row execute function private.log_change();
create trigger profiles_log after update on public.profiles
  for each row execute function private.log_change();
