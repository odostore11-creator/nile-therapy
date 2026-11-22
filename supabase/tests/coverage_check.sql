-- Coverage / auto-assignment check. Needs the seed data + seed_areas.sql. Always rolls back:
-- success -> error "ALL COVERAGE CHECKS PASSED", failure -> error "FAIL: ...".
do $$
declare
  abd uuid; mona uuid; karim uuid; youssef uuid; d date := current_date + 30;
  res jsonb; req1 bigint; req2 bigint; req3 bigint; n int; failed boolean; i int;
  nasr jsonb := '{"patient_name":"T1","address":"Nasr City","lat":30.06,"lng":31.35,"session_type":"Home visit","phone":"0100"}';
begin
  select id into abd from public.profiles where username = 'abdurrahman';
  select id into mona from public.profiles where username = 'dr.mona';
  select id into karim from public.profiles where username = 'dr.karim';
  select id into youssef from public.profiles where username = 'dr.youssef';
  nasr := nasr || jsonb_build_object('preferred_date', d);

  -- 1. founder adds a Nasr City patient -> nearest is Mona, she has room -> booked on her schedule
  perform set_config('request.jwt.claims', json_build_object('sub', abd, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.create_patient_request(nasr);
  if res ->> 'status' <> 'assigned' or (res ->> 'doctor_id')::uuid <> mona then raise exception 'FAIL: expected assigned to Mona, got %', res; end if;
  select count(*) into n from public.appointments where id = (res ->> 'appointment_id')::bigint and doctor_id = mona and appt_date = d and notes like '%Tel: 0100%' and patient_id = (res ->> 'patient_id')::bigint;
  if n <> 1 then raise exception 'FAIL: the visit was not booked on Mona''s schedule'; end if;
  reset role;

  -- 2. fill Mona's day to 5, then another Nasr City patient -> open (nearest full)
  for i in 1..4 loop insert into public.appointments (doctor_id, patient_name, appt_date) values (mona, 'filler', d); end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', abd, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.create_patient_request(nasr || '{"patient_name":"T2"}');
  req1 := (res ->> 'id')::bigint;
  if res ->> 'status' <> 'open' or res ->> 'reason' <> 'nearest_full' then raise exception 'FAIL: expected open/nearest_full, got %', res; end if;
  -- 3. a patient in Aswan (no doctor nearby) -> straight to the founders
  res := public.create_patient_request(jsonb_build_object('patient_name', 'T3', 'lat', 24.09, 'lng', 32.90, 'preferred_date', d));
  req3 := (res ->> 'id')::bigint;
  if res ->> 'reason' <> 'out_of_area' then raise exception 'FAIL: Aswan should be out_of_area, got %', res; end if;
  reset role;

  -- 4. Mona (full that day) can't see or take the open patient
  perform set_config('request.jwt.claims', json_build_object('sub', mona, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.patient_requests where id = req1;
  if n <> 0 then raise exception 'FAIL: a full doctor can see the open request'; end if;
  failed := false;
  begin perform public.claim_patient_request(req1); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: a full doctor took a 6th visit'; end if;
  reset role;

  -- 5. Karim (has room) sees it with a distance, never sees the Aswan one, and takes it
  perform set_config('request.jwt.claims', json_build_object('sub', karim, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.open_requests_for_me() o where o.id = req1 and o.km is not null;
  if n <> 1 then raise exception 'FAIL: Karim cannot see the open request with a distance'; end if;
  select count(*) into n from public.patient_requests where id = req3;
  if n <> 0 then raise exception 'FAIL: a doctor can see an out-of-area request'; end if;
  failed := false;
  begin insert into public.patient_requests (patient_name, lat, lng, preferred_date) values ('x', 30, 31, d); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: a doctor wrote a request directly'; end if;
  failed := false;
  begin perform public.create_patient_request(nasr); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: a doctor created a request'; end if;
  res := public.claim_patient_request(req1);
  select count(*) into n from public.appointments a join public.patient_requests r on r.appointment_id = a.id where r.id = req1 and a.doctor_id = karim;
  if n <> 1 then raise exception 'FAIL: the taken patient is not on Karim''s schedule'; end if;
  failed := false;
  begin perform public.claim_patient_request(req1); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: the same patient was taken twice'; end if;
  select count(*) into n from public.patients p join public.patient_requests r on r.patient_id = p.id where r.id = req1;
  if n <> 1 then raise exception 'FAIL: Karim cannot see the patient he took'; end if;
  reset role;

  -- 6. an open request older than 2 hours: doctors can no longer see/take it; a founder assigns it (even over the limit)
  perform set_config('request.jwt.claims', json_build_object('sub', abd, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.create_patient_request(nasr || '{"patient_name":"T4"}');
  req2 := (res ->> 'id')::bigint;
  reset role;
  update public.patient_requests set opened_at = now() - interval '3 hours' where id = req2;
  perform set_config('request.jwt.claims', json_build_object('sub', youssef, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.open_requests_for_me() o where o.id = req2;
  if n <> 0 then raise exception 'FAIL: doctors still see a request after 2 hours'; end if;
  failed := false;
  begin perform public.claim_patient_request(req2); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: a doctor took a request after 2 hours'; end if;
  failed := false;
  begin perform public.assign_patient_request(req2, youssef); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: a doctor used the founders'' assign'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', abd, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.assign_patient_request(req2, mona);
  if (res ->> 'over_limit')::boolean is not true then raise exception 'FAIL: founder assign over the limit not reported, got %', res; end if;
  reset role;

  -- 7. not logged in
  set local role anon;
  failed := false;
  begin select count(*) into n from public.patient_requests; exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: anonymous visitor could read patient requests'; end if;
  reset role;

  raise exception 'ALL COVERAGE CHECKS PASSED (nearest doctor booked; 5-a-day opens it; full doctor locked out; others take it once; after 2h only founders; out-of-area to founders; no direct writes). Rolled back.';
end $$;
