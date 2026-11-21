-- Chat file permissions. Needs the seed data. Always rolls back:
-- success -> error "ALL CHAT FILE CHECKS PASSED", failure -> error "FAIL: ...".
do $$
declare abd uuid; f2 uuid; mona uuid; n int; failed boolean;
begin
  select id into abd  from public.profiles where username = 'abdurrahman';
  select id into f2   from public.profiles where username = 'founder2';
  select id into mona from public.profiles where username = 'dr.mona';

  -- founder uploads into their own folder
  perform set_config('request.jwt.claims', json_build_object('sub', abd, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name) values ('chat-files', abd || '/test-1.pdf');
  select count(*) into n from storage.objects where bucket_id = 'chat-files';
  if n <> 1 then raise exception 'FAIL: founder cannot see own file'; end if;
  failed := false;
  begin insert into storage.objects (bucket_id, name) values ('chat-files', f2 || '/sneaky.pdf'); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: founder wrote into another founders folder'; end if;
  reset role;

  -- another founder can't see it
  perform set_config('request.jwt.claims', json_build_object('sub', f2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from storage.objects where bucket_id = 'chat-files';
  if n <> 0 then raise exception 'FAIL: another founder can see the file'; end if;
  reset role;

  -- a doctor can't upload, even into their own folder
  perform set_config('request.jwt.claims', json_build_object('sub', mona, 'role', 'authenticated')::text, true);
  set local role authenticated;
  failed := false;
  begin insert into storage.objects (bucket_id, name) values ('chat-files', mona || '/x.pdf'); exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: a doctor could upload chat files'; end if;
  select count(*) into n from storage.objects where bucket_id = 'chat-files';
  if n <> 0 then raise exception 'FAIL: a doctor can see chat files'; end if;
  reset role;

  -- not logged in
  set local role anon;
  failed := false;
  begin select count(*) into n from storage.objects where bucket_id = 'chat-files'; if n = 0 then failed := true; end if;
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: anonymous visitor can see chat files'; end if;
  reset role;

  raise exception 'ALL CHAT FILE CHECKS PASSED (own folder only, other founders and doctors locked out, anonymous sees nothing). Rolled back.';
end $$;
