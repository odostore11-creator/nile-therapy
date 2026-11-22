-- Per-patient totals for the Patients page (uses the caller's own permissions).
create view public.patient_stats with (security_invoker = true) as
select patient_id, count(*) as sessions, max(session_date) as last_session, array_agg(distinct doctor_id) as doctor_ids
  from public.sessions where patient_id is not null group by patient_id;
revoke all on public.patient_stats from anon, authenticated;
grant select on public.patient_stats to authenticated, service_role;
