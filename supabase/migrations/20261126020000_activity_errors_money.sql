-- Four additions:
--  1. activity_days: one row per person per page per day (written only through track_visit). Founders see each doctor's
--     last activity (doctor_activity); the tech team sees totals by role and page, no names (usage_summary).
--  2. client_errors: crashes in people's browsers (written only through log_client_error, rate-limited); the tech team reads them.
--  3. fee_defaults: default price + commission (one global row, optional per-doctor rows). A new session without a price gets
--     one automatically, so founders stop typing it every time. Founders only.
--  4. tech_commission + tech_payouts: the technical team's 5-10% of the session commission for 6 months (contract). Founders set
--     the rate and mark months paid; tech_commission_statement() gives both sides the monthly totals (no patient data).

-- ---------- 1. activity ----------
create table public.activity_days (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  day      date not null,
  page     text not null check (page ~ '^[a-z0-9_-]{1,40}$'),
  hits     int  not null default 1,
  last_at  timestamptz not null default now(),
  primary key (user_id, day, page)
);
create index activity_days_day_idx on public.activity_days (day);
alter table public.activity_days enable row level security; -- no policies: only the functions below touch it
grant all on public.activity_days to service_role;

create function public.track_visit(p_page text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or private.my_role() is null then return; end if; -- active accounts only
  if p_page !~ '^[a-z0-9_-]{1,40}$' then return; end if;
  insert into public.activity_days (user_id, day, page) values (auth.uid(), (now() at time zone 'Africa/Cairo')::date, p_page)
  on conflict (user_id, day, page) do update set hits = public.activity_days.hits + 1, last_at = now();
end $$;
revoke all on function public.track_visit(text) from public;
grant execute on function public.track_visit(text) to authenticated;

-- Founders: per doctor, when they were last active and how they log sessions.
create function public.doctor_activity()
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
            from public.sessions s where s.doctor_id = p.id and s.session_date > current_date - 30),
         (select count(*) from public.sessions s where s.doctor_id = p.id and s.session_date > current_date - 30
            and (s.created_at at time zone 'Africa/Cairo')::date - s.session_date > 2),
         (select count(*) from public.appointments ap where ap.doctor_id = p.id and ap.status = 'planned' and ap.appt_date < current_date),
         (select max(s.session_date) from public.sessions s where s.doctor_id = p.id),
         (select count(distinct a.day) from public.activity_days a where a.user_id = p.id and a.day > current_date - 30)
    from public.profiles p
   where private.is_founder() and p.role = 'doctor'
   order by p.active desc, p.full_name
$$;
revoke all on function public.doctor_activity() from public;
grant execute on function public.doctor_activity() to authenticated;

-- Tech team (and founders): usage totals by day / role / page. No names, no data.
create function public.usage_summary(p_days int default 14)
returns table (day date, role text, page text, people bigint, hits bigint)
language sql stable security definer set search_path = ''
as $$
  select a.day, p.role, a.page, count(distinct a.user_id), sum(a.hits)
    from public.activity_days a join public.profiles p on p.id = a.user_id
   where (private.is_tech() or private.is_founder()) and a.day > current_date - least(greatest(p_days, 1), 90)
   group by 1, 2, 3 order by 1 desc, 2, 3
$$;
revoke all on function public.usage_summary(int) from public;
grant execute on function public.usage_summary(int) to authenticated;

-- ---------- 2. browser errors ----------
create table public.client_errors (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles(id) on delete set null,
  role        text,
  page        text not null default '' check (length(page) <= 60),
  message     text not null check (length(message) between 1 and 300),
  detail      text not null default '' check (length(detail) <= 2000),
  ua          text not null default '' check (length(ua) <= 200),
  app_version text not null default '' check (length(app_version) <= 20),
  created_at  timestamptz not null default now()
);
create index client_errors_created_idx on public.client_errors (created_at desc);
alter table public.client_errors enable row level security;
create policy "tech reads errors" on public.client_errors for select to authenticated using ((select private.is_tech()));
create policy "tech clears errors" on public.client_errors for delete to authenticated using ((select private.is_tech()));
grant select, delete on public.client_errors to authenticated;
grant all on public.client_errors to service_role;

