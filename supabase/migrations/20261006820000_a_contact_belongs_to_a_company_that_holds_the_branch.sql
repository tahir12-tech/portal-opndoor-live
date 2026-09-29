-- R1. A CONTACT BELONGS TO A COMPANY THAT ACTUALLY HOLDS THE BRANCH.
--
-- The final review round's worst finding, and the only one measured end to
-- end rather than argued. A Manager at one company attached a deed contact to
-- ANOTHER company's branch, and that company's next executed Deed of
-- Guarantee was delivered to the address they wrote. Walked on dev:
--
--     EXECUTED DEED IS DELIVERED TO  attacker@evil.test via branch_contact
--
-- Test: supabase/tests/a_contact_belongs_to_a_company_that_holds_the_branch.test.sql
-- It failed first, on exactly the three assertions the three changes below
-- fix, with six regression guards passing throughout.
--
-- =========================================================================
-- WHERE IT CAME FROM, because that decides the shape of the fix
-- =========================================================================
--
-- `sync_contact_partner` used to derive partner_id from the owning agency or
-- branch, UNCONDITIONALLY. That is still what the live system does, and it is
-- the only reason live is not vulnerable to this. 20260812120000, the
-- migration that let one agency be shared across partners, rewrote it to:
--
--     -- 1. Stated by the caller. Every existing writer states it.
--     if new.partner_id is null then ...
--
-- The premise in that comment is false. `org_add_contact` does NOT state a
-- partner -- it derives one and never passes it to the insert -- and a direct
-- PostgREST insert states whatever it likes. So the column became
-- caller-controlled, and `app_may_reach_contact`'s last arm,
-- `p_partner = public.app_partner()`, compares that caller-supplied value
-- against the caller's own partner and is satisfied by construction.
--
-- =========================================================================
-- WHAT THE FIX MUST NOT DO
-- =========================================================================
--
-- The sharing 20260812120000 added is real: an agency introduced by a
-- supplier transacts on that supplier's route, and that route needs its own
-- contact. "partner_id must equal the branch's own partner" would be the
-- obvious fix and it would DELETE that feature. The rule is instead that a
-- stated partner must be one the owner legitimately sits under: its own
-- partner, or one holding a `partner_agency_relationships` row with its
-- agency. That is the same relationship test `create_referral`'s route guard
-- uses, and it is Matt's own sentence there -- "the server checks the branch
-- belongs to the chosen supplier and refuses otherwise".
--
-- =========================================================================
-- THREE CHANGES, because the write and the delivery are separate holes
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. THE TRIGGER. Defence at the source: this runs before the RLS WITH CHECK
--    and covers every writer, the RPCs and a raw PostgREST insert alike.
--
--    ALSO WIDENED TO FIRE ON partner_id. It was `update of agency_id,
--    branch_id`, so an UPDATE that changed ONLY partner_id did not fire it at
--    all -- insert a legitimate contact, then re-label it. Assertion 10.
-- -------------------------------------------------------------------------
create or replace function public.sync_contact_partner()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare v_agency uuid; v_owner uuid;
begin
  -- Who owns the thing this contact hangs off, and which agency is it under.
  if new.agency_id is not null then
    select a.id, a.partner_id into v_agency, v_owner
      from public.agencies a where a.id = new.agency_id;
  elsif new.branch_id is not null then
    select b.agency_id, b.partner_id into v_agency, v_owner
      from public.branches b where b.id = new.branch_id;
  end if;

  if v_owner is null then
    raise exception 'contact owner not found' using errcode = '22023';
  end if;

  -- Unstated: the creator's own partner, else the owner's. Unchanged.
  if new.partner_id is null then
    new.partner_id := coalesce(public.app_partner(), v_owner);
  end if;

  -- THE CHECK THAT WAS MISSING. A stated partner must have a claim on this
  -- agency: it owns it, or it was introduced to it. Everything else is a
  -- contact planted on somebody else's estate.
  if new.partner_id <> v_owner
     and not exists (
       select 1 from public.partner_agency_relationships r
        where r.partner_id = new.partner_id
          and r.agency_id  = v_agency
     ) then
    raise exception 'a contact must belong to a company that holds the branch'
      using errcode = '42501';
  end if;

  return new;
end $function$;

drop trigger if exists contacts_sync_partner on public.agent_contacts;
create trigger contacts_sync_partner
  before insert or update of agency_id, branch_id, partner_id
  on public.agent_contacts
  for each row execute function public.sync_contact_partner();

