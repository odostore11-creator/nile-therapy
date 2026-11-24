-- Partners: doctors, hospitals and clinics that refer patients to Nile Therapy.
-- A partner (role 'partner') logs in on the Partner tab, keeps a profile, sends patients ("referrals") with an
-- optional PDF, and sees a report of the patients they sent: status, the Nile doctor who took them, sessions so far.
-- Founders see every referral and assign a doctor by hand (assign_referral); nothing is assigned automatically.
-- Accounts are created by founders or the tech team through the admin-doctors Edge Function.

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'doctor', 'tech', 'partner'));

create function private.is_partner() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.my_role() = 'partner', false) $$;
revoke all on function private.is_partner() from public;
grant execute on function private.is_partner() to authenticated;

-- The tech team also sees partners' names (it creates partner accounts).
create policy "tech reads partners' names" on public.profiles for select to authenticated
  using ((select private.is_tech()) and role = 'partner');
-- Founders can rename / turn off partner accounts, like doctors.
create policy "founders edit partner profiles" on public.profiles for update to authenticated
  using ((select private.is_founder()) and role = 'partner') with check ((select private.is_founder()) and role = 'partner');

-- ---------- partner details ----------
create table public.partner_profiles (
  id              uuid primary key references public.profiles(id) on delete cascade,
  kind            text not null default 'doctor' check (kind in ('doctor', 'hospital', 'clinic', 'other')),
  organization    text not null default '' check (length(organization) <= 160),
  contact_person  text not null default '' check (length(contact_person) <= 120),
  phone           text not null default '' check (length(phone) <= 40),
  email           text not null default '' check (length(email) <= 160),
  governorate     text not null default '' check (length(governorate) <= 40),
  address         text not null default '' check (length(address) <= 300),
  notes           text not null default '' check (length(notes) <= 1000),
  updated_at      timestamptz not null default now()
);
create trigger partner_profiles_touch before update on public.partner_profiles for each row execute function private.touch_updated_at();
alter table public.partner_profiles enable row level security;
create policy "partner, founders and tech read partner details" on public.partner_profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_founder()) or (select private.is_tech()));
create policy "partner and founders edit partner details" on public.partner_profiles for update to authenticated
  using ((id = (select auth.uid()) and (select private.is_partner())) or (select private.is_founder()))
  with check ((id = (select auth.uid()) and (select private.is_partner())) or (select private.is_founder()));
grant select on public.partner_profiles to authenticated;
grant update (kind, organization, contact_person, phone, email, governorate, address, notes) on public.partner_profiles to authenticated;
grant all on public.partner_profiles to service_role;

-- ---------- referred patients ----------
create table public.referrals (
  id                  bigint generated always as identity primary key,
  partner_id          uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  patient_name        text not null check (length(btrim(patient_name)) between 1 and 120),
  phone               text not null default '' check (length(phone) <= 40),
  age                 smallint check (age between 0 and 120),
  gender              text not null default '' check (gender in ('', 'male', 'female')),
  governorate         text not null default '' check (length(governorate) <= 40),
  address             text not null default '' check (length(address) <= 300),
  condition           text not null check (length(btrim(condition)) between 1 and 2000),
  urgency             text not null default 'flexible' check (urgency in ('urgent', 'this_week', 'flexible')),
  preferred_start     date,
  notes               text not null default '' check (length(notes) <= 2000),
  pdf_path            text check (length(pdf_path) <= 300),
  pdf_name            text not null default '' check (length(pdf_name) <= 200),
  status              text not null default 'new' check (status in ('new', 'assigned', 'closed', 'declined')),
  assigned_doctor_id  uuid references public.profiles(id) on delete set null,
  patient_id          bigint references public.patients(id) on delete set null,
  founder_note        text not null default '' check (length(founder_note) <= 1000),
  assigned_at         timestamptz,
  assigned_by         uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- a partner's PDF always sits in that partner's own folder
  constraint referrals_pdf_in_own_folder check (pdf_path is null or pdf_path like partner_id::text || '/%')
);
create index referrals_created_idx on public.referrals (created_at desc);
create index referrals_partner_idx on public.referrals (partner_id);
create index referrals_doctor_idx on public.referrals (assigned_doctor_id);
create index referrals_patient_idx on public.referrals (patient_id);
create index referrals_status_idx on public.referrals (status);
create trigger referrals_touch before update on public.referrals for each row execute function private.touch_updated_at();

alter table public.referrals enable row level security;
create policy "founders, the partner and the assigned doctor read referrals" on public.referrals for select to authenticated
  using ((select private.is_founder()) or (partner_id = (select auth.uid()) and (select private.is_partner()))
         or (assigned_doctor_id = (select auth.uid()) and (select private.is_active_doctor())));
