-- ===========================================================================
-- A tenant holding a code can tell whether it still works.
--
-- ONE PROBLEM IN FOUR PLACES. Tapping resend three times leaves three
-- identical-looking emails in an inbox and silently kills the first two. The
-- two dead ones then fail with the same sentence a typo produces, so somebody
-- reading top-down reaches for the wrong one and is told nothing useful.
--
-- The database already knows which case it is. It just never said.
--
--   consumed_reason   why a code stopped working: used, or superseded
--   issue_email_code  reports whether it replaced anything, so the email can say
--   verify_email_code returns a REASON rather than a boolean
--
-- NOT A DEFECT, checked before changing anything: issuing a sign_in code does
-- not touch a verify_email one. The consumption is scoped `and purpose =
-- p_purpose` and both survive. The two are independent and stay independent.
-- ===========================================================================

alter table public.tenant_email_codes
  add column if not exists consumed_reason text
    check (consumed_reason is null or consumed_reason in ('used', 'superseded'));

comment on column public.tenant_email_codes.consumed_reason is
  'Why this code stopped working. used = somebody entered it. superseded = a newer code replaced it. Null while it is still live.';

-- ---------------------------------------------------------------------------
-- Issuing: say whether this replaced anything.
-- ---------------------------------------------------------------------------
drop function if exists public.issue_email_code(text, text, text, integer);

create function public.issue_email_code(
  p_email text, p_purpose text, p_code_hash text, p_ttl_minutes integer
) returns table (allowed boolean, superseded boolean)
language plpgsql security definer set search_path to '' as $fn$
declare v_recent int; v_key text; v_killed int;
begin
  v_key := lower(btrim(p_email)) || ':' || p_purpose;
  perform pg_advisory_xact_lock(hashtext(v_key));

  select count(*) into v_recent
    from public.tenant_email_codes
   where lower(email) = lower(btrim(p_email))
     and purpose = p_purpose
     and created_at > now() - interval '1 hour';

  if v_recent >= 5 then
    allowed := false; superseded := false; return next; return;
  end if;

  -- Same purpose only. A sign-in code and an address-confirmation code prove
  -- different things and must not cancel each other.
  update public.tenant_email_codes
     set consumed_at = now(), consumed_reason = 'superseded'
   where lower(email) = lower(btrim(p_email))
     and purpose = p_purpose
     and consumed_at is null;
  get diagnostics v_killed = row_count;

  insert into public.tenant_email_codes (email, code_hash, purpose, expires_at)
  values (lower(btrim(p_email)), p_code_hash, p_purpose,
          now() + make_interval(mins => p_ttl_minutes));

  allowed := true; superseded := v_killed > 0; return next;
end $fn$;

revoke all on function public.issue_email_code(text, text, text, integer) from public, anon;
grant execute on function public.issue_email_code(text, text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Verifying: say WHY it failed.
--
-- 'superseded' is the one this exists for. It is only reachable by somebody who
-- holds a code we really did send, so it discloses nothing a guesser could use.
-- ---------------------------------------------------------------------------
drop function if exists public.verify_email_code(text, text, text);

create function public.verify_email_code(
  p_email text, p_purpose text, p_code_hash text
) returns table (ok boolean, reason text)
language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid; v_attempts int; v_hash text; v_expires timestamptz; v_old record;
begin
  update public.tenant_email_codes c
     set attempts = c.attempts + 1
   where c.id = (
     select c2.id from public.tenant_email_codes c2
      where lower(c2.email) = lower(btrim(p_email))
        and c2.purpose = p_purpose
        and c2.consumed_at is null
      order by c2.created_at desc limit 1 for update
   )
   returning c.id, c.attempts, c.code_hash, c.expires_at
        into v_id, v_attempts, v_hash, v_expires;

  if v_id is null then
    -- No live code. Did they type one we already retired? Then we can say so.
    select * into v_old from public.tenant_email_codes
     where lower(email) = lower(btrim(p_email)) and purpose = p_purpose
       and code_hash = p_code_hash
     order by created_at desc limit 1;
    if found then
      ok := false; reason := coalesce(v_old.consumed_reason, 'expired'); return next; return;
    end if;
    ok := false; reason := 'none'; return next; return;
  end if;

  if v_attempts > 5 then
    update public.tenant_email_codes
       set consumed_at = now(), consumed_reason = 'used' where id = v_id;
    ok := false; reason := 'exhausted'; return next; return;
  end if;

  if v_expires < now() then
    ok := false; reason := 'expired'; return next; return;
  end if;

  if v_hash <> p_code_hash then
    -- Wrong for the live code, but it may be one we superseded.
    select * into v_old from public.tenant_email_codes
     where lower(email) = lower(btrim(p_email)) and purpose = p_purpose
       and code_hash = p_code_hash and consumed_at is not null
     order by created_at desc limit 1;
    if found then
      ok := false; reason := coalesce(v_old.consumed_reason, 'superseded'); return next; return;
    end if;
    ok := false; reason := 'wrong'; return next; return;
  end if;

  update public.tenant_email_codes
     set consumed_at = now(), consumed_reason = 'used' where id = v_id;
  ok := true; reason := 'ok'; return next;
end $fn$;

revoke all on function public.verify_email_code(text, text, text) from public, anon;
grant execute on function public.verify_email_code(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Prove the reasons, without sending anything.
-- ---------------------------------------------------------------------------
do $$
declare v_e text := 'lifecycle.probe@example.invalid'; r record;
begin
  delete from public.tenant_email_codes where email = v_e;

  perform public.issue_email_code(v_e, 'verify_email', 'HASH_ONE', 10);
  select * into r from public.issue_email_code(v_e, 'verify_email', 'HASH_TWO', 10);
  if not r.superseded then raise exception 'the second issue did not report superseding the first'; end if;

  select * into r from public.verify_email_code(v_e, 'verify_email', 'HASH_ONE');
  if r.reason <> 'superseded' then raise exception 'an old code reported %, expected superseded', r.reason; end if;

  select * into r from public.verify_email_code(v_e, 'verify_email', 'NEVER_SENT');
  if r.reason <> 'wrong' then raise exception 'a guess reported %, expected wrong', r.reason; end if;

  select * into r from public.verify_email_code(v_e, 'verify_email', 'HASH_TWO');
  if not r.ok then raise exception 'the live code failed with %', r.reason; end if;

  select * into r from public.verify_email_code(v_e, 'verify_email', 'HASH_TWO');
  if r.reason <> 'used' then raise exception 'a spent code reported %, expected used', r.reason; end if;

  -- Independent purposes, asserted rather than assumed.
  perform public.issue_email_code(v_e, 'verify_email', 'V', 10);
  perform public.issue_email_code(v_e, 'sign_in', 'S', 10);
  if (select count(*) from public.tenant_email_codes
       where email = v_e and consumed_at is null) <> 2 then
    raise exception 'issuing one purpose consumed the other';
  end if;

  delete from public.tenant_email_codes where email = v_e;
end $$;
