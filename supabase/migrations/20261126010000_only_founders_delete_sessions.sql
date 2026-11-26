-- Only founders delete sessions. Deleting a session also deletes its price and commission (session_fees cascades) and
-- those are not kept in the change history, so a doctor's delete could lose the record the commission is paid from.
-- Doctors can still add and edit their own sessions; to remove one they ask a founder.
drop policy "doctors delete own sessions, founders delete all" on public.sessions;
create policy "founders delete sessions" on public.sessions for delete to authenticated
  using ((select private.is_founder()));
