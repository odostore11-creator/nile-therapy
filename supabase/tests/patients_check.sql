-- Patients, auto-linking, cancelled-visit handling and offline-safe logging. Needs the seed data.
-- Always rolls back: success -> error "ALL PATIENT CHECKS PASSED", failure -> error "FAIL: ...".
do $$
declare abd uuid; salma uuid; mona uuid; pid bigint; n int; failed boolean; a1 bigint; a2 bigint; sid bigint; rid bigint; ref uuid := gen_random_uuid();
begin
  select id into abd from public.profiles where username = 'abdurrahman';
  select id into salma from public.profiles where username = 'dr.salma';
  select id into mona from public.profiles where username = 'dr.mona';

  -- A doctor adds a patient; another doctor can't see it or attach a session to it.
  perform set_config('request.jwt.claims', json_build_object('sub', salma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.patients (full_name, phone, condition) values ('Test Patient', '0100', 'Knee pain') returning id into pid;
  select count(*) into n from public.patients where id = pid;
  if n <> 1 then raise exception 'FAIL: doctor cannot see the patient they added'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', mona, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.patients where id = pid;
  if n <> 0 then raise exception 'FAIL: another doctor can see the patient'; end if;
  failed := false;
  begin insert into public.sessions (doctor_id, patient_id, patient_name, location, location_url, session_date)
        values (mona, pid, 'x', 'x', 'https://x.y', current_date); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: a doctor attached a session to a patient they cannot see'; end if;
  reset role;

  -- Logging a session directly closes the matching planned visit (same doctor, day, patient).
  perform set_config('request.jwt.claims', json_build_object('sub', salma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.appointments (doctor_id, patient_id, patient_name, appt_date, appt_time, location_url)
    values (salma, pid, 'Test Patient', current_date, '10:00', 'https://x.y') returning id into a1;
  insert into public.appointments (doctor_id, patient_id, patient_name, appt_date, appt_time, location_url)
    values (salma, pid, 'Test Patient', current_date, '17:00', 'https://x.y') returning id into a2;
  insert into public.sessions (doctor_id, patient_name, location, location_url, session_date, session_time, client_ref)
    values (salma, '  test   patient ', 'Maadi', 'https://x.y', current_date, '10:20', ref) returning id into sid;
  select count(*) into n from public.appointments where id = a1 and status = 'done' and session_id = sid;
  if n <> 1 then raise exception 'FAIL: logged session did not close the nearest planned visit'; end if;
  select count(*) into n from public.appointments where id = a2 and status = 'planned';
  if n <> 1 then raise exception 'FAIL: the other visit that day was closed too'; end if;
  select count(*) into n from public.sessions where id = sid and patient_id = pid;
  if n <> 1 then raise exception 'FAIL: the session did not take the visit''s patient'; end if;

  -- The same session sent twice (offline retry) is stored once.
  failed := false;
  begin insert into public.sessions (doctor_id, patient_name, location, location_url, session_date, client_ref)
        values (salma, 'dup', 'Maadi', 'https://x.y', current_date, ref); exception when unique_violation then failed := true; end;
  if not failed then raise exception 'FAIL: a repeated client_ref was stored twice'; end if;

  -- "Mark done" closes only its own visit (no second link by the trigger).
  sid := public.complete_appointment(a2, 'Test Patient', 'Maadi', current_date, '17:00', 'Clinic', 45, '');
  select count(*) into n from public.appointments where id = a2 and status = 'done' and session_id = sid;
  if n <> 1 then raise exception 'FAIL: mark done did not close its visit'; end if;
  reset role;

  -- Cancelling a visit that came from a patient request sends the request back to the founders.
  insert into public.appointments (doctor_id, patient_id, patient_name, appt_date, location_url)
    values (salma, pid, 'Test Patient', current_date + 1, 'https://x.y') returning id into a1;
  insert into public.patient_requests (patient_id, patient_name, lat, lng, preferred_date, status, assigned_doctor_id, appointment_id)
    values (pid, 'Test Patient', 29.96, 31.27, current_date + 1, 'assigned', salma, a1) returning id into rid;
  perform set_config('request.jwt.claims', json_build_object('sub', salma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.appointments set status = 'cancelled' where id = a1;
  select count(*) into n from public.patient_requests where id = rid;
  if n <> 0 then raise exception 'FAIL: the doctor still sees a request that went back to the founders'; end if;
  reset role;
  select count(*) into n from public.patient_requests where id = rid and status = 'open' and reason = 'visit_cancelled' and appointment_id is null and assigned_doctor_id is null;
  if n <> 1 then raise exception 'FAIL: cancelling the visit did not reopen the request for the founders'; end if;

  -- Founders see every patient; the report's first-seen function works.
  perform set_config('request.jwt.claims', json_build_object('sub', abd, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.patients where id = pid;
  if n <> 1 then raise exception 'FAIL: founder cannot see the patient'; end if;
  select count(*) into n from public.patient_first_seen(current_date, current_date) where patient_key = 'p' || pid and first_date = current_date;
  if n <> 1 then raise exception 'FAIL: patient_first_seen'; end if;
  reset role;
  raise exception 'ALL PATIENT CHECKS PASSED (privacy, auto-link, no double link, offline dedupe, cancelled visit -> founders). Rolled back.';
end $$;
