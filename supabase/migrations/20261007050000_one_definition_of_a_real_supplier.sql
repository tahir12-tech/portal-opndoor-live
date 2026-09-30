/* =====================================================================
   ONE DEFINITION OF "A REAL SUPPLIER", AND THE LIST THE ADMIN SCREEN READS.

   A correction to 20261007040000, which is applied. Corrections go in a
   new file: re-running an applied one makes dev disagree with a clean
   filename-order run, and every test then measures the wrong database.

   ---- 1. THE PREDICATE ----

   20261007040000 asked "is this a real supplier?" in four places and
   answered it with a hand-rolled `is_house_route = false and slug <>
   'opndoor-agents'`. That is right about the trap it was written for --
   `opndoor-agents` is NOT flagged `is_house_route`, measured, and a
   supplier arm testing only that column would have turned every agency
   referral on the estate into one enormous supplier payee -- and it is
   still the wrong way to say it, for two reasons.

   IT IS A SECOND COPY. `public.is_house_partner_id(uuid)` already exists
   and already answers exactly this question. It was added because the
   FIRST attempt at the same question used `is_house_route` alone and
   changed nothing, and `our_margin_is_not_theirs.test.sql` exercises it
   by name against all three house slugs. Two copies of a rule this sharp
   is how the estate gets a third that disagrees.

   AND IT IS INCOMPLETE ON ITS FACE. The predicate covers three slugs:
   opndoor-direct, referencing-partner and opndoor-agents. The hand-rolled
   pair happens to exclude the first two today only because their
   `is_house_route` column is set -- which is precisely the column that
   was already proven untrustworthy for this question.

   FIVE CALL SITES IN ALL. Four are 20261007040000's. The fifth is
   `caller_leads_their_party`, from Q4 (20261007030000), which asks the
   same question with the same hand-rolled pair -- and consolidating four
   copies while leaving a fifth standing is not consolidating anything.
   Measured on dev before the change: the pair and the predicate agree
   about all seven partners, so this moves nothing today and stops the
   next slug being added in one place and not the other. Covered by
   a_supplier_manages_its_own_notifications.test.sql, which exercises it
   by name from both sides.

   REGENERATED from 20261007040000's (and 20261007030000's)
   definitions (case-insensitive grep, then copied verbatim by script with
   one substitution each, asserted to match exactly once). No do-block
   string surgery: `npm run drift` cannot model DDL a migration builds at
   run time. `commission_statement_payees` and
   `commission_statement_recipients` are unchanged and are therefore not
   here.

   ---- 2. THE LIST THE ADMIN SCREEN READS ----

   `partner_statement_recipients` is RLS-on with no policy, so a browser
   cannot select from it, so the screen that Matt's third sentence needs
   -- "Opndoor admin can also add named email addresses that aren't portal
   users" -- had nothing to render. 20261007040000 shipped the two writers
   and no reader.

   Extends the test suite, as a security change must:
   `a_supplier_gets_its_own_statement.test.sql` goes to 21 assertions,
   adding the reader from both sides (an admin sees the list, the supplier
   sees an empty one), the removal and its effect, and the two remaining
   house slugs refused at the add door. `definer_grants.test.sql` gains
   the three RPCs and the coverage ceiling moves 133 -> 136, deliberately.
   ===================================================================== */


/* ---- the guard on the admin's add door ------------------------------ */

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
  /* EXISTS AND IS NOT ONE OF OURS. Two tests, because the predicate
     answers false for a partner that is not there at all, and a named
     address hung off a made-up uuid would sit in the table unreachable.

     WRAPPED WHOLE, `coalesce(not (A and B), true)`, and written as the
     positive "this IS a supplier" so that it can be. `not A or B` is the
     shape guardsAreNullSafe refuses by name. */
  if coalesce(not (exists (select 1 from public.partners where id = p_partner)
                   and not public.is_house_partner_id(p_partner)), true) then
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

/* ---- the money: a real supplier's own line on the statement --------- */

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
    where not public.is_house_partner_id(pt2.id)
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

/* ---- whose statement a person is addressed ------------------------- */

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
      and not public.is_house_partner_id(p.id)
  )
  -- Qualified throughout: level, org_id and org_name are also this function's
  -- OUT columns, and an unqualified reference to one of them is a coin toss
  -- between the CTE's column and the output parameter.
  select c.level, c.id, c.name from cand c order by c.pri asc, c.name asc limit 1
$function$;

/* ---- who may switch a statement on --------------------------------- */

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
                            where tu.id = p_user
                              and tu.partner_id is not null
                              and not public.is_house_partner_id(tu.partner_id)))
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

/* ---- the fifth copy, from Q4 --------------------------------------- */

create or replace function public.caller_leads_their_party()
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select coalesce(
    public.caller_is_director()
    or (public.app_role() = 'management'
        and exists (select 1
                      from public.users u
                     where u.id = auth.uid()
                       and u.partner_id is not null
                       and not public.is_house_partner_id(u.partner_id))),
    false)
$function$;

/* ---- the reader the admin screen needs ----------------------------- */

/* READING THE LIST.

   IT NARROWS RATHER THAN RAISING, which is the shape the dev-centre
   readers already use (`dev_api_keys` answers an admin zero rows by the
   same means) and which `every_browser_rpc_checks_its_reach` accepts
   alongside a refusal. A list that raises would make the one screen
   calling it need a try/catch to render an empty card.

   AND THE PREDICATE IS INSIDE THE WHERE, not around the call, so a
   non-admin gets an empty list rather than somebody else's addresses --
   the difference between a guard and a decoration. */
create or replace function public.partner_statement_recipient_list(p_partner uuid)
returns table(id uuid, email text, full_name text, created_at timestamptz)
language sql stable security definer set search_path to ''
as $function$
  select r.id, r.email, r.full_name, r.created_at
  from public.partner_statement_recipients r
  where r.partner_id = p_partner
    and coalesce(public.is_admin(), false)
    and coalesce(public.is_aal2(), false)
  order by r.email
$function$;

/* Called from the browser by the admin card on the supplier Commission
   tab, so `authenticated` with the guard inside. `public` named
   explicitly on the revoke: Postgres grants EXECUTE to PUBLIC on every
   new function, and a revoke that does not say so leaves
   has_function_privilege answering TRUE. */
revoke all on function public.partner_statement_recipient_list(uuid) from public, anon;
grant execute on function public.partner_statement_recipient_list(uuid) to authenticated, service_role;