-- -------------------------------------------------------------------------
-- 2. THE PREDICATE. The trigger already stops the write, but this function is
--    the authorisation answer four policies and four RPCs ask, and it should
--    be right on its own terms rather than correct only because something
--    upstream sanitised its argument.
--
--    The first two arms are 20260924120000's, unchanged. Only the supplier-
--    rail arm gains the ownership test, in house form so a NULL is false
--    rather than NULL: this is an ALLOW predicate, so it must fail closed.
-- -------------------------------------------------------------------------
create or replace function public.app_may_reach_contact(p_agency uuid, p_branch uuid, p_partner uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  with owner as (
    select coalesce(p_agency, (select b.agency_id from public.branches b where b.id = p_branch)) as agency_id
  )
  select case
    when public.is_admin() or public.app_role() = 'opndoor_manager' then true
    when exists (
      select 1 from owner o
      join public.agencies a on a.id = o.agency_id
      join public.partners p on p.id = a.partner_id
      where p.referencing_mode = 'opndoor_referenced'
    ) then (select public.app_reachable_agency(o.agency_id) from owner o)
    -- SUPPLIER RAIL. Two things, not one: the caller must act for that
    -- partner, AND that partner must have a claim on this agency. The second
    -- half is what was missing, and it is why the first half alone could be
    -- satisfied by simply writing your own partner id onto somebody else's
    -- branch.
    else coalesce(
      p_partner = public.app_partner()
      and exists (
        select 1 from owner o
        join public.agencies a on a.id = o.agency_id
        where a.partner_id = p_partner
           or exists (
             select 1 from public.partner_agency_relationships r
              where r.partner_id = p_partner and r.agency_id = a.id
           )
      ), false)
  end
$function$;

revoke all on function public.app_may_reach_contact(uuid, uuid, uuid) from public, anon;
grant execute on function public.app_may_reach_contact(uuid, uuid, uuid) to authenticated, service_role;

-- -------------------------------------------------------------------------
-- 3. THE DELIVERY. The half no write-side fix reaches.
--
--    `deed_delivery_target` tried the route-pinned contact first, which is
--    safe, and fell back to `effective_primary_contact(branch)`, which keys
--    on the branch ALONE with no partner filter and runs inside this definer
--    function, so it saw every contact on the branch whatever RLS said.
--
--    That is exploitable with no forged row at all: where one agency is
--    legitimately shared by two partners -- exactly what 20260812120000
--    exists to allow -- deleting one route's contact promotes the other's,
--    and the fallback then hands one route's executed deed to the other
--    company. Nobody has done anything wrong and the deed still goes astray.
--
--    Pinned to the BRANCH'S OWN partner. Still the branch mailbox this rung
--    was always for; never another company's.
--
--    The rest of the body is 20261006630000's, verbatim.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deed_delivery_target(p_application uuid)
 RETURNS TABLE(email text, display_name text, source text, verified boolean, auto_send boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with a as (
    select * from public.applications where id = p_application
  ),
  ch as (
    select public.application_channel((select id from a)) as channel
  ),
  -- THE WHOLE LADDER, in rung order. No limit.
  nr as (
    select r.email, r.display_name, r.rung,
           case r.rung when 'referrer' then 1 when 'copy' then 2 else 3 end as pri
      from public.agency_notification_recipients((select id from a)) r
  ),
  d as (
    select * from public.application_delivery_contacts
     where application_id = (select id from a)
  ),
  rc as (
    select * from public.effective_primary_contact_route(
      (select branch_id from a), (select partner_id from a))
  ),
  -- R1. WAS `effective_primary_contact(branch)`, which keys on the branch
  -- ALONE with no partner filter and runs inside this definer function, so it
  -- saw every contact on the branch whatever RLS said. Where one agency is
  -- legitimately shared by two partners, that handed one route's executed deed
  -- to the other route's contact. Pinned to the BRANCH'S OWN partner: still
  -- the branch mailbox this rung was always for, but never another company's.
  c as (
    select * from public.effective_primary_contact_route(
      (select branch_id from a),
      (select b.partner_id from public.branches b where b.id = (select branch_id from a)))
  ),
  -- auto_send is a property of the application, so it is computed once.
  gate as (
    select (select channel from ch) <> 'Agent referral' or exists (select 1 from nr) as auto_send
  )
  -- THE AGENCY RAIL: one row per person on the ladder, FILTERED BY THE
  -- MATRIX. Q-03. The deed to its own recipient is a locked cell -- the
  -- referrer rung on this rail -- so notification_enabled answers true for it
  -- whatever any stored row says, and set_notification_setting refuses to
  -- turn it off. The COPIES are the switchable half: an agency that does not
  -- want its ticked users copied on the executed instrument can say so, and
  -- this is where that takes effect. Applied here rather than in the caller
  -- because deed_delivery_target is the one thing every deed send asks, and a
  -- rule applied in the caller is a rule the other caller forgets.
  select nr.email, nr.display_name, nr.rung,
         true,
         (select auto_send from gate)
    from nr
   where (select channel from ch) = 'Agent referral'
     and public.notification_enabled(
           'agency', null, (select agency_id from a), 'deed_issued',
           case when nr.rung = 'referrer' then 'referrer' else 'ticked_users' end)

  union all

  -- EVERY OTHER RAIL, and the agency rail when the ladder is empty: the single
  -- contact, exactly as before. Direct stops at the tenant's own nominated
  -- contact and never reaches the route or branch mailbox.
  select
    case when (select channel from ch) = 'Direct'
         then (select email from d)
         else coalesce((select email from d), (select email from rc), (select email from c)) end,
    coalesce(
      nullif(btrim(coalesce((select agency_name from d), '')), ''),
      nullif(btrim(coalesce((select first_name from d), '') || ' ' || coalesce((select last_name from d), '')), ''),
      case when (select channel from ch) = 'Direct' then null
           else coalesce((select name from rc), (select name from c)) end
    ),
    case
      when (select application_id from d) is not null then 'delivery_contact'
      when (select channel from ch) = 'Direct' then 'delivery_contact'
      when (select id from rc) is not null then 'route_contact'
      else 'branch_contact'
    end,
    case when (select application_id from d) is not null
         then (select verified_at from d) is not null
         else true end,
    (select auto_send from gate)
  where not ((select channel from ch) = 'Agent referral' and exists (select 1 from nr))
$function$

;
