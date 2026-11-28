-- Working hours per doctor (and founder), from "Nile Therapy Drs (1).xlsx" (2026-11-28). Shown on doctor cards and
-- profiles; founders edit it like the other profile fields (RLS already limits profile edits to founders).
alter table public.profiles add column if not exists availability text not null default '' check (char_length(availability) <= 120);
grant update (availability) on public.profiles to authenticated;

update public.profiles p set availability = v.hours
  from (values
    ('abdelrahman', 'Sun–Thu · 10:00 AM – 10:00 PM'), ('ahmed', 'Sat–Thu · 10:00 AM – 10:00 PM'),
    ('essam', 'Sat, Mon, Wed · 10:00 AM – 10:00 PM'), ('tawfik', 'Sun, Tue, Thu · 10:00 AM – 10:00 PM'),
    ('ibrahim', 'Sat–Thu · 10:00 AM – 10:00 PM'), ('mostafa', 'Sun–Thu · 10:00 AM – 10:00 PM'),
    ('zeiad', 'Sat, Mon, Wed · 10:00 AM – 10:00 PM'), ('sherif', 'Sat, Mon, Wed · 10:00 AM – 10:00 PM'),
    ('abdullah', 'Sat, Mon, Wed · 10:00 AM – 10:00 PM'), ('yousef', 'Sun–Thu · 10:00 AM – 10:00 PM'),
    ('abdelaziz', 'Sun–Thu · 10:00 AM – 10:00 PM'), ('hamdy', 'Sun–Thu · 10:00 AM – 10:00 PM')
  ) v(username, hours)
 where p.username = v.username;

-- The hours used to sit in the bio as "Availability: …"; they have their own field now.
update public.profiles set bio = '' where bio like 'Availability: %' and bio not like '%' || chr(10) || '%';
