-- Supabase scaffolding. Roles live in roles.sql (cluster-wide).
create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists storage;
create schema if not exists cron;
create schema if not exists net;
create schema if not exists vault;
create schema if not exists graphql_public;

create extension if not exists pgcrypto  with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- auth.users, trimmed to the columns this codebase touches.
create table auth.users (
  id uuid primary key,
  instance_id uuid,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  phone text,
  deleted_at timestamptz,
  -- Supabase's auth.users carries these NOT NULL-ish token columns; the
  -- fixtures insert them explicitly, so they have to exist locally too.
  confirmation_token varchar(255) default '',
  recovery_token varchar(255) default '',
  email_change varchar(255) default '',
  email_change_token_new varchar(255) default '',
  email_change_token_current varchar(255) default '',
  phone_change varchar(255) default '',
  phone_change_token varchar(255) default '',
  reauthentication_token varchar(255) default '',
  confirmation_sent_at timestamptz,
  recovery_sent_at timestamptz,
  banned_until timestamptz,
  is_sso_user boolean not null default false,
  is_anonymous boolean not null default false
);
create table auth.identities (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null,
  provider text not null,
  identity_data jsonb not null,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  email text,
  unique (provider_id, provider)
);
create index on auth.identities(user_id);

create table auth.sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  aal text
);
create table auth.mfa_factors (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friendly_name text,
  factor_type text,
  status text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  secret text
);
create index on auth.mfa_factors(user_id);

-- The request-scoped accessors. Same bodies Supabase ships.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
create or replace function auth.email() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

create table storage.buckets (
  id text primary key, name text not null, owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  public boolean default false
);
create table storage.objects (
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(), metadata jsonb
);
create table vault.secrets (
  id uuid primary key default extensions.gen_random_uuid(),
  name text unique, description text, secret text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create view vault.decrypted_secrets as
  select id, name, description, secret as decrypted_secret, created_at, updated_at
    from vault.secrets;

grant usage on schema auth, extensions, storage, net, cron, vault, graphql_public
  to anon, authenticated, service_role, postgres;
grant execute on function auth.uid(), auth.jwt(), auth.role(), auth.email()
  to anon, authenticated, service_role;
grant all on all tables in schema auth, storage, vault to service_role, postgres;

-- THE ONE THAT MATTERS FOR THE SECURITY TESTS. Supabase grants ALL on every
-- NEW public table to anon and authenticated by default. Several findings
-- turn on that, so a local database without it would measure a different
-- product. B19 is entirely about this.
alter default privileges in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
grant usage, create on schema public to postgres, anon, authenticated, service_role;
