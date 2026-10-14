/* (ci) A SUPPLIER-ESTATE AGENCY HAS NO CHECKING SETTING OF ITS OWN.
   Migration: 20261009030000.

   Matt: "Make the server refuse setting a referencing mode on any
   supplier-estate agency or office, so the inheritance fix can't be undone
   by a click."

   WHY IT MATTERS MORE THAN A HIDDEN CONTROL. resolve_referencing_mode is a
   coalesce: the agency's own mode first, the route partner's second. A value
   stored on a supplier's agency does not sit alongside the supplier's
   setting, it OVERRIDES it, for every referral through that agency, silently.

   MEASURED ON DEV BEFORE THE GUARD: all eight agencies in Kestrel's estate
   hold NULL and inherit correctly. Nothing is being repaired; one click was
   all it took to break it. */
begin;
select plan(6);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('cc100000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.ci.admin@opndoor.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('cc100000-0000-0000-0000-00000000c001','ZZZ CI Admin','zzz.ci.admin@opndoor.test',
        'superadmin', null,'active',true);

-- A supplier with an agency in its estate, and one of ours to compare.
insert into public.partners (id, slug, name, status, partner_kind, referencing_mode, partner_rate, agent_rate)
values ('cc100000-0000-0000-0000-00000000f001'::uuid, 'zzz-ci-supplier', 'ZZZ CI Supplier',
        'active', 'supplier', 'pre_referenced_open', 0.2, 0.1);
insert into public.agencies (id, name, partner_id, referencing_mode)
values ('cc100000-0000-0000-0000-00000000f0a1'::uuid, 'ZZZ CI Estate Agency',
        'cc100000-0000-0000-0000-00000000f001'::uuid, null);
insert into public.agencies (id, name, partner_id, referencing_mode)
values ('cc100000-0000-0000-0000-00000000f0a2'::uuid, 'ZZZ CI Our Agency',
        (select id from public.partners where slug = 'opndoor-agents'), 'pre_referenced_open');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cc100000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

-- ===========================================================================
-- 1. THE REFUSAL, AND IT IS AN ADMIN BEING REFUSED.
-- ===========================================================================
/* NOT A PERMISSION PROBLEM: this caller is a superadmin with MFA, which is
   everything the function asked for until now. The refusal is about the
   TARGET, which is what makes it a rule rather than a role check. */
select throws_ok(
  $$select public.set_agency_referencing_mode('cc100000-0000-0000-0000-00000000f0a1','opndoor_referenced')$$,
  '42501', 'This agency follows its supplier''s checking setting. Change it on the supplier.',
  'an admin cannot set a mode on an agency in a supplier''s estate');

select is(
  (select referencing_mode::text from public.agencies where id = 'cc100000-0000-0000-0000-00000000f0a1'),
  null,
  'and nothing was written');

/* THE MODE IT WOULD HAVE OVERRIDDEN, asserted so the consequence is in the
   test rather than only in the commit message. */
select is(
  (select p.referencing_mode::text from public.partners p where p.slug = 'zzz-ci-supplier'),
  'pre_referenced_open',
  'so the supplier''s own setting is still what the estate follows');

-- ===========================================================================
-- 2. AND OURS STILL WORKS, which is the half a blanket refusal would break.
-- ===========================================================================
select lives_ok(
  $$select public.set_agency_referencing_mode('cc100000-0000-0000-0000-00000000f0a2','opndoor_referenced')$$,
  'an agency on our own estate can still be set');

select is(
  (select referencing_mode::text from public.agencies where id = 'cc100000-0000-0000-0000-00000000f0a2'),
  'opndoor_referenced',
  'and it moved');

/* AND THE OLD GUARDS ARE UNTOUCHED. The target test is added in front of
   the existing ones, not instead of them. */
select throws_ok(
  $$select public.set_agency_referencing_mode('cc100000-0000-0000-0000-00000000f0a2','nonsense')$$,
  '22023', null,
  'and an unknown mode is still refused');

select * from finish();
rollback;
