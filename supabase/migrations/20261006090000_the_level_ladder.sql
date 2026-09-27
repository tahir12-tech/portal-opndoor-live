-- THE LEVEL LADDER: you may act only on someone BELOW you.
--
-- RULING. A caller may change the position, level or status of a person strictly
-- below their own level, and of nobody else. So a Manager may act on Negotiators
-- and on no Manager and no Director. A Director may act on Managers and
-- Negotiators but not on another Director. A Negotiator may act on nobody. Opndoor
-- staff sit above all three. Acting on YOURSELF is acting on someone at your own
-- level, so it is refused too.
--
-- WHY THIS IS ONE FUNCTION AND NOT A CONDITION COPIED SEVEN TIMES. The level is
-- not a column. It is a pair, role plus sees_commission, and the mapping from the
-- pair to a level was already written out longhand in two places that have to
-- agree (set_agency_level in SQL, agencyLevelOf in TypeScript). A third and fourth
-- copy inside each guard is how the rule drifts, and a drifted authority rule
-- fails open. Resolving a level happens HERE, once.
--
-- ============================================================================
-- WHAT THIS CLOSES, PROVEN ON DEV BEFORE IT WAS WRITTEN
-- ============================================================================
-- Impersonating Nadia Shaw (Manager, sees_commission false) against Rosa Vance
-- (Director, sees_commission true) in the same agency, in a rolled-back
-- transaction, as `authenticated` with aal2 claims:
--
--   update public.users set status = 'deactivated' where id = <Rosa>;  -- APPLIED
--   update public.users set role   = 'referrer'    where id = <Rosa>;  -- APPLIED
--
-- A Manager could lock her own Director out of the portal, and demote her to
-- Negotiator, from the REST endpoint, touching none of the RPCs that this ladder
-- is being added to. The third attempt,
--
--   update public.users set sees_commission = true where id = <Nadia>;  -- 42501
--
-- was refused, by the trigger 20261005210000 added for exactly that column. So the
-- commission bit was guarded and role and status were not.
--
-- THE LESSON IS IN THE NEXT MIGRATION, NOT THIS ONE: guarding the seven RPCs does
-- not make this rule hold, because the RPCs are not the only door. `authenticated`
-- holds column UPDATE on users.role, users.status and users.sees_commission, and
-- the policy users_mgmt_update reads
--
--   app_role() = 'management' and partner_id = app_partner()
--   and role = any (array['management','referrer','developer'])
--
-- with no scope clause, no self clause and no level clause. 20261006091000 adds the
-- trigger that closes it. This migration only builds the predicate they share.
--
-- ============================================================================
-- WHERE `developer` SITS, decided rather than left to fall out
-- ============================================================================
-- A developer holds API keys and is not one of the three agency levels, so
-- agency_level_of returns null for them and no "change level" control can ever
-- turn somebody into one. But they are given RANK 3, beside a Negotiator, so that
-- a Director or Manager can still deactivate or rename a developer in their own
-- partner, which they can today. Ranking them null would have been the tidier
-- reading of "not on the ladder" and would have silently taken that away from
-- every supplier who manages their own key holders. A developer still acts on
-- nobody: rank 3 against rank 3 is not below.

-- ---------------------------------------------------------------------------
-- THE LADDER, AS ONE NUMBER. Lower is more authority.
--
--   0  opndoor staff: superadmin, opndoor_manager
--   1  Director    management + sees_commission
--   2  Manager     management
--   3  Negotiator  referrer, and developer beside them
--   null            no such user
--
-- The 0 arm is the row-wise twin of public.is_opndoor_staff(), which can only ask
-- about auth.uid() and so cannot answer about a target. The two must move
-- together; the pgTAP test drives that agreement off public.users so a new
-- staff-ish role added later fails loudly instead of silently ranking null.
-- ---------------------------------------------------------------------------
create or replace function public.level_rank_of(p_user uuid)
returns int
language sql stable security definer set search_path to ''
as $function$
  select case
           when u.role in ('superadmin','opndoor_manager') then 0
           when u.role = 'management' and u.sees_commission then 1
           when u.role = 'management' then 2
           when u.role in ('referrer','developer') then 3
         end
    from public.users u
   where u.id = p_user
