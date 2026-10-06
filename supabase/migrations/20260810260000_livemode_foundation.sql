-- livemode: sandbox and live in one project, Stripe style.
--
-- A sandbox application is a rehearsal. It exercises the real create path, the
-- real Stripe and PandaDoc flows against their sandbox credentials, and the real
-- webhook delivery, but it must never reach a commission figure, a bordereau, a
-- settlement, a league, a partner email or HubSpot, and no role except a
-- developer may ever see one.
--
-- ---------------------------------------------------------------------------
-- WHY boolean livemode AND NOT text mode
-- ---------------------------------------------------------------------------
-- "mode" is already taken four times in this tree and means something different
-- each time: partners.referencing_mode; a mode parameter on deliverDeedToAgent
-- meaning automatic or manual; hubspot_sync_env's sandbox/production meaning
-- which HubSpot portal; and the partner-api router already passes
-- referencing_mode positionally into a parameter named mode. A fifth meaning of
-- the same word, on the most important column in the system, is how somebody
-- eventually reads the wrong one.
--
-- boolean rather than text because a boolean cannot acquire a third value. A
-- text column invites `mode <> 'sandbox'`, which admits NULL and admits whatever
-- someone adds later. `where livemode` cannot.
--
-- ---------------------------------------------------------------------------
-- WHY THE DEFAULT IS live, WHEN THE READ RULE IS "hide sandbox"
-- ---------------------------------------------------------------------------
-- The failure direction inverts between reads and writes, and only the read rule
-- is obvious.
--
-- Reads must fail towards hiding sandbox: a developer seeing nothing is a bug, a
-- partner seeing a test row in their commission is an incident.
--
-- Writes must fail towards live. There are exactly two insert paths. If the
-- default were sandbox, any unchanged writer would silently mint invisible rows:
-- real referrals would vanish from management's list, the bordereau, commission,
-- settlement and HubSpot, and partners would go unpaid with nothing raising a
-- hand. Defaulting to live means a sandbox row can only exist where new code
-- deliberately made one.
--
-- The read-side fail-safe is therefore carried entirely by the restrictive
-- policy below and by explicit predicates in the definer functions, NOT by the
-- default. That is why the audit at the bottom of this file exists.

-- ---------- 1. the column, and the ones that travel with it ----------
alter table public.applications
  add column if not exists livemode boolean not null default true;

comment on column public.applications.livemode is
  'False for a sandbox rehearsal application. Never set from a request payload: it is copied from the API key that created the row. Immutable after insert, see applications_livemode_immutable.';

-- An API key is live or sandbox, and that is where an application gets its
-- livemode from. Never from the payload.
alter table public.partner_api_keys
  add column if not exists livemode boolean not null default true;

-- A sandbox POST may create an agency and branch by name, because a partner
-- rehearsing both payload shapes needs to exercise that path. Those orgs must
-- not appear in the portal or in the reconciliation queue.
alter table public.agencies      add column if not exists livemode boolean not null default true;
alter table public.branches      add column if not exists livemode boolean not null default true;
alter table public.agent_contacts add column if not exists livemode boolean not null default true;

-- A sandbox application delivers to endpoints registered in sandbox.
alter table public.partner_webhook_endpoints
  add column if not exists livemode boolean not null default true;

-- ---------- 2. a visibly different reference ----------
-- Sandbox and live sharing guarantee_ref_seq would make a sandbox GR-20604
-- indistinguishable from a real one in a support conversation, and would put
-- gaps in the live sequence proportional to sandbox volume.
create sequence if not exists public.guarantee_ref_sandbox_seq as bigint start with 1 increment by 1;

comment on sequence public.guarantee_ref_sandbox_seq is
  'Sandbox guarantee references, formatted GR-TEST-n. Separate from guarantee_ref_seq so a sandbox reference is unmistakable on sight and live numbering is unaffected by rehearsal volume.';

-- ---------- 3. livemode is immutable ----------
-- RLS cannot express this: a USING clause sees only OLD and a WITH CHECK clause
-- sees only NEW, and no policy expression references both. Without a trigger,
-- applications_update lets a management user flip a real fee-bearing application
-- to sandbox and thereby delete it from the bordereau.
create or replace function public.applications_livemode_immutable()
returns trigger language plpgsql as $$
begin
  if new.livemode is distinct from old.livemode then
    raise exception 'livemode cannot be changed after an application is created.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists applications_livemode_immutable on public.applications;
create trigger applications_livemode_immutable
  before update on public.applications
  for each row execute function public.applications_livemode_immutable();

-- ---------- 4. the restrictive policy ----------
-- Restrictive policies AND with every permissive policy, including the
-- unconditional is_admin() arm of applications_select. So this subtracts sandbox
-- from superadmin, management and referrer without editing a line of the
-- existing policy.
--
-- THERE IS DELIBERATELY NO DEVELOPER ARM. Nobody sees a sandbox application
-- through PostgREST, including a developer. A developer sees them in the Dev
-- Centre, through definer RPCs with an explicit column list. That keeps the
-- policy absolute, keeps the portal client entirely unchanged, and means the one
-- hydrated dataset never has to be both a sandbox view and a sandbox-free
-- reporting base.
--
-- Written positively (`livemode`) rather than as `livemode is not false`: a NULL
-- must deny, not admit. The column is NOT NULL, so this is belt and braces, but
-- the habit is what matters when someone adds a nullable one later.
--
-- FOR ALL, not FOR SELECT: otherwise applications_insert still lets a management
-- user POST {"livemode": false} straight at PostgREST, which is mode-from-payload
-- arriving through the table.
drop policy if exists applications_live_only on public.applications;
create policy applications_live_only on public.applications
  as restrictive for all to authenticated
  using (livemode) with check (livemode);

