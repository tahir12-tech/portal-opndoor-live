-- =========================================================================
-- AN ADMIN REVOKES ONE KEY, WHERE THE KEYS ARE.
--
-- Matt, 2026-10-02: "Supplier Integration tab: Opndoor admin can revoke a
-- single key here. List each active key by its name, when it was created
-- and when it was last used, each with a Revoke button and a
-- confirmation ('This key stops working immediately. Their other keys
-- keep working.'). Admin still never sees or creates a full key. Record
-- who revoked what and when. Update the wording on this tab to match,
-- removing any mention of Break glass or the Dev Centre for admin."
--
-- WHY A THIRD FUNCTION AND NOT ONE OF THE TWO THAT EXIST.
--
--   `dev_revoke_api_key(uuid)` is the developer's own, and refuses an
--   admin outright: its guard is `app_role() in ('developer',
--   'management') and v_partner = app_partner()`. Widening it to admit
--   `is_admin()` would make one function mean two things and would put
--   an estate-wide power behind a guard written for a partner-scoped
--   one.
--
--   `admin_break_glass_revoke_key(text, text)` is admin's, and is the
--   wrong shape for this screen twice over: it takes a PREFIX, which is
--   the thing admin is not shown, and it demands a ten-character reason,
--   which is right for an incident and wrong for a button next to the
--   key it acts on. It stays exactly as it is, for the incident path.
--
-- SO: BY ID, ADMIN ONLY, NO REASON, AND RECORDED. The id comes from
-- `dev_api_keys`, which admin may already read, so this adds no new
-- visibility -- only the act. Recorded through `record_security_event`,
-- the same ledger break glass writes to, so "who revoked what and when"
-- has one place to be read rather than two.
--
-- NO REASON FIELD IS NOT A WEAKENING. Break glass demands one because
-- nothing on that screen says which key is which: an admin types a
-- prefix they got from somewhere. Here the act names its own object --
-- the row the button sits on -- and the event records the key, the
-- supplier and the person. A mandatory free-text box on a one-click
-- action gets filled with "x" and is worth less than the row it
-- interrupts.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- FIRST, SOMETHING FOR ADMIN TO READ. `dev_api_keys` deliberately has no
-- admin arm -- its own comment says so: "An opndoor admin gets zero rows,
-- including with an explicit p_partner: the argument is not consulted for
-- them at all." That is exactly why the old wording sent admin to Break
-- glass with a prefix they had to get from somewhere else.
--
-- Matt now wants the keys ON this tab, so admin needs a reader. Not that
-- one widened: it returns the PREFIX, the scopes and the request count,
-- which is the developer's working view, and "admin still never sees or
-- creates a full key" is easier to keep true of a function that cannot
-- return one than of a caller that chooses not to print it.
--
-- SO: THE FOUR FACTS THE SCREEN SHOWS, AND THE TWO IT FILTERS ON. Name,
-- created, last used, and the id to act on; revoked_at and expires_at so
-- "active" is decided from the row rather than guessed. No prefix, no
-- hash, no scopes.
-- ---------------------------------------------------------------------------
create or replace function public.admin_supplier_api_keys(p_partner uuid)
returns table (
  id uuid, name text, created_at timestamptz, last_used_at timestamptz,
  revoked_at timestamptz, expires_at timestamptz
)
language sql stable security definer set search_path to '' as $$
  select k.id, k.name, k.created_at, k.last_used_at, k.revoked_at, k.expires_at
  from public.partner_api_keys k
  where public.is_aal2() and public.is_admin()
    and k.partner_id = p_partner
  order by k.created_at desc, k.id desc;
$$;

comment on function public.admin_supplier_api_keys(uuid) is
  'One supplier''s API keys for the Integration tab: name, created, last used, and the id to revoke. Opndoor admin only. Deliberately returns no prefix, hash or scopes, so "admin never sees a key" is a property of the function rather than of its caller.';

revoke all on function public.admin_supplier_api_keys(uuid) from public, anon;
grant execute on function public.admin_supplier_api_keys(uuid) to authenticated, service_role;

create or replace function public.admin_revoke_partner_api_key(p_id uuid)
returns table (revoked boolean, partner_name text, key_name text)
language plpgsql security definer set search_path to ''
as $function$
declare k record; v_actor uuid := auth.uid(); v_who text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;

  select key.id, key.name, key.partner_id, key.revoked_at, key.key_prefix, p.name as pname
    into k
  from public.partner_api_keys key
  join public.partners p on p.id = key.partner_id
  where key.id = p_id;

  if k.id is null then raise exception 'Key not found.' using errcode = '22023'; end if;

  v_who := coalesce((select full_name from public.users where id = v_actor), 'an opndoor admin');

  /* ALREADY GONE IS NOT AN ERROR. Two admins on the same incident, or one
     admin and the supplier's own developer, is the likely way this
     happens, and the second of them should be told the key is off rather
     than shown a failure. */
  if k.revoked_at is not null then
    return query select false, k.pname, k.name;
    return;
  end if;

  update public.partner_api_keys set revoked_at = now() where id = k.id;

  /* WHO REVOKED WHAT AND WHEN, in the ledger break glass already writes
     to. Named permanently: "who could have done this" should have a
     one-name answer. The prefix is in the record because that is what
     identifies the key in a log the supplier's developer will also be
     reading; it is not shown on the screen. */
  perform public.record_security_event(
    'admin_revoke_api_key', 'warn', k.partner_id, v_actor, k.id, null,
    format('%s revoked API key "%s" (%s) belonging to %s, from the supplier''s Integration tab.',
           v_who, k.name, left(k.key_prefix, 18), k.pname));

  return query select true, k.pname, k.name;
end $function$;

comment on function public.admin_revoke_partner_api_key(uuid) is
  'Revoke one partner API key by id, from the supplier''s Integration tab. Opndoor admin only, behind MFA, recorded to security_events. Distinct from dev_revoke_api_key (the partner''s own, by id) and admin_break_glass_revoke_key (by prefix, with a reason, for an incident).';

revoke all on function public.admin_revoke_partner_api_key(uuid) from public, anon;
grant execute on function public.admin_revoke_partner_api_key(uuid) to authenticated, service_role;