$function$;

comment on function public.level_rank_of(uuid) is
  'Where this person sits on the authority ladder: 0 opndoor staff, 1 Director, 2 Manager, 3 Negotiator or developer, null if there is no such user. Lower is more authority. The one place a level is resolved from role + sees_commission.';

-- The level as the product spells it, for audit rows and error copy. Distinct from
-- the rank on purpose: a developer HAS a rank and is NOT an agency level, so this
-- returns null for them and no level-change control can name them.
create or replace function public.agency_level_of(p_user uuid)
returns text
language sql stable security definer set search_path to ''
as $function$
  select case
           when u.role = 'management' and u.sees_commission then 'Director'
           when u.role = 'management' then 'Manager'
           when u.role = 'referrer' then 'Negotiator'
         end
    from public.users u
   where u.id = p_user
$function$;

comment on function public.agency_level_of(uuid) is
  'Director, Manager or Negotiator, or null for opndoor staff and developers who are not agency levels. The SQL twin of agencyLevelOf in src/data/types.ts.';

create or replace function public.agency_level_rank(p_level text)
returns int
language sql immutable set search_path to ''
as $function$
  select case p_level when 'Director' then 1 when 'Manager' then 2 when 'Negotiator' then 3 end
$function$;

comment on function public.agency_level_rank(text) is
  'The rank a named agency level would occupy. Null for anything that is not one of the three exact names, which is what makes assert_may_grant_level refuse a typo rather than interpret it.';

