/* =====================================================================
   SUPPLIER MONTHLY COMMISSION STATEMENTS.

   Matt, 2026-09-30, verbatim: "Supplier monthly commission statements:
   sent to the supplier's Management users who have statements switched
   on, addressed to the supplier. Only Opndoor admin can switch statements
   on or off for a supplier's users; supplier users cannot change it for
   themselves or colleagues. Opndoor admin can also add named email
   addresses that aren't portal users (e.g. a finance inbox) to receive a
   supplier's statement."

   THE FACT THAT DECIDES THE SIZE OF THIS, measured on dev before a line
   was written: `application_commission_lines` holds `agency` rows and
   NOTHING ELSE, and every payee the monthly run has ever produced is at
   agency level. **A supplier's own commission has never been on a
   statement.** So this is a new DOCUMENT, not a new recipient for one
   that already existed.

   AND THE DEFINITION OF THAT MONEY IS NOT INVENTED HERE. It is the one
   every screen already uses and `our_margin_is_not_theirs.test.sql`
   already pins: a REAL supplier's `partner_rate` cut of the fee, and
   nothing on a house route, because a house route's partner cut is
   Opndoor's own margin and is owed to nobody. `liveAnalytics` computes
   `supplierCommNet` with the same guard.

   IT REVERSES HALF OF Q4, DELIBERATELY. Q4 said "monthly statements stay
   Management-only" and was built as a supplier's Management being able to
   switch them. This narrows that to Opndoor only, ON THE SUPPLIER RAIL
   ALONE. An agency Director still switches it for their own people. The
   two other settings Q4 gave supplier Management are untouched.

   FIVE FUNCTIONS, each regenerated from its LAST definition (found with a
   case-insensitive grep) with only the change described above. No do-block
   string surgery: that is D7's blind spot and `npm run drift` cannot model
   it, which cost a rewrite three hours ago.
   ===================================================================== */

/* ---- 1. the named addresses that are not portal users ---------------- */

create table if not exists public.partner_statement_recipients (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,
  email       text not null,
  full_name   text,
  added_by    uuid references public.users(id),
  created_at  timestamptz not null default now()
);

/* ONE ADDRESS ONCE PER SUPPLIER. Without this an admin adding the same
   finance inbox twice would have the run write to it twice, and the
   de-duplication downstream is on the whole recipient set rather than on
   this table. Case-insensitive, because an email address is. */
create unique index if not exists partner_statement_recipients_unique
  on public.partner_statement_recipients (partner_id, lower(btrim(email)));

comment on table public.partner_statement_recipients is
  'Named addresses that are not portal users, added by an Opndoor admin, which receive a supplier''s monthly commission statement. Agencies and groups carry a single finance_email column; a supplier gets a list, because Matt asked for "addresses".';

/* RLS ON, NO POLICY. The table is read only through
   `commission_statement_recipients`, which is SECURITY DEFINER, and
   written only by an admin RPC. Deny-by-default is the whole access
   rule, and it is the shape 30 other tables in this schema already use. */
alter table public.partner_statement_recipients enable row level security;

/* AND THE SECOND FACTOR, because it holds addresses a statement is posted
   to and the last sweep missed three tables of exactly this kind. */
drop policy if exists require_aal2 on public.partner_statement_recipients;
create policy require_aal2 on public.partner_statement_recipients
  as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());

/* ---- 2. adding and removing one, Opndoor admin only ------------------ */

create or replace function public.add_partner_statement_recipient(
  p_partner uuid, p_email text, p_name text default null)
returns uuid
language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; v_clean text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only Opndoor adds a named address to a supplier''s statement.' using errcode = '42501';
  end if;

  v_clean := lower(btrim(coalesce(p_email, '')));
  -- Deliberately not a full RFC check: one that is wrong about a real
  -- address is worse than one that lets a typo through to a bounce.
  if v_clean = '' or position('@' in v_clean) < 2 then
    raise exception 'Enter an email address.' using errcode = '22023';
  end if;
  if not coalesce(exists (select 1 from public.partners where id = p_partner
                           and coalesce(is_house_route, false) = false
                           and slug <> 'opndoor-agents'), false) then
    raise exception 'That is not a supplier.' using errcode = '22023';
  end if;

  insert into public.partner_statement_recipients (partner_id, email, full_name, added_by)
  values (p_partner, v_clean, nullif(btrim(coalesce(p_name, '')), ''), auth.uid())
  on conflict (partner_id, lower(btrim(email))) do update
    set full_name = coalesce(excluded.full_name, public.partner_statement_recipients.full_name)
  returning id into v_id;

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('partner', p_partner, 'statement_recipient_added',
          v_clean || ' now receives this supplier''s monthly commission statement',
          coalesce((select full_name from public.users where id = auth.uid()), 'opndoor admin'), auth.uid());
  return v_id;
