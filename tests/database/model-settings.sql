set role service_role;
insert into public.user_model_configs(user_id,encrypted_config) values
 ('00000000-0000-4000-8000-000000000001','v1.test-encrypted-A'),
 ('00000000-0000-4000-8000-000000000002','v1.test-encrypted-B');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
do $$ begin
 if has_table_privilege(current_user,'public.user_model_configs','SELECT,INSERT,UPDATE,DELETE') then
  raise exception 'Browser has model config privileges';
 end if;
 begin
  perform encrypted_config from public.user_model_configs where user_id=auth.uid();
  raise exception 'Owner could read encrypted credential';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.user_model_configs(user_id,encrypted_config) values(auth.uid(),'v1.client');
  raise exception 'Browser could modify model configuration';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
 if has_table_privilege(current_user,'public.user_model_configs','SELECT,INSERT,UPDATE,DELETE') then
  raise exception 'Anonymous model config access';
 end if;
end $$;
reset role;
set role service_role;
do $$ begin
 if (select count(*) from public.user_model_configs) <> 2 then raise exception 'Service access failed'; end if;
 update public.user_model_configs set encrypted_config='v1.replaced' where user_id='00000000-0000-4000-8000-000000000001';
 if (select encrypted_config from public.user_model_configs where user_id='00000000-0000-4000-8000-000000000002') <> 'v1.test-encrypted-B' then raise exception 'Cross-user update'; end if;
end $$;
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000002';
do $$ begin
 if exists(select 1 from public.user_model_configs where user_id='00000000-0000-4000-8000-000000000002') then raise exception 'Credential retained after account deletion'; end if;
end $$;
select 'PASS: model ciphertext inaccessible to browsers, service-only writes, per-user rows and account deletion cascade' as result;