-- ---------------------------------------------------------------------------
-- THE BOOLEAN, for triggers and for any caller that needs no message.
-- ---------------------------------------------------------------------------
create or replace function public.may_act_on_user(p_user uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select public.is_opndoor_staff()
      or (public.level_rank_of(auth.uid()) is not null
          and public.level_rank_of(p_user) is not null
          and p_user <> auth.uid()
          and public.level_rank_of(auth.uid()) < public.level_rank_of(p_user))
$function$;

comment on function public.may_act_on_user(uuid) is
  'True when the caller may act on this person: opndoor staff always, otherwise strictly below the caller on the ladder and not the caller themselves. The silent twin of assert_may_act_on_user, for triggers.';

-- ---------------------------------------------------------------------------
-- THE ASSERT, which is what the RPCs and the edge functions call.
--
-- ADDITIVE, NEVER A REPLACEMENT. Every guarded function keeps the partner and
-- scope gate it already has, and adds this. That gate is the only thing keeping a
-- Director inside their own agency: the house partner opndoor-agents holds many
-- agencies, so partner equality alone would let a Director of one agency act on a
-- Negotiator of another. Containment is one question, seniority is another, and
-- this answers only the second.
-- ---------------------------------------------------------------------------
create or replace function public.assert_may_act_on_user(p_user uuid)
returns void
language plpgsql stable security definer set search_path to ''
as $function$
declare v_caller int; v_target int;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  -- Opndoor staff sit above all three levels and manage their own team, so the
  -- ladder does not judge them. The guards that already exist for them are
  -- untouched and still apply: at least one active admin must remain, you cannot
  -- change your own role, an admin cannot be reassigned to a partner role.
  if public.is_opndoor_staff() then return; end if;

  v_caller := public.level_rank_of(auth.uid());
  if v_caller is null then
    raise exception 'Your account has no agency level, so it cannot act on people.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.users where id = p_user) then
    raise exception 'No such person.' using errcode = '22023';
  end if;

  -- Self is AT your own level, so the rule refuses it. Editing your own NAME is
  -- the documented exception and is handled at that one call site, not here:
  -- admin_update_user_name asks this only when the target is somebody else.
  if p_user = auth.uid() then
    raise exception 'You cannot do this to your own account.' using errcode = '42501';
  end if;

  v_target := public.level_rank_of(p_user);
  if v_target is null then
    raise exception 'That person has no agency level, so only opndoor may act on them.' using errcode = '42501';
  end if;

  if v_caller >= v_target then
    raise exception 'You can only do this to someone below your own level.' using errcode = '42501';
  end if;
end $function$;

comment on function public.assert_may_act_on_user(uuid) is
  'Raise 42501 unless the caller may act on this person: strictly below them on the ladder, never themselves, opndoor staff exempt. Added ALONGSIDE each function''s existing partner and scope gate, never instead of it: containment and seniority are different questions.';

-- ---------------------------------------------------------------------------
-- GRANTING A LEVEL, which is a question about a level rather than about a person,
-- so that inviting somebody who does not exist yet can be judged too.
--
-- BOTH ASSERTS ARE NEEDED on a level change, and this is the reason: without this
-- one a Manager could promote a Negotiator, who IS below her, to Director, who is
-- above her. Being allowed to touch a person is not being allowed to hand out any
-- level to them.
--
-- AT OR BELOW, NOT BELOW, AND THE TWO RULES ARE DELIBERATELY DIFFERENT.
--
--   the PERSON you act on must be strictly BELOW you  (assert_may_act_on_user)
--   the LEVEL you hand out may be AT OR BELOW yours   (this function)
--
-- Ruled that way: "the invite dialog offers only levels at or below the inviter's
-- own, a Manager sees Manager and Negotiator, a Director sees all three". A Director
-- seeing all three means a Director may create a Director, and a Manager seeing
-- Manager means a Manager may create a peer.
--
-- The asymmetry is the point rather than an oversight. Making a peer is how an
-- agency grows a second Manager without ringing us. Acting ON a peer is what a
-- level exists to prevent. The consequence, stated so nobody reads it as a bug:
-- once a Manager promotes a Negotiator to Manager, she can no longer act on that
-- person. That is correct. She gave away the seniority she had over them.
-- ---------------------------------------------------------------------------
create or replace function public.assert_may_grant_level(p_level text)
returns void
language plpgsql stable security definer set search_path to ''
as $function$
declare v_caller int; v_want int := public.agency_level_rank(p_level);
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if v_want is null then
    raise exception 'An agency level is Director, Manager or Negotiator.' using errcode = '22023';
  end if;
  if public.is_opndoor_staff() then return; end if;
  v_caller := public.level_rank_of(auth.uid());
  -- v_want < v_caller means the level asked for is MORE senior than the caller's.
  if v_caller is null or v_want < v_caller then
    raise exception 'You can only give someone a level at or below your own.' using errcode = '42501';
  end if;
end $function$;

comment on function public.assert_may_grant_level(text) is
  'Raise 42501 unless the caller may hand out this agency level: at or below their own, opndoor staff exempt. AT OR BELOW, unlike assert_may_act_on_user which demands strictly below: a Director may create a Director and a Manager a peer Manager, but neither may act on one. Refuses a level name that is not exactly Director, Manager or Negotiator rather than interpreting it.';

revoke all on function public.level_rank_of(uuid) from public, anon;
revoke all on function public.agency_level_of(uuid) from public, anon;
revoke all on function public.agency_level_rank(text) from public, anon;
revoke all on function public.may_act_on_user(uuid) from public, anon;
revoke all on function public.assert_may_act_on_user(uuid) from public, anon;
revoke all on function public.assert_may_grant_level(text) from public, anon;

grant execute on function public.level_rank_of(uuid) to authenticated, service_role;
grant execute on function public.agency_level_of(uuid) to authenticated, service_role;
grant execute on function public.agency_level_rank(text) to authenticated, service_role;
grant execute on function public.may_act_on_user(uuid) to authenticated, service_role;
grant execute on function public.assert_may_act_on_user(uuid) to authenticated, service_role;
grant execute on function public.assert_may_grant_level(text) to authenticated, service_role;
