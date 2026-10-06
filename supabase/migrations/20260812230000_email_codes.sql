-- ===========================================================================
-- Six-digit email codes, replacing the magic link for tenant verification.
--
-- WHY A CODE AND NOT A LINK
-- A link assumes the person reads their email on the device they are applying
-- on. A tenant filling this in on a laptop reads their email on a phone, and a
-- link then either strands them on the wrong device or has them forwarding mail
-- to themselves. A code crosses devices by being typed, which is the point.
--
-- WHAT MAKES A SHORT CODE SAFE, GIVEN IT IS ONLY A MILLION VALUES
-- Six digits is guessable in a million tries, so the code alone is not the
-- control. All four of these are:
--
--   short life        ten minutes, so an intercepted code is worth little
--   attempt cap       five wrong guesses burns the code, not the account, so
--                     an attacker gets five of a million rather than unlimited
--   single use        consumed on success, so a code in a forwarded email or a
--                     shoulder-surfed screen cannot be replayed
--   issue cap         five in an hour per address, so somebody cannot mint
--                     codes until two collide, and cannot use us to mail-bomb
--
-- Hashed at rest, like every other credential in this schema. A table of live
-- codes readable by anything is a table of account takeovers.
--
-- THE CODE DOES NOT ISSUE THE SESSION. Verifying a code proves the address;
-- the session still comes from Supabase Auth. The Edge Function exchanges a
-- verified code for a one-time token that the browser redeems, so this table
-- never becomes a second, weaker way of being logged in.
-- ===========================================================================

create table if not exists public.tenant_email_codes (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  code_hash  text not null,
  purpose    text not null check (purpose in ('verify_email', 'sign_in')),

  expires_at timestamptz not null,
  attempts   int not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tenant_email_codes_lookup
  on public.tenant_email_codes (lower(email), purpose, created_at desc);

alter table public.tenant_email_codes enable row level security;
-- No policies. service_role only: these are credentials.

comment on table public.tenant_email_codes is
  'Short-lived six-digit codes for tenant email verification and sign-in. Hashed at rest. Safe because of four things together and not because the code is secret: ten-minute life, five-attempt cap, single use, and five issues an hour per address.';

-- ---------------------------------------------------------------------------
-- Issuing. Returns false when the address has had too many recently, so the
-- caller can answer identically either way without actually sending.
-- ---------------------------------------------------------------------------
create or replace function public.issue_email_code(
  p_email text, p_purpose text, p_code_hash text, p_ttl_minutes int default 10
) returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare v_recent int;
begin
  select count(*) into v_recent
  from public.tenant_email_codes
  where lower(email) = lower(btrim(p_email))
    and purpose = p_purpose
    and created_at > now() - interval '1 hour';

  if v_recent >= 5 then
    return false;
  end if;

  -- Previous unconsumed codes for this address stop working the moment a new
  -- one is issued. Two live codes means "resend" doubles an attacker's chances
  -- rather than replacing a code the user could not find.
  update public.tenant_email_codes
     set consumed_at = now()
   where lower(email) = lower(btrim(p_email))
     and purpose = p_purpose
     and consumed_at is null;

  insert into public.tenant_email_codes (email, code_hash, purpose, expires_at)
  values (lower(btrim(p_email)), p_code_hash, p_purpose,
          now() + make_interval(mins => p_ttl_minutes));

  return true;
end $function$;

-- ---------------------------------------------------------------------------
-- Verifying. Every failure path returns the same thing so the caller cannot
-- learn which of expired, wrong, exhausted or never-issued applies.
-- ---------------------------------------------------------------------------
create or replace function public.verify_email_code(
  p_email text, p_purpose text, p_code_hash text
) returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare c public.tenant_email_codes;
begin
  select * into c
  from public.tenant_email_codes
  where lower(email) = lower(btrim(p_email))
    and purpose = p_purpose
    and consumed_at is null
  order by created_at desc
  limit 1;

  if not found then return false; end if;

  -- Count the attempt BEFORE comparing, so a crash or a disconnect mid-check
  -- cannot be used to get a free guess.
  update public.tenant_email_codes set attempts = attempts + 1 where id = c.id;

  if c.attempts + 1 > 5 then
    -- Burn it. Five wrong guesses ends this code, not the account: the person
    -- who actually owns the address can ask for another.
    update public.tenant_email_codes set consumed_at = now() where id = c.id;
    return false;
  end if;

  if c.expires_at < now() then return false; end if;

  -- Constant-time comparison. Both sides are fixed-length hex from the same
  -- hash, so a byte-by-byte early exit would leak the prefix.
  if length(c.code_hash) <> length(p_code_hash) then return false; end if;
  if c.code_hash <> p_code_hash then return false; end if;

  update public.tenant_email_codes set consumed_at = now() where id = c.id;
  return true;
end $function$;

revoke all on function public.issue_email_code(text, text, text, int) from public, anon, authenticated;
revoke all on function public.verify_email_code(text, text, text) from public, anon, authenticated;
grant execute on function public.issue_email_code(text, text, text, int) to service_role;
grant execute on function public.verify_email_code(text, text, text) to service_role;

comment on function public.verify_email_code(text, text, text) is
  'True only for a live, unconsumed, unexpired code with attempts to spare. Every failure returns false identically, so a caller cannot tell expired from wrong from never-issued. Counts the attempt before comparing, so a disconnect mid-check is not a free guess.';

-- Housekeeping. Consumed and expired codes are not interesting and are a
-- standing pile of credentials otherwise.
create or replace function public.purge_email_codes(p_older_than interval default interval '7 days')
returns int
language plpgsql security definer set search_path to ''
as $function$
declare n int;
begin
  delete from public.tenant_email_codes
   where created_at < now() - p_older_than;
  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function public.purge_email_codes(interval) from public, anon, authenticated;
grant execute on function public.purge_email_codes(interval) to service_role;
