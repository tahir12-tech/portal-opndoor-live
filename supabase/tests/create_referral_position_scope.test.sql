-- Position-ladder proof for public.create_referral. Run by `supabase test db`
-- (pgTAP) against a freshly-migrated database, so it re-checks after EVERY
-- migration. Locks the rule added by 20260923150000: on the AGENT RAIL a caller
-- may only refer against a branch inside their own position scope, and SUPPLIER
-- and ADMIN paths are untouched.
--
-- The ladder, expanded by app_scope_branches():
--   negotiator (branch position)             -> exactly that branch
--   agency manager (agency scope)           -> every branch of that agency
-- Cross-scope is refused with '42501' and the exact message. Supplier-rail and
-- admin callers never reach the gate, proven by a scope-less caller who WOULD be
-- refused on the agent rail being allowed on the supplier rail, and by an admin
-- referring across a branch they hold no position over.

begin;
select plan(7);

-- ---------- fixtures (rolled back). Fixed ids so every call is explicit. ----------
-- Two partners: one agent rail (opndoor_referenced), one supplier rail.
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate) values
  ('10000000-0000-0000-0000-000000000001', 'zzz-scope-agent',    'Scope Agent Rail Co', 'opndoor_referenced',  0.25, 0.10),
  ('10000000-0000-0000-0000-000000000002', 'zzz-scope-supplier', 'Scope Supplier Co',   'pre_referenced_open', 0.25, 0.10);

-- Agent-rail org: one group, two agencies, three branches (B1/B2 under A1, B3 under A2).
insert into public.agency_groups (id, partner_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Scope Test Group');
insert into public.agencies (id, partner_id, name, group_id) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Scope Agency One', '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Scope Agency Two', '20000000-0000-0000-0000-000000000001');
insert into public.branches (id, agency_id, partner_id, name) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Branch One'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Branch Two'),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Branch Three');

