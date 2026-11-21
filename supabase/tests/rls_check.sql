-- Permission (RLS) check. Needs the seed data. Run it in the Supabase SQL editor or via the MCP.
-- It acts as each kind of user, checks what they can see and do, then ALWAYS rolls back:
--   success -> error message starting "ALL RLS CHECKS PASSED"
--   failure -> error message starting "FAIL:"
do $$
declare
  abd uuid; f2 uuid; mona uuid; karim uuid;
  n int; total int; mona_total int; failed boolean;
begin
  select id into abd   from public.profiles where username = 'abdurrahman';
  select id into f2    from public.profiles where username = 'founder2';
  select id into mona  from public.profiles where username = 'dr.mona';
  select id into karim from public.profiles where username = 'dr.karim';
  if abd is null or f2 is null or mona is null or karim is null then raise exception 'FAIL: seed data missing'; end if;

  select count(*) into total from public.sessions;
  select count(*) into mona_total from public.sessions where doctor_id = mona;
  insert into public.chat_messages (founder_id, role, content) values (abd, 'user', 'abd secret'), (f2, 'user', 'f2 secret');
  insert into public.founder_memory (founder_id, content) values (abd, 'abd memory'), (f2, 'f2 memory');

  -- ===== as doctor Mona =====
  perform set_config('request.jwt.claims', json_build_object('sub', mona, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.sessions;
  if n <> mona_total or n = 0 then raise exception 'FAIL: doctor sees % sessions, expected %', n, mona_total; end if;
  select count(*) into n from public.sessions where doctor_id <> mona;
  if n <> 0 then raise exception 'FAIL: doctor sees other doctors sessions'; end if;
  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'FAIL: doctor sees % profiles, expected 1', n; end if;
  select count(*) into n from public.chat_messages;
  if n <> 0 then raise exception 'FAIL: doctor sees chat messages'; end if;
  select count(*) into n from public.founder_memory;
  if n <> 0 then raise exception 'FAIL: doctor sees founder memory'; end if;
  select count(*) into n from public.doctor_stats;
  if n <> 1 then raise exception 'FAIL: doctor sees % stats rows, expected 1', n; end if;

  insert into public.sessions (doctor_id, patient_name, location, session_date) values (mona, 'Test P.', 'Clinic', current_date);

  failed := false;
  begin
    insert into public.sessions (doctor_id, patient_name, location, session_date) values (karim, 'Test P.', 'Clinic', current_date);
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: doctor could add a session for another doctor'; end if;

  update public.sessions set notes = 'hacked' where doctor_id = karim;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: doctor edited another doctors session'; end if;
  delete from public.sessions where doctor_id = karim;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: doctor deleted another doctors session'; end if;
  update public.profiles set full_name = 'x' where id = mona;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: doctor edited a profile'; end if;

  failed := false;
  begin
    update public.sessions set doctor_id = karim where doctor_id = mona;
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: doctor moved a session to another doctor'; end if;

  reset role;

  -- ===== as founder Abdurrahman =====
  perform set_config('request.jwt.claims', json_build_object('sub', abd, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.sessions;
  if n <> total + 1 then raise exception 'FAIL: founder sees % sessions, expected %', n, total + 1; end if;
  select count(*) into n from public.profiles;
  if n <> 7 then raise exception 'FAIL: founder sees % profiles, expected 7', n; end if;
  select count(*) into n from public.chat_messages;
  if n <> 1 then raise exception 'FAIL: founder sees % chat messages, expected only their own 1', n; end if;
  select count(*) into n from public.founder_memory;
  if n <> 1 then raise exception 'FAIL: founder sees % memories, expected only their own 1', n; end if;
  delete from public.chat_messages where founder_id = f2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: founder deleted another founders chat'; end if;
  delete from public.founder_memory where founder_id = f2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: founder deleted another founders memory'; end if;

  insert into public.sessions (doctor_id, patient_name, location, session_date) values (karim, 'Test P.', 'Clinic', current_date);
  failed := false;
  begin
    insert into public.sessions (doctor_id, patient_name, location, session_date) values (f2, 'Test P.', 'Clinic', current_date);
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: founder logged a session for a non-doctor'; end if;

  update public.profiles set bio = 'edited' where id = karim;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: founder could not edit a doctor profile'; end if;
  update public.profiles set bio = 'edited' where id = f2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: founder edited another founders profile'; end if;

  failed := false;
  begin
    update public.profiles set role = 'admin' where id = karim;
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: founder could change a role from the browser'; end if;

  failed := false;
  begin
    insert into public.chat_messages (founder_id, role, content) values (abd, 'assistant', 'fake AI reply');
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: browser could write chat messages directly'; end if;

  reset role;

  -- ===== deactivated doctor =====
  update public.profiles set active = false where id = mona;
  perform set_config('request.jwt.claims', json_build_object('sub', mona, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sessions;
  if n <> 0 then raise exception 'FAIL: deactivated doctor still sees % sessions', n; end if;
  failed := false;
  begin
    insert into public.sessions (doctor_id, patient_name, location, session_date) values (mona, 'Test P.', 'Clinic', current_date);
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: deactivated doctor could add a session'; end if;
  reset role;

  -- ===== not logged in (anon) =====
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  failed := false;
  begin
    select count(*) into n from public.sessions;
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: anonymous visitor could read sessions'; end if;
  failed := false;
  begin
    select count(*) into n from public.profiles;
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: anonymous visitor could read profiles'; end if;
  reset role;

  raise exception 'ALL RLS CHECKS PASSED (doctor, founder, deactivated doctor, anonymous). Rolled back, nothing changed.';
end $$;
