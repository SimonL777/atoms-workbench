-- Run once on the dedicated Supabase project. Auth is provided by Supabase.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null, description text not null default '',
  mode text not null check (mode in ('brainstorm','build')),
  current_version_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index projects_owner on public.projects(owner_id, updated_at desc);
create table public.spec_versions (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  content text not null, confirmed_at timestamptz, created_at timestamptz not null default now()
);
create table public.runs (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  request_id uuid not null unique, kind text not null check (kind in ('brainstorm','build')),
  input text not null, status text not null default 'queued' check (status in ('queued','running','waiting_for_user','succeeded','failed','cancelled','interrupted')),
  phase text not null default '等待开始', question jsonb, error text,
  resume_answer jsonb, plan text,
  base_version_id uuid, spec_id uuid references public.spec_versions(id),
  lease_owner uuid, heartbeat_at timestamptz, created_at timestamptz not null default now(), finished_at timestamptz
);
create index runs_queue on public.runs(status, created_at);
create unique index runs_one_running_per_project on public.runs(project_id) where status = 'running';
create table public.messages (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  run_id uuid references public.runs(id) on delete set null,
  role text not null check (role in ('user','assistant')),
  kind text not null default 'text' check (kind in ('text','question','spec','version','error')),
  content text not null, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.project_versions (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  run_id uuid not null unique references public.runs(id), parent_id uuid references public.project_versions(id),
  summary text not null, artifact_path text not null, checks jsonb not null,
  created_at timestamptz not null default now(), unique (id, project_id)
);
alter table public.projects add constraint projects_current_version_fk foreign key (current_version_id, id) references public.project_versions(id, project_id);
alter table public.runs add constraint runs_base_version_fk foreign key (base_version_id, project_id) references public.project_versions(id, project_id);
create table public.run_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  run_id uuid not null references public.runs(id) on delete cascade,
  kind text not null, summary text not null, created_at timestamptz not null default now()
);
create table public.app_records (
  project_id uuid not null references public.projects(id) on delete cascade,
  collection text not null check (collection ~ '^[a-zA-Z0-9_-]{1,48}$'),
  record_id text not null check (length(record_id) between 1 and 100),
  data jsonb not null, updated_at timestamptz not null default now(),
  primary key (project_id, collection, record_id)
);
create index messages_project on public.messages(project_id, created_at);
create index specs_project on public.spec_versions(project_id, created_at);
create index versions_project on public.project_versions(project_id, created_at);
create index events_project on public.run_events(project_id, id);

create function public.owns_project(target uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.projects where id = target and owner_id = (select auth.uid()));
$$;
revoke all on function public.owns_project(uuid) from public;
grant execute on function public.owns_project(uuid) to authenticated;

alter table public.projects enable row level security;
create policy projects_read on public.projects for select to authenticated using (owner_id = (select auth.uid()));
-- Platform-managed metadata is read-only to browser clients.
do $$ declare table_name text; begin
  foreach table_name in array array['spec_versions','runs','messages','project_versions','run_events','app_records'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy owner_read on public.%I for select to authenticated using (public.owns_project(project_id))', table_name);
  end loop;
end $$;
revoke all on public.projects, public.spec_versions, public.runs, public.messages, public.project_versions, public.run_events, public.app_records from anon, authenticated;
grant select on public.projects, public.spec_versions, public.runs, public.messages, public.project_versions, public.run_events, public.app_records to authenticated;
grant all on public.projects, public.spec_versions, public.runs, public.messages, public.project_versions, public.run_events, public.app_records to service_role;
grant usage, select on sequence public.run_events_id_seq to service_role;

create function public.claim_run(worker uuid) returns setof public.runs language plpgsql security definer set search_path = '' as $$
declare candidate uuid;
begin
  -- A stale process must lose its lease before another process can continue.
  update public.runs set status = 'interrupted', error = 'Worker heartbeat expired. Retry from the saved checkpoint.', lease_owner = null
    where status = 'running' and heartbeat_at < now() - interval '90 seconds';
  select r.id into candidate from public.runs r
    where r.status = 'queued'
      and not exists(select 1 from public.runs active where active.project_id = r.project_id and active.status in ('running','waiting_for_user'))
      and pg_try_advisory_xact_lock(hashtextextended(r.project_id::text, 0))
    order by r.created_at for update of r skip locked limit 1;
  if candidate is null then return; end if;
  return query update public.runs set status = 'running', lease_owner = worker, heartbeat_at = now()
    where id = candidate returning *;
end $$;
revoke all on function public.claim_run(uuid) from public, anon, authenticated;
grant execute on function public.claim_run(uuid) to service_role;

-- Source, execution checkpoints and built artifacts live on the platform host.
-- Only their version locator and metadata are stored here; no Storage bucket is needed.

create function public.publish_version(target_run uuid, target_worker uuid, version_id uuid, blob_path text, version_summary text, results jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare task public.runs; project public.projects;
begin
  select * into task from public.runs where id = target_run for update;
  if task.status <> 'running' or task.lease_owner is distinct from target_worker then raise exception 'RUN_LEASE_LOST'; end if;
  select * into project from public.projects where id = task.project_id for update;
  if project.current_version_id is distinct from task.base_version_id then raise exception 'BASE_VERSION_CHANGED'; end if;
  insert into public.project_versions(id,project_id,run_id,parent_id,summary,artifact_path,checks)
    values(version_id,task.project_id,task.id,task.base_version_id,version_summary,blob_path,results);
  update public.projects set current_version_id = version_id, updated_at = now() where id = task.project_id;
  update public.runs set status = 'succeeded', phase = '已交付', finished_at = now() where id = target_run;
  return version_id;
end $$;
revoke all on function public.publish_version(uuid,uuid,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.publish_version(uuid,uuid,uuid,text,text,jsonb) to service_role;

create function public.restore_version(target_project uuid, target_version uuid) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.projects where id = target_project for update;
  if not exists(select 1 from public.project_versions where id = target_version and project_id = target_project) then raise exception 'VERSION_NOT_FOUND'; end if;
  if exists(select 1 from public.runs where project_id = target_project and status in ('running','queued','waiting_for_user')) then raise exception 'PROJECT_BUSY'; end if;
  update public.projects set current_version_id = target_version, updated_at = now() where id = target_project;
  return target_version;
end $$;
revoke all on function public.restore_version(uuid,uuid) from public, anon, authenticated;
grant execute on function public.restore_version(uuid,uuid) to service_role;
