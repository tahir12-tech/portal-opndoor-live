-- MONTHLY COMMISSION STATEMENTS: WHO GETS ONE, AND WHAT IT SAYS.
--
-- The statement itself already exists, twice over, in TypeScript:
-- getCommissionStatements draws the screen and getAgentCommissionSettlement
-- draws the settlement, and settlement-statement.test.ts holds them to the same
-- accumulator so they cannot disagree. Neither is reachable from an email. A
-- cron running in an Edge Function has no browser store to read, so the same
-- question is asked here, in SQL, against the same rows.
--
-- TWO IMPLEMENTATIONS OF ONE QUESTION IS A LIABILITY, and pretending otherwise
-- is how they drift. The rule is written out once more, deliberately and in the
-- same words, so a future edit to one has an obvious twin:
--
--     applications that PAID inside the month, refunds excluded,
--     one line per payee per application, commission = basis x rate.
--
-- supabase/tests/commission_statement_recipients.test.sql pins the arithmetic
-- against worked examples. Where the SQL answer deliberately differs from the
-- screen's, the difference is named at the line that makes it, not left for
-- somebody to discover by subtracting one from the other.
--
-- ---------------------------------------------------------------------------
-- WHAT A "PAYEE" IS, AND WHO READS ITS POST
-- ---------------------------------------------------------------------------
-- A payee is a party that earns a commission line: a group, an agency or a
-- branch. It is not a person and has no inbox. So a statement is addressed by
-- the same ladder the deed already walks (deed_people_target: branch, then
-- agency, then group above), with one difference that matters:
--
--   THE LADDER IS READ UPWARDS ONLY. A branch's statement may be read by the
--   agency and the group above it. An agency's statement is never readable from
--   a branch below, or a branch manager would receive the whole agency's
--   commission by nominating themselves.
--
-- Within that chain the recipient is not "whoever is most senior" but "whoever
-- is ticked", because who reads the money post is a finance decision and not an
-- org-chart fact. Hence the per-person tick below, defaulted to the top position
-- so nothing is silently unaddressed on day one.

-- ---------------------------------------------------------------------------
-- 1. The tick.
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists receives_commission_statements boolean not null default false;

comment on column public.users.receives_commission_statements is
  'This person receives the monthly commission statement for the party they hold a position over, and for every party below it. Per person, not per position: finance post follows a named human. Default false; the backfill turned it on for the top position at each payee level. Only set_receives_commission_statements may change it.';

-- The column is read by the Agencies and Team screens. agencies already carries
-- a per-column grant (20260928140000), which is the signal that a table here can
-- lose its table-level grant at any time; granting by name now means this column
-- does not silently vanish from the portal the day that happens to users.
grant select (receives_commission_statements) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The backfill: the top position at each payee level, and nobody else.
--
-- "Top position" is read off user_scopes, which is where a position lives: a
-- group scope is a group director, an agency scope is an agency manager. Where a
-- group exists it is the top of that chain, so the director gets the tick and the
-- managers under them do not; an agency with no group above it is its own top and
-- its manager gets it.
--
-- Everyone else stays false by the column default. A branch manager is
-- deliberately not defaulted on: a branch is a payee only when somebody has set
-- an explicit branch rate, which is rare and deliberate, and the agency above
-- already receives that statement.
-- ---------------------------------------------------------------------------
update public.users u
   set receives_commission_statements = true
 where u.role = 'management'
   and u.status <> 'deactivated'
   and (
     exists (
       select 1 from public.user_scopes s
       where s.user_id = u.id and s.kind = 'group'
     )
     or (
       exists (
         select 1 from public.user_scopes s
         join public.agencies a on a.id = s.agency_id
         where s.user_id = u.id and s.kind = 'agency' and a.group_id is null
       )
       and not exists (
         select 1 from public.user_scopes s
         where s.user_id = u.id and s.kind = 'group'
       )
     )
   );

-- ---------------------------------------------------------------------------
-- 3. The finance mailbox on the party.
--
-- Some agencies want the statement in accounts rather than, or as well as, in a
-- named person's inbox. That is a property of the party, not of anybody's
-- position, so it lives on the party. Branches have no such column on purpose:
-- a branch payee is an arrangement inside an agency, and its accounts are the
-- agency's accounts.
-- ---------------------------------------------------------------------------
alter table public.agencies       add column if not exists finance_email text;
alter table public.agency_groups  add column if not exists finance_email text;

