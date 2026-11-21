-- TEST DATA ONLY. Do not run this on the real launch database (or delete these accounts first).
-- Creates the 3 placeholder founders + 4 demo doctors with fake sessions, like server.js v0.1.
-- Passwords are random and generated at run time (never stored in the repo); the last query
-- returns them once. Save them somewhere private (e.g. supabase/seed-passwords.local.txt, gitignored).
-- Login email for each account is <username>@nile.local.

do $$ begin
  if exists (select 1 from public.profiles) then
    raise exception 'Seed refused: profiles already exist.';
  end if;
end $$;

create temp table _seed (
  ord int, username text, role text, full_name text, title text, specialty text, area text,
  id uuid default gen_random_uuid(),
  password text default translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/', '-_')
);

insert into _seed (ord, username, role, full_name, title, specialty, area) values
  (0, 'abdurrahman', 'admin',  'Dr. Abdurrahman',   'Co-founder & CTO', 'Physiotherapy', ''),
  (0, 'founder2',    'admin',  'Founder Two',       'Co-founder',       '', ''),
  (0, 'founder3',    'admin',  'Founder Three',     'Co-founder',       '', ''),
  (1, 'dr.mona',     'doctor', 'Dr. Mona Adel',     'Physiotherapist',  'Sports & orthopedic rehab', 'Nasr City'),
  (2, 'dr.karim',    'doctor', 'Dr. Karim Fathy',   'Physiotherapist',  'Neuro rehab',               'Heliopolis'),
  (3, 'dr.salma',    'doctor', 'Dr. Salma Hussein', 'Physiotherapist',  'Pediatric physiotherapy',   'Maadi'),
  (4, 'dr.youssef',  'doctor', 'Dr. Youssef Nabil', 'Physiotherapist',  'Post-op & geriatric care',  'Zagazig');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
       username || '@nile.local', extensions.crypt(password, extensions.gen_salt('bf')), now(),
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'username', username),
       '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', ''
from _seed;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select id::text, id,
       jsonb_build_object('sub', id::text, 'email', username || '@nile.local', 'email_verified', true),
       'email', now(), now(), now()
from _seed;

insert into public.profiles (id, username, role, full_name, title, specialty, area)
select id, username, role, full_name, title, specialty, area from _seed;

-- 6 to 9 fake sessions per doctor over the last few weeks
insert into public.sessions (doctor_id, patient_name, location, session_date, session_time, session_type, duration_min, notes)
select s.id,
       (array['Ahmed S.','Mariam K.','Omar T.','Hoda M.','Ali R.','نور ح.','Laila F.','Hassan E.'])[((i + s.ord) % 8) + 1],
       case (i + s.ord) % 3 when 2 then 'Video call' else s.area || ', Cairo' end,
       current_date - (i * 3 + s.ord % 3),
       make_time(10 + i % 8, 0, 0),
       (array['Home visit','Clinic','Online'])[((i + s.ord) % 3) + 1],
       45 + (i % 2) * 15,
       case when i % 3 = 0 then 'Follow-up next week' else '' end
from _seed s
cross join lateral generate_series(0, 5 + s.ord - 1) as i
where s.role = 'doctor';

select role, username, username || '@nile.local' as login_email, password from _seed order by role, username;
