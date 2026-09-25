-- THE AGENCY ROW GETS AN ANSWER.
--
-- org_deed_readiness returned one row per branch, every row carrying both ids,
-- while the client sorted them by "is branch_id null" — so the agencies map was
-- always empty and every agency line fell through to the supplier mailbox
-- warning, on agencies with a manager sitting right there to receive the deed.
--
-- Caught by walking it, not by a test, because nothing asserted the SHAPE of
-- what this function returns.

begin;
select plan(7);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route)
values ('97000000-0000-0000-0000-000000000001', 'zzz-ready', 'Ready Estate', 'opndoor_referenced', 0.25, 0.10, true);
insert into public.agencies (id, partner_id, name) values
  ('97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', 'Has People'),
  ('97000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000001', 'Has Nobody');
insert into public.branches (id, agency_id, partner_id, name) values
  ('97000000-0000-0000-0000-000000000004', '97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', 'Ready Branch'),
  ('97000000-0000-0000-0000-000000000005', '97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', 'Second Branch'),
  ('97000000-0000-0000-0000-000000000006', '97000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000001', 'Empty Branch');

-- An admin asking, so scoping is not what is under test here.
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values ('97000000-0000-0000-0000-0000000000ff','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        'admin@zzz-ready.test', now(), now(), '{}'::jsonb,'{}'::jsonb,'','','','','','','',''),
       ('97000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        'mgr@zzz-ready.test', now(), now(), '{}'::jsonb,'{}'::jsonb,'','','','','','','','');
insert into public.users (id, full_name, email, role, partner_id, status) values
  ('97000000-0000-0000-0000-0000000000ff','Ready Admin','admin@zzz-ready.test','superadmin', null, 'active'),
  ('97000000-0000-0000-0000-0000000000a1','Ready Manager','mgr@zzz-ready.test','management',
   '97000000-0000-0000-0000-000000000001','active');
insert into public.user_scopes (user_id, kind, agency_id)
values ('97000000-0000-0000-0000-0000000000a1','agency','97000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claims',
  '{"sub":"97000000-0000-0000-0000-0000000000ff","role":"authenticated","aal":"aal2"}', true);

-- THE SHAPE. This is the assertion whose absence let the defect through.
-- Scoped to this fixture: an admin sees the whole estate, so absolute counts
-- would measure the seed data rather than the contract.
select is(
  (select count(*)::int from public.org_deed_readiness() r
    where r.branch_id is null
      and r.agency_id in ('97000000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000003')),
  2, 'every visible agency gets a row of its own, with a null branch_id');
select is(
  (select count(*)::int from public.org_deed_readiness() r
    where r.branch_id is not null
      and r.agency_id in ('97000000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000003')),
  3, 'and every branch still gets one');

-- THE ANSWER.
select ok(
  (select r.ready from public.org_deed_readiness() r
    where r.agency_id = '97000000-0000-0000-0000-000000000002' and r.branch_id is null),
  'an agency whose branches can all receive reads ready');
select ok(
  not (select r.ready from public.org_deed_readiness() r
        where r.agency_id = '97000000-0000-0000-0000-000000000003' and r.branch_id is null),
  'an agency with nobody does not');

-- ONE GAP MUST SHOW WHILE THE BRANCHES ARE COLLAPSED. This is why it is every,
-- not any: the agency row is all a reader sees until they expand it.
delete from public.user_scopes where user_id = '97000000-0000-0000-0000-0000000000a1';
insert into public.user_scopes (user_id, kind, branch_id)
values ('97000000-0000-0000-0000-0000000000a1','branch','97000000-0000-0000-0000-000000000004');
select ok(
  (select r.ready from public.org_deed_readiness() r where r.branch_id = '97000000-0000-0000-0000-000000000004'),
  'the branch with the manager can receive');
select ok(
  not (select r.ready from public.org_deed_readiness() r where r.branch_id = '97000000-0000-0000-0000-000000000005'),
  'its sibling, with nobody, cannot');
select ok(
  not (select r.ready from public.org_deed_readiness() r
        where r.agency_id = '97000000-0000-0000-0000-000000000002' and r.branch_id is null),
  'so the agency row warns, rather than hiding the gap behind a collapsed row');

select * from finish();
rollback;
