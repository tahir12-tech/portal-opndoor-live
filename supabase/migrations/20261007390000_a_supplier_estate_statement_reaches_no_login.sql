-- =========================================================================
-- A SUPPLIER-ESTATE AGENCY'S STATEMENT GOES TO ITS FINANCE ADDRESS, NEVER
-- INTO A LOGIN.
--
-- Matt, 2026-10-01: "If Rightmove's 'Opndoor pays the agents directly' is
-- on, that commission is paid to the Rightmove-estate agency and its
-- statement goes to that agency's contact email, never into any login."
--
-- IT WAS A SENTENCE, NOT A RULE. Probed against dev before writing this: a
-- Management user positioned on an agency in a supplier's estate was
-- accepted, and `commission_statement_recipients('agency', ...)` then
-- returned them beside the finance address. Its agency arm resolves people
-- through `user_scopes` and has never asked which estate the party is in.
--
-- WHAT IS NOT DONE HERE, AND WHY. The first version of this migration put
-- the rule on `user_scopes` instead, refusing any position in a supplier's
-- estate -- the literal reading of "they never have logins". That broke
-- two existing fixtures, `tenant_isolation` and
-- `a_pre_referenced_agency_of_ours_may_refer_a_pair`, both of which model
-- a SUPPLIER'S OWN referrer positioned at a branch in the supplier's
-- estate and assert that they are isolated to it. That is a different
-- thing from one of the agencies having a login, and the instruction does
-- not obviously forbid it. So this migration closes exactly the leak Matt
-- named, by name, and the broader question is in docs/QUEUE.md under "For
-- Matt in the morning" rather than being guessed at.
--
-- THE PARTNER ARM IS UNTOUCHED. A supplier's own Management users are
-- found by `partner_id`, which on the supplier rail IS the company, and
-- they go on receiving the supplier's own statement. This narrows the arm
-- that resolves people through a POSITION, which is the only one that can
-- reach an agency inside somebody else's estate.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- 1. THE PREDICATE, in one place, so the three-way split is not re-derived.
--
--    NOT "not the house partner". `harbour-lets` is a partner of ours on
--    the AGENCY rail (referencing_mode = 'opndoor_referenced') and its
--    agency holds people like any other of ours. A supplier is a partner
--    that is neither house nor agency-mode, which is the same three-way
--    split `partyIsSupplier` makes in src/data/capabilities.ts.
-- ---------------------------------------------------------------------------
create or replace function public.is_supplier_estate(p_partner uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select coalesce(
    (select not public.is_house_partner_id(p.id)
            and coalesce(p.referencing_mode::text, '') <> 'opndoor_referenced'
       from public.partners p where p.id = p_partner),
    false)
$$;

comment on function public.is_supplier_estate(uuid) is
  'Is this partner a SUPPLIER, whose agencies come through it rather than being Opndoor''s own clients? Neither a house partner nor one of ours on the agency rail. The server twin of partyIsSupplier in src/data/capabilities.ts.';

/* NOT GRANTED TO `authenticated`. Its only caller is the definer function
   below, which reaches it as its owner; and the client answers the same
   question for itself in partyIsSupplier, off the partner record it has
   already hydrated. A definer function callable by the browser has to earn
   a reach assertion in definer_grants.test.sql, and one with no browser
   caller should not be asking for one. */
revoke all on function public.is_supplier_estate(uuid) from public, anon, authenticated;
grant execute on function public.is_supplier_estate(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. THE STATEMENT'S PERSON ARM, regenerated from its definition in
--    20261007040000 with the estate test added. Everything else is as it
--    was, comments included.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commission_statement_recipients(p_level text, p_org_id uuid)
 RETURNS TABLE(email text, full_name text, source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with party as (
    select case when p_level = 'group'   then p_org_id end as group_id,
           case when p_level = 'agency'  then p_org_id end as agency_id,
           case when p_level = 'branch'  then p_org_id end as branch_id,
           case when p_level = 'partner' then p_org_id end as partner_id
  ),
  /* WHICH ESTATE THE PARTY SITS IN. Matt, 2026-10-01: "If Rightmove's
     'Opndoor pays the agents directly' is on, that commission is paid to
     the Rightmove-estate agency and its statement goes to that agency's
     contact email, NEVER INTO ANY LOGIN." Read once here so the person arm
     below can ask it without repeating the three-way join. */
  estate as (
    select coalesce(a.partner_id, b.partner_id, g.partner_id) as partner_id
    from party pa
    left join public.agencies a      on a.id = pa.agency_id
    left join public.branches b      on b.id = pa.branch_id
    left join public.agency_groups g on g.id = pa.group_id
  ),
  -- The party itself plus every party ABOVE it. Upwards only: see the header.
  chain as (
    select coalesce(pa.group_id, ag.group_id, bag.group_id) as group_id,
           coalesce(pa.agency_id, br.agency_id)             as agency_id,
           pa.branch_id                                     as branch_id
    from party pa
    left join public.agencies ag  on ag.id  = pa.agency_id
    left join public.branches br  on br.id  = pa.branch_id
    left join public.agencies bag on bag.id = br.agency_id
  ),
  found as (
    /* THE SUPPLIER'S OWN MANAGEMENT. Matt, 2026-09-30: "sent to the
       supplier's Management users who have statements switched on."

       The same four tests as the agency arm below -- ticked, management
       with the commission bit, active, has an address -- and the boundary
       is `partner_id`, which on this rail IS the company. A supplier's
       REFERRER is refused by the level test, which is what "Management
       users" means and is the half most easily lost. */
    select u.email, u.full_name, 'person'::text as source
    from party pa
    join public.users u on u.partner_id = pa.partner_id
    where pa.partner_id is not null
      and u.receives_commission_statements
      and u.role = 'management' and u.sees_commission
      and u.status = 'active'
      and coalesce(btrim(u.email), '') <> ''
    union all
    /* AND THE NAMED ADDRESSES THAT ARE NOT PORTAL USERS. Matt: "Opndoor
       admin can also add named email addresses that aren't portal users
       (e.g. a finance inbox)."

       A LIST, not a column. Agencies and groups carry a single
       `finance_email`; his word is "addresses", and a supplier plausibly
       wants a finance inbox AND an accounts contact. The table is
       admin-managed and carries a name beside the address so the run can
       say who it wrote to. */
    select r.email, nullif(btrim(r.full_name), ''), 'named'
    from party pa
    join public.partner_statement_recipients r on r.partner_id = pa.partner_id
    where pa.partner_id is not null
      and coalesce(btrim(r.email), '') <> ''
    union all
    select u.email, u.full_name, 'person'::text as source
    from chain c
    join public.user_scopes s
      on (s.kind = 'group'  and s.group_id  = c.group_id)
      or (s.kind = 'agency' and s.agency_id = c.agency_id)
      or (s.kind = 'branch' and s.branch_id = c.branch_id)
    join public.users u on u.id = s.user_id
    -- AND THEY MUST BE ENTITLED TO SEE COMMISSION. The admin-set tick was the
    -- only test, so a Director demoted to Manager kept receiving a PDF of
    -- every commission line for their party: the one figure withheld from a
    -- Manager on every other surface. The LEVEL is the rule; the tick only
    -- says which of the people at that level want the email.
    -- ACTIVE, not "not deactivated". A pending invite has never signed in, so
    -- the portal link in the statement goes somewhere they cannot open. The run
    -- reports a payee it could not address rather than mailing a dead account.
    where u.receives_commission_statements
      -- THE LEVEL, which 20261006410000 claimed in a comment and did not add.
      -- The tick says which of the people entitled to a statement want the
      -- email; it does not confer the entitlement. A Manager or Negotiator
      -- holding it was being posted every commission line for their party.
      and u.role = 'management' and u.sees_commission
      and u.status = 'active'
      and coalesce(btrim(u.email), '') <> ''
      /* AND NOT IN A SUPPLIER'S ESTATE. The agencies that come through a
         supplier are the supplier's own record of its agents; the money
         for them is settled to the agency's finance address and the
         statement goes there. A login must never be addressed for one,
         and this arm is the only place one could be: the partner arm
         above is the supplier's OWN staff, which is a different party and
         is unaffected. */
      and not coalesce((select public.is_supplier_estate(e.partner_id) from estate e), false)
    union all
    select f.finance_email, null, 'finance'
    from (
      select ag.finance_email from public.agencies ag, party pa
       where p_level = 'agency' and ag.id = pa.agency_id
      union all
      select gr.finance_email from public.agency_groups gr, party pa
       where p_level = 'group' and gr.id = pa.group_id
    ) f
    where coalesce(btrim(f.finance_email), '') <> ''
  )
  -- One address, once. A finance mailbox that is also somebody's login would
  -- otherwise receive the statement twice, from two different reasons.
  select distinct on (lower(btrim(r.email))) btrim(r.email), r.full_name, r.source
  from found r
  order by lower(btrim(r.email)), r.source desc
$function$;

-- ---------------------------------------------------------------------------
-- 3. AND IT HOLDS ON THIS DATABASE. Asserted here, built and rolled back
--    inside the block, so a clean filename-order apply fails at the
--    migration rather than later in the suite.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sup uuid; v_ag uuid; v_u uuid := gen_random_uuid(); v_people int;
begin
  select id into v_sup from public.partners
   where not public.is_house_partner_id(id)
     and coalesce(referencing_mode::text,'') <> 'opndoor_referenced'
   order by created_at limit 1;

  if v_sup is null then
    raise notice 'statement estate check skipped: no supplier on this database';
    return;
  end if;

  insert into public.agencies (partner_id, name, review_state, finance_email)
  values (v_sup, 'Zzz Statement Probe', 'confirmed', 'probe@finance.test')
  returning id into v_ag;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zzz.statement.probe@e.test','',now(),now(),now());
  insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, receives_commission_statements)
  values (v_u,'Zzz Statement Probe','zzz.statement.probe@e.test','management', v_sup, 'active', true, true);
  insert into public.user_scopes (user_id, kind, agency_id) values (v_u, 'agency', v_ag);

  select count(*) into v_people
  from public.commission_statement_recipients('agency', v_ag) r
  where r.source = 'person';

  delete from public.user_scopes where user_id = v_u;
  delete from public.users where id = v_u;
  delete from auth.users where id = v_u;
  delete from public.agencies where id = v_ag;

  if v_people > 0 then
    raise exception 'a supplier-estate agency statement still reaches % login(s)', v_people;
  end if;
end $$;
