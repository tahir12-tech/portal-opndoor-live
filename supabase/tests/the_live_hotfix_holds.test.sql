-- THE HOTFIX FOR THE LIVE SYSTEM, PROVED BEFORE ANYBODY TOUCHES IT.
--
-- RETIRED AS A DOCUMENT, KEPT AS A TEST. 2026-09-30: Matt's decision is that
-- "there is no separate live hotfix. Everything in HOTFIX-LIVE-FOR-BALAL.md
-- ships with the cutover instead", so both files are deleted and nobody
-- applies anything by hand any more.
--
-- This file stays, and stays exactly as it is, because what it proves did
-- not change: the two statements are now migrations rather than a script,
-- and they still have to do to PRODUCTION's schema what they were written
-- to do. The replica below is production's shape, which the branch's own
-- tests cannot exercise because dev is 348 migrations past it.
--
-- What it used to say, and why the replica exists at all:
--
-- docs/HOTFIX-LIVE-FOR-BALAL.md was applied BY HAND to production, by
-- somebody who is not a developer, during a customer go-live. There is no
-- staging copy of production and no way to try it there first, so the only
-- honest way to hand it over was to rebuild the live schema here and run
-- it.
--
-- WHY A REPLICA SCHEMA RATHER THAN public. Dev is the partner-api branch: 323
-- migrations against production's 65. Dev's applications table already has the
-- branch's revoke, so the BEFORE state cannot be reproduced there, and dev's
-- policies are not production's. `hfx` below is production's shape, taken from
-- the migration files at origin/main (3520a26), whose supabase/migrations tree
-- is byte-identical to the local main. Everything is created and destroyed
-- inside one transaction that rolls back, so dev is unchanged.
--
-- WHAT IS FAITHFUL AND WHAT IS NOT. Faithful: all 53 column NAMES of
-- public.applications; the four policies verbatim; app_role, app_partner,
-- is_admin and is_aal2 verbatim; mark_withdrawn's real body; and the grant
-- state, which is Supabase's ALTER DEFAULT PRIVILEGES granting ALL to anon and
-- authenticated, because no migration on main ever narrows it. Not faithful:
-- column TYPES are approximated, and expiry_date is a plain column here where
-- production generates it. Neither affects a privilege test, and both make the
-- lock list LONGER rather than shorter, so the proof is conservative.
--
-- THE TWO HALVES BEING PROVED
--
--   1. `revoke insert, update, delete, truncate on public.applications
--       from anon, authenticated`
--      The browser never writes this table. Across all 133 files of the live
--      client there is no .update, .insert, .upsert or .delete on any table:
--      every mutation goes through a SECURITY DEFINER rpc or an edge function
--      holding the service key, and neither is affected by a table grant. So
--      "the columns the live screens edit" is the EMPTY SET, and the fix is a
--      plain revoke with no re-grant at all.
--
--   2. `app_role()` returns '' instead of NULL for a caller with no
--      public.users row.
--      Every guard of the form `if not (is_admin() or app_role() = ... ) then
--      raise` evaluates to NULL for such a caller, and `if NULL then` does not
--      fire, so the guard is skipped. Empty string is not a valid role -- the
--      column's CHECK allows only superadmin, management, referrer -- so every
--      comparison that was NULL becomes false, and every guard that did not
--      fire now fires. Strictly narrowing, and it fixes all four functions
--      Matt named plus eight more, including one privilege escalation.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT PROVE, because the hotfix does not
-- attempt it: create_referral and the org/contact family guard on
-- `pid = app_partner()` with no app_role() in the condition, so they fail open
-- the same way and half 2 does NOT fix them. They cannot be fixed the same way
-- either: create_referral_target uses `pid is not null` to tell a partner user
-- from an opndoor admin, and an opndoor admin's partner_id is legitimately
-- NULL, so coalescing app_partner() would route every admin down the partner
-- branch and insert agencies with a partner id that does not exist. That is
-- recorded in the document and in QUEUE.md under "Needs Matt", not fixed here.