-- Supplier-rail org: one agency, one branch.
insert into public.agencies (id, partner_id, name) values
  ('30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'Supplier Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('40000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'Supplier Branch');

-- Auth rows (public.users.id references auth.users). Minimal, no password: we
-- impersonate by setting request.jwt.claims, not by logging in.
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'neg@zzz-scope.test',      now(), now(), '{}'::jsonb, '{}'::jsonb, '','','','','','','',''),
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mgr@zzz-scope.test',      now(), now(), '{}'::jsonb, '{}'::jsonb, '','','','','','','',''),
  ('50000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@zzz-scope.test',    now(), now(), '{}'::jsonb, '{}'::jsonb, '','','','','','','',''),
  ('50000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'supplier@zzz-scope.test', now(), now(), '{}'::jsonb, '{}'::jsonb, '','','','','','','','');

-- Negotiator: referrer, branch position over B1. This fixture used to give
-- them NO user_scope and let home_branch_id locate them, which is what the
-- resolver did until 20261006300000: a negotiator is positioned now, like
-- everybody else on the estate, because home_branch_id is a column its own
-- subject could PATCH and create_referral's own gate read it.
-- Agency manager: management, agency scope over A1 (reaches B1 and B2, not B3).
-- Admin: superadmin, no partner.
-- Supplier manager: management under the supplier partner, NO scope, NO home branch.
insert into public.users (id, full_name, email, role, partner_id, status, home_branch_id) values
  ('50000000-0000-0000-0000-000000000001', 'Neg Otiator',    'neg@zzz-scope.test',      'referrer',   '10000000-0000-0000-0000-000000000001', 'active', '40000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', 'Mona Manager',   'mgr@zzz-scope.test',      'management', '10000000-0000-0000-0000-000000000001', 'active', null),
  ('50000000-0000-0000-0000-000000000003', 'Adam Admin',     'admin@zzz-scope.test',    'superadmin', null,                                   'active', null),
  ('50000000-0000-0000-0000-000000000004', 'Sam Supplier',   'supplier@zzz-scope.test', 'management', '10000000-0000-0000-0000-000000000002', 'active', null);

insert into public.user_scopes (user_id, kind, agency_id, branch_id) values
  ('50000000-0000-0000-0000-000000000002', 'agency', '30000000-0000-0000-0000-000000000001', null),
  ('50000000-0000-0000-0000-000000000001', 'branch', null, '40000000-0000-0000-0000-000000000001');

-- ---------- 1. Negotiator, agent rail: their own branch allowed. ----------
do $$ begin perform set_config('request.jwt.claims',
  json_build_object('sub','50000000-0000-0000-0000-000000000001','role','authenticated','aal','aal2')::text, true); end $$;
-- AS THE ROLE, not merely with the claim. Setting request.jwt.claims alone
-- proves the function's own guards, which read auth.uid(); it proves nothing
-- about whether the caller may EXECUTE it. Two locks shipped green because of
-- that gap, so every authorisation assertion here runs as authenticated.
set local role authenticated;
select lives_ok(
  $$ select public.create_referral('40000000-0000-0000-0000-000000000001','Mr','Neg','Tenant','1990-01-01','n@t.test','07700900001','1 A St',null,'Town',null,'SW1A 1AA',1000,(current_date + 30)) $$,
  'negotiator may refer against the branch they are positioned at');

-- ---------- 2. Negotiator, agent rail: a different branch is refused. ----------
select throws_ok(
  $$ select public.create_referral('40000000-0000-0000-0000-000000000002','Mr','Neg','Tenant','1990-01-01','n@t.test','07700900001','2 A St',null,'Town',null,'SW1A 1AA',1000,(current_date + 30)) $$,
  '42501', 'You can only send a referral from one of the offices you work at.',
  'negotiator refused against a branch that is not their home branch');

-- ---------- 3 & 4. Agency manager reaches the whole agency (B1 and B2). ----------
do $$ begin perform set_config('request.jwt.claims',
  json_build_object('sub','50000000-0000-0000-0000-000000000002','role','authenticated','aal','aal2')::text, true); end $$;
set local role authenticated;
select lives_ok(
  $$ select public.create_referral('40000000-0000-0000-0000-000000000001','Mr','Neg','Tenant','1990-01-01','n@t.test','07700900001','1 A St',null,'Town',null,'SW1A 1AA',1000,(current_date + 30)) $$,
  'agency manager may refer against branch one of their agency');
select lives_ok(
  $$ select public.create_referral('40000000-0000-0000-0000-000000000002','Mr','Neg','Tenant','1990-01-01','n@t.test','07700900001','2 A St',null,'Town',null,'SW1A 1AA',1000,(current_date + 30)) $$,
  'agency manager may refer against branch two of the same agency');

-- ---------- 5. Agency manager cannot reach a branch of the other agency. ----------
select throws_ok(
  $$ select public.create_referral('40000000-0000-0000-0000-000000000003','Mr','Neg','Tenant','1990-01-01','n@t.test','07700900001','3 A St',null,'Town',null,'SW1A 1AA',1000,(current_date + 30)) $$,
  '42501', 'You can only send a referral from one of the offices you work at.',
  'agency manager refused against a branch of a sibling agency in the same group');

-- ---------- 6. Supplier rail never reaches the gate: a scope-less management ----------
-- user (who WOULD be refused on the agent rail) is allowed, byte-identical.
do $$ begin perform set_config('request.jwt.claims',
  json_build_object('sub','50000000-0000-0000-0000-000000000004','role','authenticated','aal','aal2')::text, true); end $$;
set local role authenticated;
select lives_ok(
  $$ select public.create_referral('40000000-0000-0000-0000-000000000009','Mr','Neg','Tenant','1990-01-01','n@t.test','07700900001','9 A St',null,'Town',null,'SW1A 1AA',1000,(current_date + 30)) $$,
  'supplier-rail management with no scope may still refer: the ladder does not apply off the agent rail');

-- ---------- 7. Admin is exempt: refers against a branch they hold no position over. ----------
do $$ begin perform set_config('request.jwt.claims',
  json_build_object('sub','50000000-0000-0000-0000-000000000003','role','authenticated','aal','aal2')::text, true); end $$;
set local role authenticated;
select lives_ok(
  $$ select public.create_referral('40000000-0000-0000-0000-000000000002','Mr','Neg','Tenant','1990-01-01','n@t.test','07700900001','2 A St',null,'Town',null,'SW1A 1AA',1000,(current_date + 30)) $$,
  'opndoor admin may refer against any branch on the agent rail');

select * from finish();
rollback;