create function public.log_client_error(p_page text, p_message text, p_detail text, p_ua text, p_version text) returns void
language plpgsql security definer set search_path = ''
as $$
declare r text := private.my_role();
begin
  if auth.uid() is null or r is null or coalesce(btrim(p_message), '') = '' then return; end if;
  -- at most 30 reports per person per hour
  if (select count(*) from public.client_errors where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 30 then return; end if;
  insert into public.client_errors (user_id, role, page, message, detail, ua, app_version)
  values (auth.uid(), r, left(coalesce(p_page, ''), 60), left(p_message, 300), left(coalesce(p_detail, ''), 2000), left(coalesce(p_ua, ''), 200), left(coalesce(p_version, ''), 20));
end $$;
revoke all on function public.log_client_error(text, text, text, text, text) from public;
grant execute on function public.log_client_error(text, text, text, text, text) to authenticated;

-- ---------- 3. default prices ----------
create table public.fee_defaults (
  id          bigint generated always as identity primary key,
  doctor_id   uuid references public.profiles(id) on delete cascade, -- null = the default for everyone
  price       int check (price between 0 and 1000000),
  commission  int check (commission between 0 and 1000000),
  updated_at  timestamptz not null default now()
);
create unique index fee_defaults_one_per_doctor on public.fee_defaults (coalesce(doctor_id, '00000000-0000-0000-0000-000000000000'::uuid));
create trigger fee_defaults_touch before update on public.fee_defaults for each row execute function private.touch_updated_at();
alter table public.fee_defaults enable row level security;
create policy "founders manage default prices" on public.fee_defaults for all to authenticated
  using ((select private.is_founder())) with check ((select private.is_founder()));
grant select, insert, update, delete on public.fee_defaults to authenticated;
grant all on public.fee_defaults to service_role;

-- A new session gets the doctor's default (or the general one) unless a price is already there.
create function private.apply_default_fee() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare d public.fee_defaults;
begin
  select * into d from public.fee_defaults where doctor_id = new.doctor_id;
  if not found then select * into d from public.fee_defaults where doctor_id is null; end if;
  if found and (d.price is not null or d.commission is not null) then
    insert into public.session_fees (session_id, price, commission) values (new.id, d.price, d.commission)
    on conflict (session_id) do nothing;
  end if;
  return null;
end $$;
create trigger sessions_default_fee after insert on public.sessions for each row execute function private.apply_default_fee();

-- ---------- 4. the technical team's commission ----------
create table public.tech_commission (
  id          int primary key default 1 check (id = 1),
  rate        numeric(4, 2) not null check (rate between 0 and 20),
  start_date  date not null,
  months      int not null default 6 check (months between 1 and 60),
  updated_at  timestamptz not null default now()
);
create trigger tech_commission_touch before update on public.tech_commission for each row execute function private.touch_updated_at();
create table public.tech_payouts (
  month           date primary key check (extract(day from month) = 1),
  commission_base int not null,
  rate            numeric(4, 2) not null,
  amount          int not null,
  paid_at         timestamptz not null default now(),
  marked_by       uuid references public.profiles(id) on delete set null default auth.uid()
);
alter table public.tech_commission enable row level security;
alter table public.tech_payouts enable row level security;
create policy "founders set the commission" on public.tech_commission for all to authenticated
  using ((select private.is_founder())) with check ((select private.is_founder()));
create policy "tech reads the commission" on public.tech_commission for select to authenticated using ((select private.is_tech()));
create policy "founders record payouts" on public.tech_payouts for all to authenticated
  using ((select private.is_founder())) with check ((select private.is_founder()));
create policy "tech reads payouts" on public.tech_payouts for select to authenticated using ((select private.is_tech()));
grant select, insert, update, delete on public.tech_commission, public.tech_payouts to authenticated;
grant all on public.tech_commission, public.tech_payouts to service_role;

-- Month by month over the commission period: Nile's total commission, the technical team's share, and whether it is paid.
create function public.tech_commission_statement()
returns table (month date, sessions bigint, commission_base bigint, rate numeric, amount bigint, paid_at timestamptz, paid_amount int)
language sql stable security definer set search_path = ''
as $$
  with c as (select * from public.tech_commission where id = 1),
  m as (select generate_series(date_trunc('month', c.start_date)::date,
                               least(date_trunc('month', current_date), date_trunc('month', c.start_date) + make_interval(months => c.months - 1))::date,
                               interval '1 month')::date as month from c)
  select m.month,
         count(s.id),
         coalesce(sum(f.commission), 0),
         c.rate,
         round(coalesce(sum(f.commission), 0) * c.rate / 100)::bigint,
         p.paid_at, p.amount
    from m cross join c
    left join public.sessions s on s.session_date >= greatest(m.month, c.start_date)
                                and s.session_date < (m.month + interval '1 month')::date
                                and s.session_date < (c.start_date + make_interval(months => c.months))::date
    left join public.session_fees f on f.session_id = s.id
    left join public.tech_payouts p on p.month = m.month
   where private.is_founder() or private.is_tech()
   group by m.month, c.rate, p.paid_at, p.amount
   order by m.month
$$;
revoke all on function public.tech_commission_statement() from public;
grant execute on function public.tech_commission_statement() to authenticated;

alter publication supabase_realtime add table public.client_errors, public.fee_defaults, public.tech_commission, public.tech_payouts;