do $$ begin
  alter table public.agencies add constraint agencies_finance_email_chk
    check (finance_email is null
           or finance_email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.agency_groups add constraint agency_groups_finance_email_chk
    check (finance_email is null
           or finance_email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$');
exception when duplicate_object then null; end $$;

comment on column public.agencies.finance_email is
  'Optional accounts mailbox for this agency. Receives the monthly commission statement alongside the ticked people, never instead of them. Null means the people are the only recipients.';
comment on column public.agency_groups.finance_email is
  'Optional accounts mailbox for this group. Receives the monthly commission statement alongside the ticked people, never instead of them. Null means the people are the only recipients.';

grant select (finance_email) on public.agencies      to authenticated;
grant select (finance_email) on public.agency_groups to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The tick moves through the RPC or it does not move.
--
-- WHY A TRIGGER AND NOT A COLUMN REVOKE. users_mgmt_update
-- (20260810210000) lets any management user UPDATE any users row in their own
-- partner. On the supplier rail that is a tenant boundary. ON THE AGENT RAIL IT
-- IS NOT: every independently onboarded agency shares the one 'opndoor-agents'
-- house partner, so partner_id = app_partner() is true of a competitor's manager
-- too. A guarded RPC beside an open UPDATE path is not a guard, it is a
-- suggestion, and PostgREST does not read suggestions.
--
-- A column-level REVOKE cannot subtract from the table-level grant, and dropping
-- the table grant on public.users to re-grant forty columns by name is a
-- sign-in-shaped risk for one boolean. So the column announces its own writer
-- instead: set_config with is_local = true scopes the flag to the transaction
-- the RPC is running in, and a portal user has no way to set it on a connection
-- they do not control. The same mechanism guards sandbox deletes
-- (20260810360000) and the all-in breach confirmation (20261003100000).
-- ---------------------------------------------------------------------------
create or replace function public.users_commission_tick_guard()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
begin
  if coalesce(current_setting('app.setting_commission_tick', true), 'off') <> 'on' then
    raise exception 'Who receives commission statements is changed from the person''s row, not by editing them directly.'
      using errcode = '42501';
  end if;
  return new;
end $function$;

drop trigger if exists users_commission_tick_guard on public.users;
create trigger users_commission_tick_guard
  before update of receives_commission_statements on public.users
  for each row
  when (old.receives_commission_statements is distinct from new.receives_commission_statements)
  execute function public.users_commission_tick_guard();

-- ---------------------------------------------------------------------------
-- 5. Which party a person's statements come from.
--
-- Their own position, most senior first, else the agency of the home branch they
-- were invited into. It answers two questions at once: what the audit entry is
-- about, and whether there is any statement for this person to receive at all.
-- ---------------------------------------------------------------------------
create or replace function public.commission_statement_party(p_user uuid)
returns table (level text, org_id uuid, org_name text)
language sql stable security definer set search_path to ''
as $function$
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
    union all
    -- A negotiator holds no scope row at all; "own" is the absence of one. Their
    -- party is the branch they were invited into.
    select 4, 'branch', b.id, b.name
    from public.users u
    join public.branches b on b.id = u.home_branch_id
    where u.id = p_user
  )
  -- Qualified throughout: level, org_id and org_name are also this function's
  -- OUT columns, and an unqualified reference to one of them is a coin toss
  -- between the CTE's column and the output parameter.
  select c.level, c.id, c.name from cand c order by c.pri asc, c.name asc limit 1
$function$;

comment on function public.commission_statement_party(uuid) is
  'The party whose commission statements this person can be sent: their most senior position, else the agency branch they were invited into. Null for Opndoor staff, who have no party and get the consolidated settlement email instead.';

revoke all on function public.commission_statement_party(uuid) from public, anon;
grant execute on function public.commission_statement_party(uuid) to authenticated, service_role;

-- Is the target wholly inside the caller's position? CONTAINMENT, not overlap.
--
-- app_user_in_scope() answers overlap, which is right for "may I see this
-- colleague" (my group head is visible to me, and should be) and wrong here: it
-- would let an agency manager switch off the group director's statements. So the
-- test is that every branch the target reaches is a branch the caller reaches.
create or replace function public.commission_tick_target_within_caller(p_user uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  with caller as (
    select c.branch_id from public.app_scope_branches() as c(branch_id)
  ),
  target as (
    select t.branch_id from public.app_scope_branches_for(p_user) as t(branch_id)
    union
    -- A negotiator holds no scope row, so their only location is the branch they
    -- were invited into. Without this arm they would be unreachable rather than
    -- protected: an empty target set fails the containment test below.
    select u.home_branch_id from public.users u
     where u.id = p_user and u.home_branch_id is not null
  )
  select exists (select 1 from target)
     and not exists (
       select 1 from target t2
        where t2.branch_id not in (select c2.branch_id from caller c2)
     )
$function$;

revoke all on function public.commission_tick_target_within_caller(uuid) from public, anon;
grant execute on function public.commission_tick_target_within_caller(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Setting the tick. Opndoor admin for anyone; the party's top position for
--    their own people; everybody else refused.
--
-- Audited into org_audit against the PARTY, not the person, matching
-- set_node_rate and create_agreement: the thing that changed is where a party's
-- money post goes, and that is what somebody will come looking for.
-- ---------------------------------------------------------------------------
create or replace function public.set_receives_commission_statements(p_user uuid, p_on boolean)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare
  v_target public.users;
  v_actor  text;
  v_level  text;
  v_org    uuid;
  v_org_name text;
  v_on     boolean := coalesce(p_on, false);
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into v_target from public.users where id = p_user;
  if not found then raise exception 'User not found' using errcode = '22023'; end if;

  select c.level, c.org_id, c.org_name into v_level, v_org, v_org_name
  from public.commission_statement_party(p_user) c;
  if v_level is null then
    raise exception 'This person is not attached to a group, agency or branch, so there is no commission statement for them to receive.'
      using errcode = '22023';
  end if;

  if not (
    public.is_admin()
    or (public.app_role() = 'management'
        and public.app_has_scope()
        and public.commission_tick_target_within_caller(p_user))
  ) then
    raise exception 'not permitted' using errcode = '42501';
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

comment on function public.set_receives_commission_statements(uuid, boolean) is
  'Turn one person''s monthly commission statement on or off. Opndoor admin may set it for anyone; a positioned manager only for people wholly inside their own position (containment, not overlap, so an agency manager cannot switch off the group director above them). Audited against the party whose post moved.';

revoke all on function public.set_receives_commission_statements(uuid, boolean) from public, anon;
grant execute on function public.set_receives_commission_statements(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Who a payee's statement goes to.
-- ---------------------------------------------------------------------------
create or replace function public.commission_statement_recipients(p_level text, p_org_id uuid)
returns table (email text, full_name text, source text)
language sql stable security definer set search_path to ''
as $function$
  with party as (
    select case when p_level = 'group'  then p_org_id end as group_id,
           case when p_level = 'agency' then p_org_id end as agency_id,
           case when p_level = 'branch' then p_org_id end as branch_id
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
    select u.email, u.full_name, 'person'::text as source
    from chain c
    join public.user_scopes s
      on (s.kind = 'group'  and s.group_id  = c.group_id)
      or (s.kind = 'agency' and s.agency_id = c.agency_id)
      or (s.kind = 'branch' and s.branch_id = c.branch_id)
    join public.users u on u.id = s.user_id
    -- ACTIVE, not "not deactivated". A pending invite has never signed in, so
    -- the portal link in the statement goes somewhere they cannot open. The run
    -- reports a payee it could not address rather than mailing a dead account.
    where u.receives_commission_statements
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

comment on function public.commission_statement_recipients(text, uuid) is
  'Who receives this payee''s monthly commission statement: every active ticked person at the payee''s own level or ABOVE it (never below), plus the party''s finance mailbox where one is set. Deduplicated by address.';

revoke all on function public.commission_statement_recipients(text, uuid) from public, anon;
grant execute on function public.commission_statement_recipients(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8. The statement itself: every commission line for a month, per payee.
--
-- THE RULE, once more, in the same words as accruePayees in liveAnalytics.ts:
-- applications that PAID inside the month, refunds excluded, one line per payee
-- per application, commission = the amount the rate applied to x the rate.
--
-- Three places where this answer is deliberately NOT byte-identical to the
-- screen's, each because the screen's answer cannot be posted:
--
--   * THE HISTORIC FALLBACK KEEPS ITS AGENCY ID. A row created before the
--     additive model has no frozen split, and both implementations reconstruct a
--     single agency line at the scalar rate. The client keys that line by NAME,
--     because a name is all a table cell needs. An email needs to know which
--     agency to post to, so this one keys by agency_id. Same money, same payee;
--     an agency holding both historic and post-additive rows in one month gets
--     one statement here and two blocks on screen.
--   * THE MONTH IS EUROPE/LONDON. The client buckets in the browser's timezone,
--     which for this book is London. A payment at 00:30 BST on the 1st is 23:30
--     UTC on the last of the previous month, and bucketing it in UTC would put a
--     line in a statement that was posted the day before.
--   * EACH LINE IS ROUNDED TO THE PENNY, and the total is the sum of the rounded
--     lines. The screen sums unrounded and rounds once at the end. A statement
--     that lists what it is made of has to foot to those figures, so the pennies
--     are taken per line here; the two totals can differ by a penny or two on a
--     large month, and the emailed figure is the payable one.
--
-- livemode only. service_role bypasses RLS, so a sandbox rehearsal would
-- otherwise turn up as real money in a real agency's inbox.
-- ---------------------------------------------------------------------------
create or replace function public.commission_statement_lines(p_month date)
returns table (
  payee_key     text,
  level         text,
  org_id        uuid,
  org_name      text,
  partner_id    uuid,
  guarantee_ref text,
  tenant_name   text,
  tenancy_place text,
  branch_name   text,
  paid_on       date,
  fee           numeric,
  share_percent numeric,
  rate          numeric,
  source        text,
  commission    numeric
)
language sql stable security definer set search_path to ''
as $function$
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
  ),
  -- Named split_line, not line: `line` is a built-in geometric type name, and a
  -- CTE that shadows a type is a trap nobody needs to walk into.
  split_line as (
    -- The frozen split. basis_amount is what the rate was a share of, snapshotted
    -- at creation; the fee is the fallback for rows frozen before that column
    -- existed, and is the same number by construction.
    select p.id as application_id, l.level, l.org_id, l.org_name, l.rate, l.source,
           coalesce(l.basis_amount, p.fee_amount, p.monthly_rent, 0) as basis
    from paid p
    join public.application_commission_lines l on l.application_id = p.id
    union all
    -- No split: a historic row, whose money was always the referring agency's.
    select p.id, 'agency', p.agency_id, coalesce(ag.name, '(unknown agency)'),
           coalesce(p.agent_rate, 0), null,
           coalesce(p.fee_amount, p.monthly_rent, 0)
    from paid p
    left join public.agencies ag on ag.id = p.agency_id
    where not exists (
      select 1 from public.application_commission_lines l where l.application_id = p.id
    )
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
    round(l.basis * l.rate, 2)
  from split_line l
  join paid p on p.id = l.application_id
  left join public.branches br on br.id = p.branch_id
  left join public.partners pt on pt.id = p.partner_id
$function$;

comment on function public.commission_statement_lines(date) is
  'Every commission line earned in the calendar month of p_month, one row per payee per application: applications that paid in the month (Europe/London), refunds excluded, live rows only, commission rounded to the penny per line. The SQL twin of accruePayees in liveAnalytics.ts.';

revoke all on function public.commission_statement_lines(date) from public, anon, authenticated;
grant execute on function public.commission_statement_lines(date) to service_role;

-- The aggregate the email is actually built from: one row per payee with at
-- least one line, largest first.
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
  order by g.total desc, g.frozen_name
$function$;

comment on function public.commission_statement_payees(date) is
  'One row per payee with at least one commission line in the month, largest total first. Footed by commission_statement_lines, which is where the rule lives.';

revoke all on function public.commission_statement_payees(date) from public, anon, authenticated;
grant execute on function public.commission_statement_payees(date) to service_role;

-- ---------------------------------------------------------------------------
-- 9. The send ledger, so a retry is not a second statement.
--
-- Two cron jobs fire each morning (07:00 and 08:00 UTC, to straddle BST/GMT) and
-- the function no-ops on the wrong one, but a manual re-run, a retry after a
-- partial failure or a redeploy mid-run must not post the same month twice.
--
-- RLS on with no policy, matching every other cron ledger in this schema
-- (expiry_cohort_sends, payment_reminders, guarantee_renewal_notices): denies
-- anon and authenticated every row, leaves service_role untouched.
-- ---------------------------------------------------------------------------
create table if not exists public.commission_statement_sends (
  statement_month text not null,                    -- 'YYYY-MM'
  -- The payee's key, or '@settlement' for the one consolidated Opndoor email.
  payee_key       text not null,
  recipients      integer not null default 0,
  total           numeric(12,2),
  sent_at         timestamptz not null default now(),
  primary key (statement_month, payee_key)
);

comment on table public.commission_statement_sends is
  'One row per statement posted: payee and month, or ''@settlement'' and month for the consolidated Opndoor email. Written only by the commission-statements function; its presence is what stops a re-run posting twice.';

alter table public.commission_statement_sends enable row level security;
revoke all on public.commission_statement_sends from anon, authenticated;
