-- LAUNCH CLEANUP: run ONCE, when the real data arrives. NOT run yet.
-- Removes all demo/test data and the demo doctor accounts, keeps the 3 founder accounts.
-- Run it in the Supabase SQL editor (or ask Claude to run it) only after Omar says "go".
--
-- Before running:
--   1. Fill in the real founder names/titles in step 3 (and new usernames if they want them).
--   2. Make sure no REAL sessions were entered yet (step 0 shows what will be deleted).
-- After running:
--   * Reset the 3 founders' passwords (Supabase dashboard > Authentication > Users), or keep the
--     current ones if only they know them.
--   * Add the real doctors from the portal (Doctors > Add doctor) and draw their areas.

-- ---------- 0. What will be deleted (read-only, run this first) ----------
select 'sessions' what, count(*) from public.sessions
union all select 'visits', count(*) from public.appointments
union all select 'patient requests', count(*) from public.patient_requests
union all select 'patients', count(*) from public.patients
union all select 'doctor areas', count(*) from public.doctor_areas
union all select 'doctor accounts', count(*) from public.profiles where role = 'doctor'
union all select 'AI chat messages', count(*) from public.chat_messages
union all select 'change history rows', count(*) from public.change_log;

-- ---------- 1-4. The cleanup (all or nothing) ----------
begin;

-- 1. All demo activity.
delete from public.ai_actions;
delete from public.chat_messages;
delete from public.founder_memory;
delete from public.patient_requests;
delete from public.appointments;
delete from public.sessions;
delete from public.patients;
delete from public.doctor_areas;

-- 2. Demo doctor accounts (dr.mona, dr.karim, dr.salma, dr.youssef, test). Deleting the login
--    also deletes the profile. Founders (role 'admin') are kept.
delete from auth.users where id in (select id from public.profiles where role = 'doctor');

-- 3. Real founder names. EDIT THESE before running (leave a line out to keep it as it is).
-- update public.profiles set full_name = 'Dr. Abdurrahman ...', title = 'Co-founder & CTO' where username = 'abdurrahman';
-- update public.profiles set full_name = '...', title = 'Co-founder' where username = 'founder2';
-- update public.profiles set full_name = '...', title = 'Co-founder' where username = 'founder3';
-- To give a founder a new USERNAME as well (they log in with it):
-- update public.profiles set username = 'newname' where username = 'founder2';
-- update auth.users set email = 'newname@nile.local' where id = (select id from public.profiles where username = 'newname');

-- 4. Start the change history fresh (it only holds demo changes).
delete from public.change_log;

commit;

-- ---------- 5. Check ----------
select username, role, full_name from public.profiles order by role, username;
