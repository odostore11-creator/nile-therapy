-- Founders treat patients too (Omar, 2026-11-28):
--  * a founder can be picked wherever a doctor is picked for a patient or a visit;
--  * a founder can CHANGE the doctor of a website/map request that is already booked
--    (auto-assigned, taken by a doctor, or given by a founder). The same planned visit moves to the new person.

-- "Can this profile be given patients/visits?" Doctors and founders. (The name is kept: RLS policies use it.)
create or replace function private.is_doctor(uid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where id = uid and role in ('doctor', 'admin')) $$;

create or replace function public.assign_patient_request(req_id bigint, doc uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.patient_requests; a public.appointments; appt bigint;
begin
  if not private.is_founder() then raise exception 'Only founders can do this'; end if;
  if not exists (select 1 from public.profiles where id = doc and role in ('doctor', 'admin') and active) then
    raise exception 'Pick an active doctor or founder';
  end if;
  select * into r from public.patient_requests where id = req_id for update;
  if not found then raise exception 'This request was cancelled'; end if;
  if r.status = 'open' then
    appt := private.book_request(r, doc);
  elsif r.status in ('assigned', 'claimed', 'founder_assigned') then
    if r.assigned_doctor_id = doc then raise exception 'This person already has this patient'; end if;
    select * into a from public.appointments where id = r.appointment_id for update;
    if found and a.status = 'done' then raise exception 'This visit already happened, so its doctor can not be changed'; end if;
    if found and a.status = 'planned' then
      update public.appointments set doctor_id = doc where id = a.id;
      appt := a.id;
    else
      appt := private.book_request(r, doc); -- the visit was deleted: book a new one
    end if;
  else
    raise exception 'This request was cancelled';
  end if;
  update public.patient_requests set status = 'founder_assigned', assigned_doctor_id = doc, appointment_id = appt, resolved_at = now()
   where id = req_id;
  return jsonb_build_object('id', req_id, 'status', 'founder_assigned', 'over_limit', private.day_load(doc, r.preferred_date) > private.daily_limit());
end $$;

create or replace function public.assign_referral(p_id bigint, p_doctor uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare r public.referrals; pid bigint; partner_name text;
begin
  if not private.is_founder() then raise exception 'Only founders can assign referred patients' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_doctor and role in ('doctor', 'admin') and active) then
    raise exception 'Pick an active doctor or founder' using errcode = '22023';
  end if;
  select * into r from public.referrals where id = p_id for update;
  if not found then raise exception 'Referral not found' using errcode = 'P0002'; end if;
  pid := r.patient_id;
  if pid is null then
    select full_name into partner_name from public.profiles where id = r.partner_id;
    insert into public.patients (full_name, phone, condition, notes, created_by)
    values (r.patient_name, r.phone, left(r.condition, 500),
            left(concat_ws(' · ', 'Referred by ' || partner_name, nullif(r.notes, '')), 1000), auth.uid())
    returning id into pid;
  end if;
  update public.referrals set status = 'assigned', assigned_doctor_id = p_doctor, patient_id = pid,
         assigned_at = now(), assigned_by = auth.uid()
   where id = p_id;
  return pid;
end $$;
