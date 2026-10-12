insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
insert into public.projects(id,owner_id,name,mode) values
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Owner A','build'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','Owner B','build');
insert into public.app_records(project_id,collection,record_id,data) values
 ('10000000-0000-4000-8000-000000000001','notes','a','{"text":"A"}'),
 ('10000000-0000-4000-8000-000000000002','notes','b','{"text":"B"}');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
do $$ begin
 if (select count(*) from public.projects) <> 1 then raise exception 'Owner project isolation failed'; end if;
 if (select count(*) from public.app_records) <> 1 then raise exception 'Owner record isolation failed'; end if;
 if public.owns_project('10000000-0000-4000-8000-000000000002') then raise exception 'Cross-owner visibility'; end if;
 begin
  insert into public.projects(owner_id,name,mode) values(auth.uid(),'Bypass API','build');
  raise exception 'Browser write unexpectedly allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.claim_run('20000000-0000-4000-8000-000000000001');
  raise exception 'Browser worker access unexpectedly allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
 begin perform 1 from public.projects; raise exception 'Anonymous read unexpectedly allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
insert into public.runs(id,project_id,request_id,kind,input,created_at) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','build','First',now()-interval '2 minutes'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','build','Second',now());
do $$ declare claimed public.runs; begin
 select * into claimed from public.claim_run('20000000-0000-4000-8000-000000000001');
 if claimed.id is distinct from '30000000-0000-4000-8000-000000000001'::uuid then raise exception 'Claim order failed'; end if;
 if (select count(*) from public.claim_run('20000000-0000-4000-8000-000000000002')) <> 0 then raise exception 'Concurrent project claim allowed'; end if;
 begin
  perform public.publish_version(claimed.id,'20000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000001','test/blob','Bad lease','{}');
  raise exception 'Invalid lease published';
 exception when raise_exception then if sqlerrm <> 'RUN_LEASE_LOST' then raise; end if; end;
 perform public.publish_version(claimed.id,'20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','test/blob','First version','{"build":true}');
 if (select status from public.runs where id=claimed.id) <> 'succeeded' then raise exception 'Publish was not atomic'; end if;
 if (select current_version_id from public.projects where id=claimed.project_id) is distinct from '50000000-0000-4000-8000-000000000001'::uuid then raise exception 'Version pointer missing'; end if;
end $$;
do $$ declare claimed public.runs; begin
 select * into claimed from public.claim_run('20000000-0000-4000-8000-000000000001');
 begin
  perform public.publish_version(claimed.id,'20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','test/blob2','Stale version','{}');
  raise exception 'Stale source published';
 exception when raise_exception then if sqlerrm <> 'BASE_VERSION_CHANGED' then raise; end if; end;
 begin
  perform public.restore_version('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001');
  raise exception 'Busy project restored';
 exception when raise_exception then if sqlerrm <> 'PROJECT_BUSY' then raise; end if; end;
 update public.runs set heartbeat_at=now()-interval '2 minutes' where id=claimed.id;
 perform public.claim_run('20000000-0000-4000-8000-000000000002');
 if (select status from public.runs where id=claimed.id) <> 'interrupted' then raise exception 'Expired lease remains active'; end if;
 perform public.restore_version('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001');
 begin
  perform public.restore_version('10000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000001');
  raise exception 'Cross-project version restored';
 exception when raise_exception then if sqlerrm <> 'VERSION_NOT_FOUND' then raise; end if; end;
end $$;
reset role;
select 'PASS: RLS ownership, read-only clients, run serialization, expired leases, atomic publication, version CAS and restore guards' as result;
