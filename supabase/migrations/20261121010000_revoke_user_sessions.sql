-- Log a user out on every device (used after a password reset).
-- Only the server (service_role, inside Edge Functions) may call it.
create function public.revoke_user_sessions(uid uuid) returns void
language sql security definer set search_path = ''
as $$
  delete from auth.sessions where user_id = uid;
$$;

revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;
