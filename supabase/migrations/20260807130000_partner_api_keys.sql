-- Partner API keys. See PARTNER-API.md section 4.
--
-- Machine credentials for partners POSTing applications from their own systems.
-- Nothing else in this schema authenticates a non-human caller: create_referral
-- requires an AAL2 session and reads auth.uid(), so no existing credential type
-- can drive a machine-to-machine path.
--
-- SCOPING. partner_id here is the scoping mechanism for every partner-facing
-- read and write. It is derived from the presented key and never from a request
-- payload. This mirrors how the rest of the schema already behaves: partner_id
-- on branches, contacts and applications is overwritten by trigger from the
-- parent record rather than trusted from the caller.
--
-- NO RLS POLICIES, DELIBERATELY. Every table in this schema carries a
-- restrictive AAL2 policy for `authenticated`, which an API-key request can
-- never satisfy because it has no session to step up. Verification therefore
-- runs as service_role inside an Edge Function, exactly as rate_limit does
-- (20260703150645). RLS provides no protection on that path, so partner scoping
-- is entirely the Edge Function's responsibility and every query must filter on
-- the partner_id derived from the key.

create table if not exists public.partner_api_keys (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid not null references public.partners(id) on delete cascade,

  -- Human label, e.g. 'Rightmove production'. Shown in admin UI, never to the partner.
  name         text not null,

  -- Identifying prefix, stored in clear. NOT a secret: it is the lookup handle.
  key_prefix   text not null unique,

  -- SHA-256 of the full key, lowercase hex.
  key_hash     text not null,

  scopes       text[] not null default '{}',

  created_at   timestamptz not null default now(),
  created_by   uuid references public.users(id) on delete set null,
  expires_at   timestamptz,   -- null: no expiry
  revoked_at   timestamptz,   -- null: live
  last_used_at timestamptz
);

-- MULTIPLE LIVE KEYS PER PARTNER ARE INTENTIONAL. There is deliberately no
-- unique constraint on partner_id. Rotation is: issue the new key, partner
-- deploys it, confirm traffic moved via last_used_at, revoke the old one. No
-- coordinated cutover and no window where the partner has no working key.
create index if not exists partner_api_keys_partner_idx on public.partner_api_keys (partner_id);

-- Supports the "is this key live" filter without a second lookup.
create index if not exists partner_api_keys_live_idx
  on public.partner_api_keys (partner_id)
  where revoked_at is null;

alter table public.partner_api_keys enable row level security;
revoke all on table public.partner_api_keys from anon, authenticated;

comment on table public.partner_api_keys is
  'Per-partner machine credentials for the partner API. Stores a SHA-256 hash, never the key. Service-role only: no RLS policies, because an API-key request cannot satisfy the restrictive AAL2 policy every other table carries.';
comment on column public.partner_api_keys.key_prefix is
  'First 18 characters of the key, stored in clear as the lookup handle. Not a secret. Unique so a lookup returns at most one row.';
comment on column public.partner_api_keys.key_hash is
  'SHA-256 of the full key, lowercase hex. See the note on hashing in PARTNER-API.md section 4.2: the key is high-entropy random, not a password, so a deliberately slow KDF would only make the unauthenticated path a CPU exhaustion vector.';
comment on column public.partner_api_keys.scopes is
  'Independent of partners.referencing_mode. Mode says how an application is referenced; scopes say what a key may do. No code path may infer one from the other.';

-- ---------- issuing a key ----------
-- Minting is deliberately NOT an RPC here. Hashing has to happen outside
-- Postgres: SHA-256 in SQL needs pgcrypto's digest(), and this schema does not
-- enable pgcrypto (see 20260703153500, which enables only pg_cron and pg_net).
-- Adding an extension solely to mint credentials is a poor trade.
--
-- Until an admin endpoint exists, a key is issued by generating it and its hash
-- outside the database and inserting the hash:
--
--   key    = 'opnd_live_' + 32 random base62 characters
--   prefix = first 18 characters of key
--   hash   = sha256(key), lowercase hex
--
--   insert into public.partner_api_keys (partner_id, name, key_prefix, key_hash, scopes)
--   values ('<partner uuid>', 'Rightmove production', '<prefix>', '<hash>',
--           array['applications:write','orgs:read']);
--
-- The plaintext key is shown once, at creation, and is not recoverable.
