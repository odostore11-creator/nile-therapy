-- Email alerts through Resend (sent by the Edge Function notify-email; the Resend key is a server secret).
--  * New website booking / new partner referral -> short email to the founders. On purpose WITHOUT the patient's name,
--    phone or complaint (health data stays in the portal): governorate, service, day, what happened, and a link to the Inbox.
--  * Weekly summary (Saturday morning, Cairo) -> totals only.
--  * Many browser errors in an hour -> email to the technical team.
-- A new booking/referral pings the function at once (pg_net); a cron job every 10 minutes is the backup and sends the weekly email.
-- Nothing is sent until the tech team turns it on and adds addresses (email_settings) and the RESEND_API_KEY secret exists.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create function private.emails_ok(a text[]) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(cardinality(a), 0) <= 10
     and coalesce(bool_and(x ~ '^[^@\s<>,;"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$'), true) from unnest(a) x
$$;

create table public.email_settings (
  id            smallint primary key default 1 check (id = 1),
  enabled       boolean not null default false,
  from_address  text not null default 'Nile Therapy <onboarding@resend.dev>'
                check (from_address ~ '^[^<>@]{0,60}<?[^@\s<>]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}>?$'),
  bookings_to   text[] not null default '{}' check (private.emails_ok(bookings_to)),
  weekly_to     text[] not null default '{}' check (private.emails_ok(weekly_to)),
  tech_to       text[] not null default '{}' check (private.emails_ok(tech_to)),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null
);
insert into public.email_settings (id) values (1);
alter table public.email_settings enable row level security;
create policy "founders and tech read email settings" on public.email_settings for select to authenticated
  using (private.is_founder() or private.is_tech());
create policy "founders and tech edit email settings" on public.email_settings for update to authenticated
  using (private.is_founder() or private.is_tech()) with check (private.is_founder() or private.is_tech());
grant select on public.email_settings to authenticated;
grant update (enabled, from_address, bookings_to, weekly_to, tech_to) on public.email_settings to authenticated;
grant all on public.email_settings to service_role;

create function private.email_settings_stamp() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
create trigger email_settings_stamp before update on public.email_settings for each row execute function private.email_settings_stamp();

-- What was sent (no patient data: kind + a reference such as the request id or the week).
create table public.email_log (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('booking', 'referral', 'weekly', 'errors', 'test')),
  ref         text not null check (length(ref) <= 60),
  status      text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  attempts    int  not null default 1,
  recipients  int  not null default 0,
  error       text not null default '' check (length(error) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (kind, ref)
);
alter table public.email_log enable row level security;
create policy "founders and tech read email log" on public.email_log for select to authenticated
  using (private.is_founder() or private.is_tech());
grant select on public.email_log to authenticated;
grant all on public.email_log to service_role;

-- Wake the function now. Never blocks or breaks the insert that called it.
create function private.ping_notify() returns void language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(url := 'https://oppjpgaoucigbukvqoqa.supabase.co/functions/v1/notify-email',
                        body := '{"reason":"ping"}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb,
                        timeout_milliseconds := 10000);
exception when others then null;
end $$;
revoke all on function private.ping_notify() from public;

create function private.ping_notify_trigger() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.ping_notify(); return null; end $$;
create trigger notify_website_booking after insert on public.patient_requests
  for each row when (new.source = 'website') execute function private.ping_notify_trigger();
create trigger notify_referral after insert on public.referrals
  for each row execute function private.ping_notify_trigger();

select cron.schedule('nile-notify-email', '*/10 * * * *', $$ select private.ping_notify() $$);

-- Weekly totals for the summary email (server only). The week is Saturday..Friday, Cairo time.
create function public.weekly_digest(p_week_start date)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with w as (select p_week_start as s, p_week_start + 7 as e, p_week_start - 7 as ps)
  select jsonb_build_object(
    'week_start', (select s from w), 'week_end', (select e - 1 from w),
    'sessions', (select count(*) from public.sessions, w where session_date >= w.s and session_date < w.e),
    'sessions_prev', (select count(*) from public.sessions, w where session_date >= w.ps and session_date < w.s),
    'income', (select coalesce(sum(f.price), 0) from public.sessions x join public.session_fees f on f.session_id = x.id, w
                where x.session_date >= w.s and x.session_date < w.e),
    'commission', (select coalesce(sum(f.commission), 0) from public.sessions x join public.session_fees f on f.session_id = x.id, w
                    where x.session_date >= w.s and x.session_date < w.e),
    'unpriced', (select count(*) from public.sessions x, w where x.session_date >= w.s and x.session_date < w.e
                  and not exists (select 1 from public.session_fees f where f.session_id = x.id)),
    'website_bookings', (select count(*) from public.patient_requests r, w where r.source = 'website'
                          and (r.created_at at time zone 'Africa/Cairo')::date >= w.s and (r.created_at at time zone 'Africa/Cairo')::date < w.e),
    'referrals', (select count(*) from public.referrals r, w
                   where (r.created_at at time zone 'Africa/Cairo')::date >= w.s and (r.created_at at time zone 'Africa/Cairo')::date < w.e),
    'waiting', (select count(*) from public.patient_requests where status in ('new', 'open'))
               + (select count(*) from public.referrals where status = 'new'),
    'open_visits', (select count(*) from public.appointments, w where status = 'planned' and appt_date < w.e),
    'per_doctor', (select coalesce(jsonb_agg(jsonb_build_object('name', d.full_name, 'n', d.n) order by d.n desc, d.full_name), '[]'::jsonb)
                     from (select p.full_name, count(x.id) n from public.profiles p
                             left join public.sessions x on x.doctor_id = p.id and x.session_date >= (select s from w) and x.session_date < (select e from w)
                            where p.role = 'doctor' and p.active group by p.full_name) d)
  )
$$;
revoke all on function public.weekly_digest(date) from public, anon, authenticated;
grant execute on function public.weekly_digest(date) to service_role;

alter publication supabase_realtime add table public.email_settings, public.email_log;
