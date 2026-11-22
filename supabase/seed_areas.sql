-- TEST DATA ONLY: rough coverage areas for the 4 demo doctors. Replace with the real areas
-- (drawn on the Coverage map page) once the founders send them. Points are [longitude, latitude].
insert into public.doctor_areas (doctor_id, coords, color)
select p.id, a.coords::jsonb, a.color
from (values
  ('dr.mona',    '[[31.300,30.030],[31.400,30.030],[31.420,30.080],[31.330,30.100],[31.290,30.070]]', '#e0583f'),  -- Nasr City
  ('dr.karim',   '[[31.290,30.085],[31.360,30.090],[31.370,30.140],[31.310,30.150],[31.280,30.120]]', '#1a5fa8'),  -- Heliopolis
  ('dr.salma',   '[[31.230,29.930],[31.310,29.930],[31.320,29.990],[31.250,30.000],[31.220,29.970]]', '#5fa84a'),  -- Maadi
  ('dr.youssef', '[[31.440,30.540],[31.560,30.540],[31.580,30.630],[31.470,30.650],[31.430,30.600]]', '#487878')   -- Zagazig
) as a(username, coords, color)
join public.profiles p on p.username = a.username and p.role = 'doctor'
on conflict (doctor_id) do update set coords = excluded.coords, color = excluded.color;
