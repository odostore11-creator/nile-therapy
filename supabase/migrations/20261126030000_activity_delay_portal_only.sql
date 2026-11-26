-- "How late sessions are logged" only counts sessions entered through the portal (they carry a client_ref);
-- bulk-imported history has no client_ref and would look weeks late.
create or replace function public.doctor_activity()
returns table (id uuid, full_name text, phone text, active boolean, last_seen timestamptz, last_sign_in timestamptz,
               sessions_7d bigint, sessions_30d bigint, avg_delay_days numeric, late_30d bigint, open_visits bigint, last_session date, active_days_30d bigint)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.full_name, p.phone, p.active,
         (select max(a.last_at) from public.activity_days a where a.user_id = p.id),
         (select u.last_sign_in_at from auth.users u where u.id = p.id),
         (select count(*) from public.sessions s where s.doctor_id = p.id and s.session_date > current_date - 7),
         (select count(*) from public.sessions s where s.doctor_id = p.id and s.session_date > current_date - 30),
         (select round(avg(greatest(0, (s.created_at at time zone 'Africa/Cairo')::date - s.session_date))::numeric, 1)
            from public.sessions s where s.doctor_id = p.id and s.session_date > current_date - 30 and s.client_ref is not null),
         (select count(*) from public.sessions s where s.doctor_id = p.id and s.session_date > current_date - 30 and s.client_ref is not null
            and (s.created_at at time zone 'Africa/Cairo')::date - s.session_date > 2),
         (select count(*) from public.appointments ap where ap.doctor_id = p.id and ap.status = 'planned' and ap.appt_date < current_date),
         (select max(s.session_date) from public.sessions s where s.doctor_id = p.id),
         (select count(distinct a.day) from public.activity_days a where a.user_id = p.id and a.day > current_date - 30)
    from public.profiles p
   where private.is_founder() and p.role = 'doctor'
   order by p.active desc, p.full_name
$$;
