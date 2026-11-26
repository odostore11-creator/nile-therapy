-- Patients can leave an (optional) email on the website booking form and get a booking summary by email
-- (sent by notify-email, kind 'patient', in the language they booked in).
alter table public.patient_requests add column email text not null default ''
  check (email = '' or (length(email) <= 254 and email ~ '^[^@\s<>,;"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$'));

alter table public.email_log drop constraint email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check check (kind in ('booking', 'referral', 'weekly', 'errors', 'test', 'patient'));

create or replace function public.create_patient_request(p jsonb)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare new_id bigint; r public.patient_requests; pid bigint := nullif(p ->> 'patient_id', '')::bigint;
begin
  if not (private.is_founder() or (select auth.role()) = 'service_role') then raise exception 'Only founders can do this'; end if;
  if pid is not null and not exists (select 1 from public.patients where id = pid) then raise exception 'Patient not found'; end if;
  if pid is null then
    insert into public.patients (full_name, phone, condition, created_by)
    values (trim(p ->> 'patient_name'), coalesce(trim(p ->> 'phone'), ''), left(coalesce(trim(p ->> 'condition'), ''), 500), auth.uid())
    returning id into pid;
  end if;
  insert into public.patient_requests (patient_id, patient_name, phone, address, lat, lng, preferred_date, preferred_time, session_type, duration_min,
                                       notes, condition, source, governorate, preferred_slot, service, lang, ip_hash, email)
  values (pid, trim(p ->> 'patient_name'), coalesce(trim(p ->> 'phone'), ''), coalesce(trim(p ->> 'address'), ''),
          nullif(p ->> 'lat', '')::float, nullif(p ->> 'lng', '')::float, (p ->> 'preferred_date')::date, nullif(p ->> 'preferred_time', '')::time,
          coalesce(p ->> 'session_type', ''), coalesce(nullif(p ->> 'duration_min', '')::int, 45), coalesce(trim(p ->> 'notes'), ''),
          left(coalesce(trim(p ->> 'condition'), ''), 500), coalesce(nullif(p ->> 'source', ''), 'manual'),
          coalesce(p ->> 'governorate', ''), coalesce(p ->> 'preferred_slot', ''), coalesce(p ->> 'service', ''), coalesce(p ->> 'lang', ''), nullif(p ->> 'ip_hash', ''),
          lower(coalesce(trim(p ->> 'email'), '')))
  returning id into new_id;
  perform private.route_request(new_id);
  select * into r from public.patient_requests where id = new_id;
  return jsonb_build_object('id', r.id, 'status', r.status, 'reason', r.reason, 'doctor_id', coalesce(r.assigned_doctor_id, r.nearest_doctor_id),
                            'nearest_km', r.nearest_km, 'appointment_id', r.appointment_id, 'patient_id', pid);
end $function$;
