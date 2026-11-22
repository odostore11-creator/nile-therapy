-- Map-link rule check. Needs the seed data. Always rolls back:
-- success -> error "ALL LOCATION-LINK CHECKS PASSED", failure -> error "FAIL: ...".
do $$
declare abd uuid; salma uuid; n int; failed boolean; appt bigint; sid bigint;
begin
  select id into abd from public.profiles where username = 'abdurrahman';
  select id into salma from public.profiles where username = 'dr.salma';
  perform set_config('request.jwt.claims', json_build_object('sub', salma, 'role', 'authenticated')::text, true);
  set local role authenticated;
  failed := false;
  begin insert into public.sessions (doctor_id, patient_name, location, session_date) values (salma, 'x', 'Maadi', current_date); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: doctor logged a session without a map link'; end if;
  insert into public.sessions (doctor_id, patient_name, location, session_date, location_url) values (salma, 'x', 'Maadi', current_date, 'https://maps.app.goo.gl/abc');
  failed := false;
  begin insert into public.sessions (doctor_id, patient_name, location, session_date, location_url) values (salma, 'x', 'Maadi', current_date, 'javascript:alert(1)'); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: a non-https link was accepted'; end if;
  failed := false;
  begin insert into public.appointments (doctor_id, patient_name, appt_date) values (salma, 'y', current_date); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: doctor booked a visit without a map link'; end if;
  insert into public.appointments (doctor_id, patient_name, appt_date, location_url) values (salma, 'y', current_date, 'https://www.google.com/maps?q=29.96,31.27') returning id into appt;
  update public.appointments set status = 'cancelled' where id = appt;  -- changing a visit doesn't need a new link
  update public.appointments set status = 'planned' where id = appt;
  sid := public.complete_appointment(appt, 'y', 'Maadi', current_date, null, 'Clinic', 45, '');
  select count(*) into n from public.sessions where id = sid and location_url like 'https://www.google.com/maps%';
  if n <> 1 then raise exception 'FAIL: mark done did not carry the visit''s link into the session'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', abd, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.sessions (doctor_id, patient_name, location, session_date) values (salma, 'founder entry', 'Maadi', current_date);
  reset role;
  raise exception 'ALL LOCATION-LINK CHECKS PASSED (doctors must add an https map link; founders optional; mark done carries it). Rolled back.';
end $$;