begin;
select plan(19);

-- ===========================================================================
-- PRODUCTION'S SHAPE
-- ===========================================================================
create schema hfx;
grant usage on schema hfx to anon, authenticated, service_role;

create table hfx.partners (
  id uuid primary key, slug text unique not null, name text not null);

create table hfx.users (
  id uuid primary key,
  full_name text not null,
  email text not null,
  role text not null check (role in ('superadmin','management','referrer')),
  partner_id uuid references hfx.partners(id),
  status text not null default 'active');

-- All 53 columns of public.applications as they stand after main's 65
-- migrations, in ordinal order.
create table hfx.applications (
  id uuid primary key default gen_random_uuid(),
  guarantee_ref text unique not null,
  partner_id uuid not null references hfx.partners(id),
  agency_id uuid,
  branch_id uuid,
  referrer_id uuid,
  tenant_title text, tenant_first_name text, tenant_last_name text,
  tenant_dob date, tenant_email text, tenant_phone text,
  prop_addr1 text, prop_addr2 text, prop_city text, prop_county text, prop_postcode text,
  monthly_rent numeric, tenancy_start date,
  status text not null default 'sent',
  sent_at timestamptz, paid_at timestamptz, deed_issued_at timestamptz,
  issue_date date, expiry_date date, created_at timestamptz default now(),
  beneficiary text,
  stripe_checkout_session_id text, stripe_payment_intent_id text, stripe_refund_id text,
  payment_url text, paid_amount numeric, refunded_at timestamptz,
  payment_state text, refunded_amount numeric, refund_after_start boolean,
  pandadoc_document_id text, deed_state text, deed_sent_at timestamptz,
  deed_executed_at timestamptz, executed_pdf_path text, deed_viewed_at timestamptz,
  expiry_reminders_sent int, last_expiry_reminder_at timestamptz,
  partner_rate numeric, agent_rate numeric,
  withdrawn_at timestamptz, withdrawn_reason text, withdrawn_note text, withdrawn_by uuid,
  expired_at timestamptz, withdrawn_by_tenant boolean, referrer_name text);

create table hfx.activity_log (
  id bigserial primary key, application_id uuid, kind text, message text,
  actor text, visibility text, created_at timestamptz default now());

-- SUPABASE'S DEFAULT PRIVILEGES, which is the entire reason this hotfix
-- exists. No migration on main grants or revokes anything on applications, so
-- the table sits on `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
-- authenticated, service_role`. Absence of a grant statement is not absence of
-- a grant.
grant all on hfx.partners, hfx.users, hfx.applications, hfx.activity_log
  to anon, authenticated;
grant usage, select on all sequences in schema hfx to anon, authenticated;

-- ---------------------------------------------------------------------------
-- main's identity functions, verbatim but hfx-qualified
-- ---------------------------------------------------------------------------
create function hfx.app_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from hfx.users where id = auth.uid()
$$;

create function hfx.app_partner() returns uuid
language sql stable security definer set search_path = '' as $$
  select partner_id from hfx.users where id = auth.uid()
$$;

create function hfx.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'superadmin' from hfx.users where id = auth.uid()), false)
$$;

create function hfx.is_aal2() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
$$;

grant execute on function hfx.app_role(), hfx.app_partner(), hfx.is_admin(), hfx.is_aal2()
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- main's policies on applications, verbatim
-- ---------------------------------------------------------------------------
alter table hfx.applications enable row level security;

create policy require_aal2 on hfx.applications as restrictive for all to authenticated
  using (hfx.is_aal2()) with check (hfx.is_aal2());

