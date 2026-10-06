-- ===========================================================================
-- Two check-then-act races in the code functions I shipped in 20260812230000.
-- Both found by adversarial review, both confirmed against the code.
--
-- RACE 1: the attempt cap was decided on a stale read.
--   select ... into c          -- no lock
--   update ... attempts + 1
--   if c.attempts + 1 > 5      -- the value read BEFORE the update
-- Overlapping calls all read the same committed value, all pass the guard, and
-- all reach the comparison. The cap degraded from five guesses to roughly the
-- attacker's concurrency. The correct pattern was already in this repo:
-- bump_rate_limit (20260703150645:24-32) is a single atomic upsert with
-- RETURNING, and I did not use it.
--
-- RACE 2: the five-per-hour issue cap was a count-then-insert.
-- Concurrent calls all counted zero and all inserted, so the cap did not bind.
-- The same race also broke the "only one live code" invariant, because each
-- transaction's "consume the previous ones" matched no committed rows, leaving
-- several codes live at once and several attempt budgets to walk through.
--
-- Neither is a full takeover on its own, and both erode a control this file's
-- own header claims. A migration that says "five of a million rather than
-- unlimited" and then does not deliver five is worse than one that says nothing.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Issuing: serialised per address, so the count cannot be raced.
--
-- An advisory transaction lock rather than a table lock: it is keyed on the
-- address, so two different addresses never wait on each other, and it is
-- released at commit with no cleanup path to forget.
-- ---------------------------------------------------------------------------
create or replace function public.issue_email_code(
  p_email text, p_purpose text, p_code_hash text, p_ttl_minutes int default 10
) returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare v_recent int; v_key text;
begin
  v_key := lower(btrim(p_email)) || ':' || p_purpose;
  perform pg_advisory_xact_lock(hashtext(v_key));

  select count(*) into v_recent
  from public.tenant_email_codes
  where lower(email) = lower(btrim(p_email))
    and purpose = p_purpose
    and created_at > now() - interval '1 hour';

  if v_recent >= 5 then
    return false;
  end if;

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
-- Verifying: the increment IS the check.
--
-- One statement locks the row, increments, and returns the POST-increment
-- value, so there is no window between deciding and acting. Everything after
-- branches on what was actually written.
-- ---------------------------------------------------------------------------
create or replace function public.verify_email_code(
  p_email text, p_purpose text, p_code_hash text
) returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; v_attempts int; v_hash text; v_expires timestamptz;
begin
  update public.tenant_email_codes c
     set attempts = c.attempts + 1
   where c.id = (
     select c2.id from public.tenant_email_codes c2
      where lower(c2.email) = lower(btrim(p_email))
        and c2.purpose = p_purpose
        and c2.consumed_at is null
      order by c2.created_at desc
      limit 1
      for update            -- concurrent callers queue here rather than racing
   )
  returning c.id, c.attempts, c.code_hash, c.expires_at
       into v_id, v_attempts, v_hash, v_expires;

  if v_id is null then return false; end if;      -- no live code for this address

  -- The written value, not a snapshot. The sixth attempt burns the code.
  if v_attempts > 5 then
    update public.tenant_email_codes set consumed_at = now() where id = v_id;
    return false;
  end if;

  if v_expires < now() then return false; end if;
  if length(v_hash) <> length(p_code_hash) then return false; end if;
  if v_hash <> p_code_hash then return false; end if;

  update public.tenant_email_codes set consumed_at = now() where id = v_id;
  return true;
end $function$;

comment on function public.verify_email_code(text, text, text) is
  'True only for a live, unconsumed, unexpired code with attempts to spare. The increment and the cap check are ONE locked statement, so concurrent guesses queue rather than each getting a free attempt: the previous version decided on a pre-update snapshot and the cap degraded to the attacker''s concurrency.';

-- A second live code for one address should now be impossible. Assert it rather
-- than trust the lock, because this is the invariant the attempt budget rests on.
do $$
declare v_dupes int;
begin
  select count(*) into v_dupes from (
    select lower(email) e, purpose p
    from public.tenant_email_codes
    where consumed_at is null and expires_at > now()
    group by 1, 2 having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise warning '% address/purpose pair(s) have more than one live code. Pre-existing from the raced version; they expire within ten minutes.', v_dupes;
  end if;
end $$;