end $function$;

create or replace function public.remove_partner_statement_recipient(p_id uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_row public.partner_statement_recipients;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only Opndoor removes a named address from a supplier''s statement.' using errcode = '42501';
  end if;
  select * into v_row from public.partner_statement_recipients where id = p_id;
  if not coalesce(found, false) then raise exception 'No such address.' using errcode = 'P0002'; end if;

  delete from public.partner_statement_recipients where id = p_id;

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('partner', v_row.partner_id, 'statement_recipient_removed',
          v_row.email || ' no longer receives this supplier''s monthly commission statement',
          coalesce((select full_name from public.users where id = auth.uid()), 'opndoor admin'), auth.uid());
end $function$;

/* Admin RPCs called from the browser, so `authenticated` with the guard
   inside. `public` named explicitly on the revoke. */
revoke all on function public.add_partner_statement_recipient(uuid, text, text) from public, anon;
grant execute on function public.add_partner_statement_recipient(uuid, text, text) to authenticated, service_role;
revoke all on function public.remove_partner_statement_recipient(uuid) from public, anon;
grant execute on function public.remove_partner_statement_recipient(uuid) to authenticated, service_role;

/* ---- 3. the five regenerated functions ------------------------------- */

CREATE OR REPLACE FUNCTION public.commission_statement_lines(p_month date)
 RETURNS TABLE(payee_key text, level text, org_id uuid, org_name text, partner_id uuid, guarantee_ref text, tenant_name text, tenancy_place text, branch_name text, paid_on date, fee numeric, share_percent numeric, rate numeric, source text, commission numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bounds as (
    select date_trunc('month', p_month)::date                         as m_start,
           (date_trunc('month', p_month) + interval '1 month')::date  as m_next
  ),
  paid as (
    select a.*
    from public.applications a, bounds b
    where a.paid_at is not null
      and (a.paid_at at time zone 'Europe/London') >= b.m_start
      and (a.paid_at at time zone 'Europe/London') <  b.m_next
      and coalesce(a.payment_state, '') <> 'refunded'
      and a.livemode is true
      /* DIRECT-RAIL BUSINESS IS NEVER THE MATCHED AGENCY'S. Round 6. The
         auto-matcher rewrites a direct application's branch_id and agency_id
         to a real agency so somebody can service it, while pinning partner_id
         to opndoor-direct. This function had no rail test at all -- the only
         money surface without one -- so that application became an
         agency-level PAYEE, and commission-statements posts the PDF and CSV
         to that agency's Directors. What stopped it firing was opndoor-direct's
         agent_rate being 0.0000, i.e. a number an admin can edit on the
         partner-settings screen.

         `<> 'Direct'` and NOT `= 'Agent referral'`: the digest was written the
         second way and silently dropped every supplier, which is round 6's M3
         in the same list of findings. */
      and public.application_channel(a.id) <> 'Direct'
  ),
  -- Named split_line, not line: `line` is a built-in geometric type name, and a
  -- CTE that shadows a type is a trap nobody needs to walk into.
  split_line as (
    -- The frozen split. basis_amount is what the rate was a share of, snapshotted
    -- at creation; the fee is the fallback for rows frozen before that column
    -- existed, and is the same number by construction.
    select p.id as application_id, l.level, l.org_id, l.org_name, l.rate, l.source,
           coalesce(l.basis_amount, p.fee_amount, p.monthly_rent, 0) as basis,
           l.amount as frozen_amount
    from paid p
    join public.application_commission_lines l on l.application_id = p.id
    union all
    -- No split: a historic row, whose money was always the referring agency's.
    select p.id, 'agency', p.agency_id, coalesce(ag.name, '(unknown agency)'),
           coalesce(p.agent_rate, 0), null,
           coalesce(p.fee_amount, p.monthly_rent, 0),
           -- No frozen line at all, so nothing to read: this arm keeps the old
           -- arithmetic, which is all it ever had.
           null::numeric
    from paid p
    left join public.agencies ag on ag.id = p.agency_id
    where not exists (
      select 1 from public.application_commission_lines l where l.application_id = p.id
    )
    union all
    /* THE SUPPLIER'S OWN CUT. Matt, 2026-09-30: "a supplier's Management
       users who have statements switched on receive their supplier's
       monthly commission statement, addressed to the supplier."

       IT HAS NEVER BEEN A STATEMENT PAYEE. Measured on dev before this was
       written: `application_commission_lines` holds `agency` rows and
       nothing else, and every payee the run has ever produced is at
       agency level. So this is a new DOCUMENT, not a new recipient for an
       existing one.

       THE DEFINITION IS NOT INVENTED HERE. It is the one every screen
       already uses and `our_margin_is_not_theirs.test.sql` already pins: a
       REAL supplier's `partner_rate` cut of the fee, and nothing on a
       house route, because a house route's partner cut is Opndoor's own
       margin and is owed to nobody. `liveAnalytics` says the same in
       `supplierCommNet`, guarded by the same `isHousePartner` test.

       THE SNAPSHOTTED RATE, `p.partner_rate`, not the partner's current
       one: the whole money model freezes the rate onto the application at
       creation and never recomputes it, and a statement that re-derived
       the rate would restate a month that has already been paid.

       ROUNDED ONCE, here, like the agency arm beside it. */
    select p.id, 'partner', p.partner_id, coalesce(pt2.name, '(unknown supplier)'),
           coalesce(p.partner_rate, 0), 'partner_rate',
           coalesce(p.fee_amount, p.monthly_rent, 0),
           null::numeric
    from paid p
    join public.partners pt2 on pt2.id = p.partner_id
    where coalesce(pt2.is_house_route, false) = false
      and pt2.slug <> 'opndoor-agents'
      and coalesce(p.partner_rate, 0) > 0
  )
  select
    -- Same shape as the client's payeeKey (partner slug, level, org), so a payee
    -- has one identity whichever side of the wire names it.
    coalesce(pt.slug, '') || '|' || l.level || ':'
      || coalesce(l.org_id::text, 'name/' || lower(btrim(l.org_name))),
    l.level, l.org_id, l.org_name, p.partner_id,
    p.guarantee_ref,
    btrim(coalesce(p.tenant_first_name, '') || ' ' || coalesce(p.tenant_last_name, '')),
    case
      when p.tenancy_id is null or p.tenancy_position is null then ''
      else p.tenancy_position::text || ' of '
           || (select count(*) from public.applications s where s.tenancy_id = p.tenancy_id)::text
    end,
    coalesce(br.name, ''),
    (p.paid_at at time zone 'Europe/London')::date,
    l.basis, p.share_percent, l.rate, l.source,
    -- THE FROZEN AMOUNT, and round(basis * rate) only for a row frozen before
    -- that column existed. Computing it here per line is the defect: two lines of
    -- one tenancy could each round up and sum to a penny more than the tenancy's
    -- own commission.
    coalesce(l.frozen_amount, round(l.basis * l.rate, 2))
  from split_line l
  join paid p on p.id = l.application_id
  left join public.branches br on br.id = p.branch_id
  left join public.partners pt on pt.id = p.partner_id
$function$;
create or replace function public.commission_statement_payees(p_month date)
returns table (
  payee_key  text,
  level      text,
  org_id     uuid,
  org_name   text,
  partner_id uuid,
  line_count integer,
  total      numeric
)
language sql stable security definer set search_path to ''
as $function$
  select g.payee_key, g.level, g.org_id,
         -- The party's CURRENT name, not the one frozen onto the oldest line in
         -- the month. This is addressed to them; an agency that rebranded in
         -- March should not read its old name on an April statement.
         coalesce(
           case g.level
             when 'agency' then ag.name
             when 'group'  then gr.name
             when 'branch' then br.name
             -- A SUPPLIER PAYEE IS THE COMPANY. On that rail partner_id IS
             -- the company, which is the one rail where that is true.
             when 'partner' then pr.name
           end,
           g.frozen_name
         ),
         g.partner_id, g.line_count, g.total
  from (
    select l.payee_key, l.level, l.org_id, l.partner_id,
           count(*)::int as line_count,
           sum(l.commission) as total,
           min(l.org_name) as frozen_name
    from public.commission_statement_lines(p_month) l
    group by l.payee_key, l.level, l.org_id, l.partner_id
  ) g
  left join public.agencies      ag on g.level = 'agency' and ag.id = g.org_id
  left join public.agency_groups gr on g.level = 'group'  and gr.id = g.org_id
  left join public.branches      br on g.level = 'branch' and br.id = g.org_id
  left join public.partners      pr on g.level = 'partner' and pr.id = g.org_id
  order by g.total desc, g.frozen_name
$function$;
CREATE OR REPLACE FUNCTION public.commission_statement_party(p_user uuid)
 RETURNS TABLE(level text, org_id uuid, org_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with cand as (
    select 1 as pri, 'group'::text as level, g.id, g.name
    from public.user_scopes s
    join public.agency_groups g on g.id = s.group_id
    where s.user_id = p_user and s.kind = 'group'
    union all
    select 2, 'agency', a.id, a.name
    from public.user_scopes s
    join public.agencies a on a.id = s.agency_id
    where s.user_id = p_user and s.kind = 'agency'
    union all
    select 3, 'branch', b.id, b.name
    from public.user_scopes s
    join public.branches b on b.id = s.branch_id
    where s.user_id = p_user and s.kind = 'branch'
    -- WAS a fourth arm here: "a negotiator holds no scope row at all, so their
    -- party is the branch they were invited into", reading users.home_branch_id.
    -- That routed a COMMISSION STATEMENT off a column its own subject could
    -- PATCH. Negotiators hold a branch position now (20261006300000), so arm 3
    -- answers for them and the money follows a position like everyone else's.
    union all
    /* THE SUPPLIER RAIL. A supplier's staff hold no `user_scopes` row at
       all, deliberately -- `user_must_hold_a_position` returns early off
       the estate because "on the supplier rail partner_id IS the company
       boundary". So arms 1 to 3 answer nothing for them and this one does.

       PRIORITY 4, BELOW THE LADDER, so it can never shadow an estate
       user's group/agency/branch answer. It cannot fire for one anyway --
       the house partners are excluded -- and the ordering is belt and
       braces rather than the guard.

       THE PARTY IS THE COMPANY, not the person: Matt's "addressed to the
       supplier". */
    select 4, 'partner', p.id, p.name
    from public.users u
    join public.partners p on p.id = u.partner_id
    where u.id = p_user
      and coalesce(p.is_house_route, false) = false
      and p.slug <> 'opndoor-agents'
  )
  -- Qualified throughout: level, org_id and org_name are also this function's
  -- OUT columns, and an unqualified reference to one of them is a coin toss
  -- between the CTE's column and the output parameter.
  select c.level, c.id, c.name from cand c order by c.pri asc, c.name asc limit 1
$function$;
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
create or replace function public.set_receives_commission_statements(p_user uuid, p_on boolean)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare
  v_target public.users; v_actor text; v_level text; v_org uuid; v_org_name text;
  v_on boolean := coalesce(p_on, false);
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into v_target from public.users where id = p_user;
  if not coalesce(found, false) then raise exception 'User not found' using errcode = '22023'; end if;

  /* THE LEVEL, FIRST. A statement IS a commission figure, so only somebody
     who may see commission may be addressed one. This fires before the
     permission test on purpose: "change their level first" is the useful
     answer even to somebody who would not have been allowed anyway. */
  if v_on and not (v_target.role = 'management' and v_target.sees_commission) then
    raise exception 'Only a Director receives a commission statement. Change their level first.'
      using errcode = '22023';
  end if;

  select c.level, c.org_id, c.org_name into v_level, v_org, v_org_name
  from public.commission_statement_party(p_user) c;
  if v_level is null then
    raise exception 'This person is not attached to a group, agency or branch, so there is no commission statement for them to receive.'
      using errcode = '22023';
  end if;

  if coalesce(not (
       public.is_admin()
       /* NARROWED, AND IT REVERSES HALF OF Q4. Two hours ago "monthly
          statements stay Management-only" was built as a supplier's
          Management being able to switch them, through
          caller_leads_their_party(). Matt, 2026-09-30: "Only Opndoor admin
          can switch statements on or off for a supplier's users; supplier
          users cannot change it for themselves or colleagues."

          So this setting is now the one place the two rails differ: an
          agency DIRECTOR still switches it for their own people, and on
          the supplier rail nobody but Opndoor does. The other two settings
          Q4 gave supplier Management -- event choices, and being copied on
          colleagues' referrals -- are untouched and still theirs. */
       or (public.caller_is_director()
           and public.caller_may_set_for(p_user)
           and not exists (select 1
                             from public.users tu
                             join public.partners tp on tp.id = tu.partner_id
                            where tu.id = p_user
                              and coalesce(tp.is_house_route, false) = false
                              and tp.slug <> 'opndoor-agents'))
     ), true) then
    raise exception 'Only a Director, or Opndoor, decides who receives a commission statement.'
      using errcode = '42501';
  end if;

  select full_name into v_actor from public.users where id = auth.uid();

  perform set_config('app.setting_commission_tick', 'on', true);
  update public.users set receives_commission_statements = v_on where id = p_user;
  perform set_config('app.setting_commission_tick', 'off', true);

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values (
    v_level, v_org,
    case when v_on then 'commission_statements_on' else 'commission_statements_off' end,
    coalesce(nullif(btrim(v_target.full_name), ''), v_target.email)
      || case when v_on then ' now receives ' else ' no longer receives ' end
      || coalesce(v_org_name, 'this party') || '''s monthly commission statement',
    coalesce(v_actor, 'an administrator'), auth.uid()
  );

  return v_on;
end $function$;