create policy "partners send referrals" on public.referrals for insert to authenticated
  with check ((select private.is_partner()) and partner_id = (select auth.uid()) and status = 'new'
              and assigned_doctor_id is null and patient_id is null);
create policy "founders handle referrals" on public.referrals for update to authenticated
  using ((select private.is_founder())) with check ((select private.is_founder()));
create policy "founders remove referrals" on public.referrals for delete to authenticated
  using ((select private.is_founder()));
grant select, delete on public.referrals to authenticated;
grant insert (patient_name, phone, age, gender, governorate, address, condition, urgency, preferred_start, notes, pdf_path, pdf_name)
  on public.referrals to authenticated;
grant update (status, assigned_doctor_id, patient_id, founder_note, assigned_at, assigned_by) on public.referrals to authenticated;
grant all on public.referrals to service_role;

-- The assigned doctor can see the patient record a referral created.
create or replace function private.can_see_patient(pid bigint) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_founder() or (private.is_active_doctor() and exists (
    select 1 from public.patients p where p.id = pid and (
      p.created_by = auth.uid()
      or exists (select 1 from public.sessions s where s.patient_id = pid and s.doctor_id = auth.uid())
      or exists (select 1 from public.appointments a where a.patient_id = pid and a.doctor_id = auth.uid())
      or exists (select 1 from public.referrals r where r.patient_id = pid and r.assigned_doctor_id = auth.uid()))))
$$;

-- Founders assign a referral to a doctor: makes (or reuses) the patient record and marks it assigned.
create function public.assign_referral(p_id bigint, p_doctor uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare r public.referrals; pid bigint; partner_name text;
begin
  if not private.is_founder() then raise exception 'Only founders can assign referred patients' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_doctor and role = 'doctor' and active) then
    raise exception 'Pick an active doctor' using errcode = '22023';
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
revoke all on function public.assign_referral(bigint, uuid) from public;
grant execute on function public.assign_referral(bigint, uuid) to authenticated;

-- The partner's report: their referrals + the doctor who took each one + sessions so far.
-- (Partners can't read doctors or sessions directly, so this returns only those three facts.)
create function public.my_referrals()
returns table (id bigint, patient_name text, phone text, age smallint, gender text, governorate text, address text,
               condition text, urgency text, preferred_start date, notes text, pdf_path text, pdf_name text,
               status text, created_at timestamptz, assigned_at timestamptz, doctor_name text, sessions bigint, last_session date)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.patient_name, r.phone, r.age, r.gender, r.governorate, r.address, r.condition, r.urgency,
         r.preferred_start, r.notes, r.pdf_path, r.pdf_name, r.status, r.created_at, r.assigned_at,
         d.full_name, coalesce(s.n, 0), s.last
    from public.referrals r
    left join public.profiles d on d.id = r.assigned_doctor_id
    left join lateral (select count(*) n, max(session_date) last from public.sessions
                        where r.patient_id is not null and patient_id = r.patient_id) s on true
   where private.is_partner() and r.partner_id = auth.uid()
   order by r.created_at desc
$$;
revoke all on function public.my_referrals() from public;
grant execute on function public.my_referrals() to authenticated;

-- ---------- PDFs (private bucket, one folder per partner) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('referral-files', 'referral-files', false, 10 * 1024 * 1024, array['application/pdf'])
on conflict (id) do nothing;

create policy "partner uploads own referral pdfs" on storage.objects for insert to authenticated
  with check (bucket_id = 'referral-files' and (storage.foldername(name))[1] = (select auth.uid())::text and (select private.is_partner()));
create policy "referral pdfs: partner, founders, assigned doctor read" on storage.objects for select to authenticated
  using (bucket_id = 'referral-files' and (
    ((storage.foldername(name))[1] = (select auth.uid())::text and (select private.is_partner()))
    or (select private.is_founder())
    or exists (select 1 from public.referrals r where r.pdf_path = name and r.assigned_doctor_id = (select auth.uid()))));
create policy "partner removes own unsent pdfs, founders remove any" on storage.objects for delete to authenticated
  using (bucket_id = 'referral-files' and (
    ((storage.foldername(name))[1] = (select auth.uid())::text and (select private.is_partner())
       and not exists (select 1 from public.referrals r where r.pdf_path = name))
    or (select private.is_founder())));

-- Live updates for the new tables (see 20261124020000).
alter publication supabase_realtime add table public.referrals, public.partner_profiles;
