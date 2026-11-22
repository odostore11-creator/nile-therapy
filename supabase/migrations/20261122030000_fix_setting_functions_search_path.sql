-- Supabase security advisor: pin the search_path of the small settings functions.
alter function private.daily_limit() set search_path = '';
alter function private.open_window() set search_path = '';
alter function private.max_outside_km() set search_path = '';
