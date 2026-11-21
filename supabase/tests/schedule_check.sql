-- Permission check for the schedule (appointments), "mark done" and AI actions. Needs the seed data.
-- Always rolls back: success -> error "ALL SCHEDULE CHECKS PASSED", failure -> error "FAIL: ...".
do $$
declare
  abd uuid; mona uuid; karim uuid; n int; failed boolean; appt bigint; karim_appt bigint; sess bigint;
begin
  select id into abd   from public.profiles where username = 'abdurrahman';
  select id into mona  from public.profiles where username = 'dr.mona';
  select id into karim from public.profiles where username = 'dr.karim';
  insert into public.appointments (doctor_id, patient_name, location, appt_date) values (karim, 'K patient', 'Heliopolis', current_date + 1) returning id into karim_appt;

  -- ===== as doctor Mona =====
  perform set_config('request.jwt.claims', json_build_object('sub', mona, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.appointments (doctor_id, patient_name, location, appt_date, appt_time) values (mona, 'M patient', 'Nasr City', current_date, '10:00') returning id into appt;
  select count(*) into n from public.appointments;
  if n <> 1 then raise exception 'FAIL: doctor sees % visits, expected only her own 1', n; end if;
  failed := false;
  begin insert into public.appointments (doctor_id, patient_name, appt_date) values (karim, 'x', current_date); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: doctor booked for another doctor'; end if;
  failed := false;
  begin update public.appointments set doctor_id = karim where id = appt; exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: doctor handed a visit to another doctor'; end if;
  update public.appointments set notes = 'x' where id = karim_appt;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: doctor edited another doctors visit'; end if;
  delete from public.appointments where id = appt;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: doctor deleted a visit (only founders may)'; end if;
  failed := false;
  begin perform public.complete_appointment(karim_appt, 'x', 'y', current_date, null, 'Clinic', 45, ''); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: doctor completed another doctors visit'; end if;
  sess := public.complete_appointment(appt, 'M patient', 'Nasr City', current_date, '10:00', 'Clinic', 45, 'done');
  select count(*) into n from public.appointments where id = appt and status = 'done' and session_id = sess;
  if n <> 1 then raise exception 'FAIL: mark done did not close the visit'; end if;
  select count(*) into n from public.sessions where id = sess and doctor_id = mona;
  if n <> 1 then raise exception 'FAIL: mark done did not log the session'; end if;
  failed := false;
  begin perform public.complete_appointment(appt, 'M patient', 'Nasr City', current_date, null, 'Clinic', 45, ''); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: a closed visit was completed twice'; end if;
  select count(*) into n from public.ai_actions;
  if n <> 0 then raise exception 'FAIL: doctor sees AI actions'; end if;
  reset role;

  -- ===== as founder =====
  perform set_config('request.jwt.claims', json_build_object('sub', abd, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.appointments;
  if n <> 2 then raise exception 'FAIL: founder sees % visits, expected 2', n; end if;
  update public.appointments set doctor_id = mona, appt_date = current_date + 2 where id = karim_appt;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: founder could not move a visit'; end if;
  failed := false;
  begin update public.appointments set doctor_id = abd where id = karim_appt; exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: founder assigned a visit to a non-doctor'; end if;
  failed := false;
  begin insert into public.ai_actions (founder_id, kind, payload) values (abd, 'add_session', '{}'); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: browser could create AI actions'; end if;
  delete from public.appointments where id = karim_appt;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: founder could not delete a visit'; end if;
  reset role;

  -- ===== anonymous =====
  set local role anon;
  failed := false;
  begin select count(*) into n from public.appointments; exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: anonymous visitor could read visits'; end if;
  reset role;

  raise exception 'ALL SCHEDULE CHECKS PASSED (doctor, founder, anonymous). Rolled back, nothing changed.';
end $$;
