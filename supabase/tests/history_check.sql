-- Change history check. Needs the seed data. Always rolls back:
-- success -> error "ALL HISTORY CHECKS PASSED", failure -> error "FAIL: ...".
do $$
declare
  abd uuid; mona uuid; sid bigint; n int; failed boolean; old jsonb;
begin
  select id into abd  from public.profiles where username = 'abdurrahman';
  select id into mona from public.profiles where username = 'dr.mona';

  -- ===== doctor adds, edits and deletes a session =====
  perform set_config('request.jwt.claims', json_build_object('sub', mona, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.sessions (doctor_id, patient_name, location, session_date, duration_min)
    values (mona, 'History test', 'Nasr City', current_date, 45) returning id into sid;
  update public.sessions set duration_min = 60 where id = sid;
  update public.sessions set duration_min = 60 where id = sid;   -- no real change: must not be logged
  delete from public.sessions where id = sid;
  select count(*) into n from public.change_log;
  if n <> 0 then raise exception 'FAIL: a doctor can read the change history'; end if;
  failed := false;
  begin insert into public.change_log (table_name, row_id, action) values ('sessions', '1', 'delete'); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: a doctor could write fake history'; end if;
  reset role;

  -- ===== founder reads it and restores the deleted session =====
  perform set_config('request.jwt.claims', json_build_object('sub', abd, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.change_log where table_name = 'sessions' and row_id = sid::text;
  if n <> 3 then raise exception 'FAIL: expected 3 history rows (add, edit, delete), got %', n; end if;
  select count(*) into n from public.change_log where row_id = sid::text and actor_id = mona;
  if n <> 3 then raise exception 'FAIL: history does not say the doctor did it'; end if;
  select old_data into old from public.change_log where row_id = sid::text and action = 'delete';
  if (old ->> 'duration_min')::int <> 60 then raise exception 'FAIL: deleted row was not saved in full'; end if;
  insert into public.sessions (doctor_id, patient_name, location, session_date, duration_min)
    values ((old ->> 'doctor_id')::uuid, old ->> 'patient_name', old ->> 'location', (old ->> 'session_date')::date, (old ->> 'duration_min')::int);
  select count(*) into n from public.sessions where patient_name = 'History test';
  if n <> 1 then raise exception 'FAIL: founder could not restore the session'; end if;
  failed := false;
  begin delete from public.change_log where row_id = sid::text; get diagnostics n = row_count; if n = 0 then failed := true; end if;
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: a founder could erase history'; end if;
  reset role;

  raise exception 'ALL HISTORY CHECKS PASSED (logged add/edit/delete with who did it, doctors cannot read or fake it, founders can restore, nobody can erase it). Rolled back.';
end $$;