drop policy if exists agencies_live_only on public.agencies;
create policy agencies_live_only on public.agencies
  as restrictive for all to authenticated using (livemode) with check (livemode);

drop policy if exists branches_live_only on public.branches;
create policy branches_live_only on public.branches
  as restrictive for all to authenticated using (livemode) with check (livemode);

drop policy if exists contacts_live_only on public.agent_contacts;
create policy contacts_live_only on public.agent_contacts
  as restrictive for all to authenticated using (livemode) with check (livemode);

-- activity_log and application_notes have no livemode of their own. They inherit
-- it, because their SELECT policies nest a subquery against applications and the
-- restrictive policy above applies inside that subquery too.

-- ---------- 5. purging sandbox ----------
-- Once the restrictive policy is in place, applications_delete is ANDed with it,
-- so not even a superadmin can delete a sandbox row through PostgREST. Stripe
-- lets you clear test data; without this, nothing here would, and sandbox rows
-- would accumulate for ever.
--
-- Definer, so it can reach past the policy. Deliberately refuses to touch a live
-- row under any circumstances: the where clause is `not livemode`, never an id
-- list, so a mistyped argument cannot delete real money.
create or replace function public.dev_purge_sandbox(p_partner uuid default null)
returns table (applications_deleted bigint, agencies_deleted bigint, branches_deleted bigint)
language plpgsql security definer set search_path to '' as $$
declare v_apps bigint; v_ag bigint; v_br bigint; v_partner uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  if public.is_admin() then
    v_partner := p_partner;
  elsif public.app_role() = 'developer' then
    v_partner := public.app_partner();
  else
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- Cascades take activity_log, notes, payment tokens and webhook deliveries.
  with d as (
    delete from public.applications a
     where not a.livemode and (v_partner is null or a.partner_id = v_partner)
    returning 1)
  select count(*) into v_apps from d;

  with d as (
    delete from public.branches b
     where not b.livemode and (v_partner is null or b.partner_id = v_partner)
    returning 1)
  select count(*) into v_br from d;

  with d as (
    delete from public.agencies g
     where not g.livemode and (v_partner is null or g.partner_id = v_partner)
    returning 1)
  select count(*) into v_ag from d;

  return query select v_apps, v_ag, v_br;
end $$;

revoke all on function public.dev_purge_sandbox(uuid) from public, anon;
grant execute on function public.dev_purge_sandbox(uuid) to authenticated;

-- ===========================================================================
-- 6. THE AUDIT. This is the load-bearing part of the whole design.
-- ===========================================================================
--
-- RLS IS NOT THE GUARANTEE, and saying it is would be the most dangerous kind of
-- wrong: reassuring and false.
--
-- No table in this schema sets FORCE ROW LEVEL SECURITY, so SECURITY DEFINER
-- functions and service_role bypass every policy above completely. Measured
-- against the live database: 27 definer functions read public.applications, and
-- 11 of them are granted to `authenticated`, meaning any signed-in browser can
-- call them directly with fetch. For those 11, the restrictive policy is
-- decorative. Each needs its own livemode predicate, and the obligation is
-- permanent: it applies to every function anybody writes from now on.
--
-- An obligation that relies on memory will be forgotten. So it is checked.
--
-- The exemption table is the honest part. Some definer functions legitimately do
-- not need a predicate, and pretending otherwise would make the audit noisy and
-- then ignored. Exempting one requires writing down why, in a row somebody can
-- read and challenge.

create table if not exists public.livemode_audit_exemptions (
  function_name text primary key,
  reason        text not null,
  added_at      timestamptz not null default now()
);

comment on table public.livemode_audit_exemptions is
  'Definer functions that read public.applications but legitimately need no livemode predicate. Adding a row here is a reviewed decision, not a way to silence the audit. Every reason must say why the function cannot leak a sandbox row.';

alter table public.livemode_audit_exemptions enable row level security;
revoke all on table public.livemode_audit_exemptions from anon, authenticated;

/**
 * Every SECURITY DEFINER function that reads public.applications without
 * mentioning livemode, and is not exempt.
 *
 * Returns rows. An empty result is the passing state.
 */
create or replace function public.livemode_audit()
returns table (function_name text, granted_to_authenticated boolean, why text)
language sql stable security definer set search_path to '' as $$
  select
    p.proname::text,
    has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    case
      when has_function_privilege('authenticated', p.oid, 'EXECUTE')
        then 'DEFINER, reads applications, no livemode predicate, and CALLABLE FROM A BROWSER. A developer''s sandbox rows are visible to any signed-in user through this function.'
      else 'DEFINER, reads applications, no livemode predicate. Not browser-callable, but it bypasses RLS so any caller with execute sees sandbox rows.'
    end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    -- prokind 'f' only: pg_get_functiondef raises on aggregates and window
    -- functions, which would turn the audit itself into an error.
    and p.prokind = 'f'
    and pg_get_functiondef(p.oid) like '%public.applications%'
    and pg_get_functiondef(p.oid) not like '%livemode%'
    and p.proname not in (select function_name from public.livemode_audit_exemptions)
  order by has_function_privilege('authenticated', p.oid, 'EXECUTE') desc, p.proname;
$$;

comment on function public.livemode_audit() is
  'Returns every SECURITY DEFINER function reading public.applications with no livemode predicate and no exemption. An empty result is the passing state. Run it after any migration that adds or replaces a function touching applications: RLS does not protect definer functions, so this is what actually holds the line.';

revoke all on function public.livemode_audit() from public, anon;
grant execute on function public.livemode_audit() to authenticated, service_role;
