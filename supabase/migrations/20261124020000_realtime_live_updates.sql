-- Live updates: the portal listens for changes on these tables (Supabase Realtime, postgres_changes) and
-- refreshes the open page. Realtime applies each table's RLS to every listener, so people only get
-- changes to rows they can already read. For DELETEs only the row id is sent (default replica identity).
-- Not included on purpose: chat_messages, founder_memory, ai_actions (private AI room).
alter publication supabase_realtime add table
  public.sessions, public.appointments, public.patients, public.patient_requests, public.doctor_areas,
  public.founder_events, public.session_fees, public.tech_notes, public.profiles, public.change_log;