create policy applications_select on hfx.applications for select to authenticated using (
  hfx.is_admin()
  or (hfx.app_role() = 'management' and partner_id = hfx.app_partner())
  or (hfx.app_role() = 'referrer'   and referrer_id = auth.uid())
);
create policy applications_insert on hfx.applications for insert to authenticated with check (
  hfx.is_admin()
  or (hfx.app_role() in ('management','referrer') and referrer_id = auth.uid() and partner_id = hfx.app_partner())
);
create policy applications_update on hfx.applications for update to authenticated
using (
  hfx.is_admin()
  or (hfx.app_role() = 'management' and partner_id = hfx.app_partner())
  or (hfx.app_role() = 'referrer'   and referrer_id = auth.uid() and status = 'sent')
)
with check (
  hfx.is_admin()
  or (hfx.app_role() = 'management' and partner_id = hfx.app_partner())
  or (hfx.app_role() = 'referrer'   and referrer_id = auth.uid() and status = 'sent')
);
create policy applications_delete on hfx.applications for delete to authenticated
  using (hfx.is_admin());

-- ---------------------------------------------------------------------------
-- mark_withdrawn, one of the four Matt named, with its real body. The other
-- three carry the IDENTICAL guard condition -- the probe below evaluates that
-- shared condition directly, which is why one full function is enough.
-- ---------------------------------------------------------------------------
create function hfx.mark_withdrawn(p_ref text, p_reason text, p_note text)
returns hfx.applications
language plpgsql security definer set search_path to '' as $function$
declare a hfx.applications; r text; owned boolean; who text;
begin
  if not hfx.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from hfx.applications where guarantee_ref = p_ref;
  if not found then raise exception 'application not found'; end if;
  r := hfx.app_role();
  owned := a.referrer_id = auth.uid();
  if not (hfx.is_admin() or (r = 'management' and a.partner_id = hfx.app_partner()) or (r = 'referrer' and owned)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if a.status <> 'sent' then raise exception 'Only an application at Sent (before payment) can be withdrawn.' using errcode = '42501'; end if;
  update hfx.applications
    set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = p_reason,
        withdrawn_by = auth.uid()
    where id = a.id returning * into a;
  who := coalesce((select full_name from hfx.users where id = auth.uid()), 'a user');
  insert into hfx.activity_log(application_id, kind, message, actor, visibility)
  values (a.id, 'withdrawn', 'Application withdrawn.', who, 'business');
  return a;
end $function$;
grant execute on function hfx.mark_withdrawn(text, text, text) to authenticated, service_role;

/* THE SHARED GUARD, as a probe. mark_withdrawn, add_application_note,
   amend_tenancy_start and send_deed_to_agent all carry this exact condition.
   It returns the three-valued result of the guard test, so the assertion can
   say WHICH of the three it is: NULL means `if not (...) then raise` does not
   fire and the caller walks through. */
create function hfx.guard_says(p_app uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not (hfx.is_admin()
              or (hfx.app_role() = 'management' and a.partner_id = hfx.app_partner())
              or (hfx.app_role() = 'referrer'   and a.referrer_id = auth.uid()))
  from hfx.applications a where a.id = p_app
$$;
grant execute on function hfx.guard_says(uuid) to authenticated, service_role;

-- ===========================================================================
-- THE PEOPLE AND THE CASE
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('96000000-0000-0000-0000-000000000a01'::uuid,'zzz.hfx.manager@r.test'),
  ('96000000-0000-0000-0000-000000000b01'::uuid,'zzz.hfx.negotiator@r.test'),
  ('96000000-0000-0000-0000-00000000f0f0'::uuid,'zzz.hfx.ghost@r.test')
) as x(id,email);

insert into hfx.partners (id, slug, name)
values ('96000000-0000-0000-0000-0000000000c1','zzz-hfx-partner','ZZZ Hotfix Partner');

insert into hfx.users (id, full_name, email, role, partner_id) values
  ('96000000-0000-0000-0000-000000000a01','Mo Manager','zzz.hfx.manager@r.test','management','96000000-0000-0000-0000-0000000000c1'),
  ('96000000-0000-0000-0000-000000000b01','Ned Negotiator','zzz.hfx.negotiator@r.test','referrer','96000000-0000-0000-0000-0000000000c1');
-- AND THE GHOST: a real auth account, MFA enrolled, with NO hfx.users row.
-- Production had two of exactly this shape until 2026-09-29.

insert into hfx.applications
  (id, guarantee_ref, partner_id, referrer_id, monthly_rent, status, sent_at, payment_state)
values
  ('96000000-0000-0000-0000-0000000000e1','ZZZ-HFX-1','96000000-0000-0000-0000-0000000000c1',
   '96000000-0000-0000-0000-000000000b01', 1300, 'sent', now(), 'awaiting'),
  ('96000000-0000-0000-0000-0000000000e2','ZZZ-HFX-2','96000000-0000-0000-0000-0000000000c1',
   '96000000-0000-0000-0000-000000000b01', 1300, 'sent', now(), 'awaiting'),
  -- Left untouched by the BEFORE half so the AFTER half can prove the
  -- legitimate withdrawal path still works on a case at Sent.
  ('96000000-0000-0000-0000-0000000000e3','ZZZ-HFX-3','96000000-0000-0000-0000-0000000000c1',
   '96000000-0000-0000-0000-000000000b01', 1300, 'sent', now(), 'awaiting');

-- ===========================================================================
-- BEFORE: WHAT THE LIVE SYSTEM ALLOWS TODAY
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-000000000a01","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

/* THE PAYMENT FORGERY. A Manager updating a colleague's application straight
   through PostgREST. applications_update admits any row in their partner, and
   nothing narrows which columns. */
select lives_ok(
  $$update hfx.applications
      set status = 'paid', payment_state = 'paid', paid_at = now(), paid_amount = monthly_rent
    where guarantee_ref = 'ZZZ-HFX-1'$$,
  'BEFORE: a Manager can mark an unpaid application paid, straight from the browser');

select is((select status || '/' || payment_state || '/' || (paid_amount)::text
             from hfx.applications where guarantee_ref = 'ZZZ-HFX-1'),
  'paid/paid/1300'::text,
  'BEFORE: ...and the row now reads as a genuine paid guarantee, with an amount nobody paid');

select lives_ok(
  $$update hfx.applications set monthly_rent = 1 where guarantee_ref = 'ZZZ-HFX-2'$$,
  'BEFORE: and can rewrite the fee basis every commission figure derives from');

select lives_ok(
  $$update hfx.applications set executed_pdf_path = 'someone/elses/deed.pdf'
    where guarantee_ref = 'ZZZ-HFX-2'$$,
  'BEFORE: and can repoint the executed deed at another document');

reset role;
/* THE MIRROR OF ASSERTION 12, and the one that makes "every other column
   locked" mean something. A table-level grant is reported per column, so the
   before-and-after pair is 53 writable columns and then none. */
select is(
  (select count(*)::int from pg_attribute a
    where a.attrelid = 'hfx.applications'::regclass
      and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')),
  53, 'BEFORE: every one of the 53 columns is writable by authenticated');

select ok(
  has_table_privilege('authenticated','hfx.applications','UPDATE')
  and has_table_privilege('authenticated','hfx.applications','INSERT')
  and has_table_privilege('authenticated','hfx.applications','DELETE'),
  'BEFORE: authenticated holds UPDATE, INSERT and DELETE on the whole table');

/* THE FAIL-OPEN. The ghost has a valid AAL2 session and no profile row. */
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000f0f0","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select ok(hfx.app_role() is null, 'BEFORE: app_role() is NULL for a caller with no users row');

select ok(hfx.guard_says('96000000-0000-0000-0000-0000000000e2') is null,
  'BEFORE: so the shared guard of all four functions is NULL, and `if NULL then raise` does not fire');

select lives_ok(
  $$select hfx.mark_withdrawn('ZZZ-HFX-2', 'duplicate', null)$$,
  'BEFORE: and the ghost withdraws somebody else''s application');

reset role;
select is((select status from hfx.applications where guarantee_ref = 'ZZZ-HFX-2'),
  'withdrawn'::text, 'BEFORE: the withdrawal really happened, it was not merely permitted');

-- ===========================================================================
-- THE HOTFIX. These two statements were docs/HOTFIX-LIVE-FOR-BALAL.sql, with
-- `public.` read as `hfx.`. Nothing else is changed.
-- ===========================================================================
revoke insert, update, delete, truncate on hfx.applications from anon, authenticated;

create or replace function hfx.app_role() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select role from hfx.users where id = auth.uid()), '')
$$;

