-- Files in the AI room: each founder can attach images, PDFs and text files to a chat message.
-- Files live in a PRIVATE storage bucket, in a folder named after the founder's id; only that
-- founder can upload, see or delete them (the other founders and doctors can't).

alter table public.chat_messages add column attachments jsonb not null default '[]'::jsonb;
-- attachments: [{ path, name, type, size }]  (path = "<founder id>/<random>-<file name>")

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-files', 'chat-files', false, 10 * 1024 * 1024,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv', 'text/markdown'])
on conflict (id) do nothing;

create policy "founder uploads own chat files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-files' and (storage.foldername(name))[1] = (select auth.uid())::text and (select private.is_founder()));

create policy "founder reads own chat files" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-files' and (storage.foldername(name))[1] = (select auth.uid())::text and (select private.is_founder()));

create policy "founder deletes own chat files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-files' and (storage.foldername(name))[1] = (select auth.uid())::text and (select private.is_founder()));
