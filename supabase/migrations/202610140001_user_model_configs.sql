-- Model configuration is only accessible through the trusted API/Worker.
-- The full JSON configuration is encrypted with AES-256-GCM before reaching Postgres.
begin;
create table public.user_model_configs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_config text not null check (encrypted_config like 'v1.%'),
  updated_at timestamptz not null default now()
);
alter table public.user_model_configs enable row level security;
-- No browser policies or grants, even for the owner. Never expose ciphertext via PostgREST.
revoke all on public.user_model_configs from public, anon, authenticated;
grant select, insert, update, delete on public.user_model_configs to service_role;
commit;