-- ===========================================================================
-- AFTER: THE HOLES ARE SHUT
-- ===========================================================================
select ok(
  not has_table_privilege('authenticated','hfx.applications','UPDATE')
  and not has_table_privilege('authenticated','hfx.applications','INSERT')
  and not has_table_privilege('authenticated','hfx.applications','DELETE')
  and not has_table_privilege('anon','hfx.applications','UPDATE'),
  'AFTER: neither authenticated nor anon holds any write privilege on the table');

/* EVERY COLUMN, not just the dangerous ones. This is the assertion that says
   "every other column locked": 53 columns, none of them writable, and the
   count is read from the catalogue rather than from a list somebody typed. */
/* READ BY RELATION OID, not through information_schema. The obvious spelling
   -- information_schema.columns filtered to this table, with
   has_column_privilege(...) in the same WHERE -- is wrong: nothing orders the
   schema filter before the function call, so the planner feeds it column
   names from every other `applications` in the database and it dies on
   public.applications.livemode. pg_attribute keyed on the oid cannot make
   that mistake. */
select is(
  (select count(*)::int from pg_attribute a
    where a.attrelid = 'hfx.applications'::regclass
      and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')),
  0, 'AFTER: authenticated may update none of the 53 columns');

select is(
  (select count(*)::int from pg_attribute
    where attrelid = 'hfx.applications'::regclass and attnum > 0 and not attisdropped),
  53, 'AFTER: and there really are 53 of them, so the count above is not vacuous');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-000000000a01","role":"authenticated","aal":"aal2"}', true);

select throws_ok(
  $$update hfx.applications set status = 'paid' where guarantee_ref = 'ZZZ-HFX-1'$$,
  '42501', null, 'AFTER: the payment forgery is refused');

/* AND THE WORK STILL WORKS. Every live screen action reaches this table
   through a SECURITY DEFINER function or the service key, and a definer
   function runs as its owner, so the revoke does not touch it. If this
   assertion fails, the hotfix has broken the product. */
select lives_ok(
  $$select hfx.mark_withdrawn('ZZZ-HFX-3', 'duplicate', null)$$,
  'AFTER: a Manager can still withdraw an application, because that path is a definer function');

select lives_ok(
  $$select count(*) from hfx.applications$$,
  'AFTER: and the screens can still READ, because SELECT was never touched');

/* THE GHOST IS OUT. */
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000f0f0","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select hfx.mark_withdrawn('ZZZ-HFX-2', 'duplicate', null)$$,
  '42501', 'not permitted',
  'AFTER: the caller with no users row is refused by name, on permission');

/* AND NOTHING CHANGED FOR SOMEBODY WHO IS REAL. The whole safety argument for
   half 2 is that it only affects callers the database cannot identify. */
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-000000000b01","role":"authenticated","aal":"aal2"}', true);
select is(hfx.app_role(), 'referrer'::text,
  'AFTER: a caller who does have a users row still gets their real role');

reset role;

/* THE ORDERING TRAP, pinned so nobody "tidies" the statement later. A
   column-level grant cannot subtract from a table-level grant: add the
   allowlist without revoking the table first and the hole stays wide open.
   This is the same class of mistake as the revoke that broke every user
   invite, and it is why the file is a plain revoke with no re-grant. */
create table hfx.trap (a int, b int);
grant all on hfx.trap to authenticated;
grant update (a) on hfx.trap to authenticated;          -- the allowlist ALONE
insert into hfx.trap values (1, 1);
set local role authenticated;
select lives_ok(
  $$update hfx.trap set b = 99$$,
  'a column allowlist added WITHOUT revoking the table first changes nothing at all');
reset role;

select * from finish();
rollback;
