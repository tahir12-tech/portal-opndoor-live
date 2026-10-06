-- SUPPLIER MANAGEMENT SEES ITS OWN COMMISSION, WHATEVER THE CALLER SENT.
--
-- Matt, 2026-10-03: "I invited Matthew Dwyer as 'Management' from Kestrel's
-- own Add user dialog, whose only options are Management, Referrer and
-- Developer. So supplier 'Management' invited that way gets
-- sees_commission = false, which is the defect: supplier Management must see
-- commission. Fix the supplier invite."
--
-- WHY THE CLIENT FIX WAS NOT THE FIX. SUPPLIER_LEVELS now passes
-- seesCommission true, which corrects the one dialog Matt used. The flag went
-- on being whatever reached create_invited_user, so any other door -- the edge
-- function, a replayed request, a tab still running yesterday's bundle --
-- could still write a supplier's Management blind to their own commission, and
-- the session reads that flag straight off the row. So the rule belongs in the
-- function, and the test is written the only way that proves it: by passing
-- FALSE and expecting true.
--
-- AND THE RAIL IT MUST NOT REACH. On the agency estate the same flag is the
-- only thing that tells a Director from a Manager, both of which are real
-- levels chosen on purpose. Forcing it there would promote every Manager in
-- the product, so half of this file is the agency rail staying exactly as it
-- was.

begin;
select plan(13);

insert into public.partners (id, slug, name, referencing_mode, is_house_route, partner_kind)
values ('c4000000-0000-0000-0000-0000000000a1','zzz-com-sup','ZZZ Commission Supplier',
        'pre_referenced_open', false, 'supplier'),
/* AND ONE ON THE AGENCY RAIL, so the distinction can be MEASURED rather than
   asserted about the rows that happen to be on dev. Not the house partner
   itself: inviting there wants a position, a branch to hold it and a grantor
   above the level granted, none of which is what this file is about. Kind
   'agency' is the fact create_invited_user actually reads. */
       ('c4000000-0000-0000-0000-0000000000a2','zzz-com-ag','ZZZ Commission Agency',
        'pre_referenced_open', false, 'agency');

-- The callers: an admin (who may invite anywhere) and the supplier's own
-- Management (the door Matt actually used).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       email, '', now(), now(), now()
from (values
  ('c4000000-0000-0000-0000-0000000000d1'::uuid,'zzz.com.admin@o.test'),
  ('c4000000-0000-0000-0000-0000000000d2'::uuid,'zzz.com.supmgmt@s.test')
) as v(id, email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('c4000000-0000-0000-0000-0000000000d1','ZZZ Commission Admin','zzz.com.admin@o.test',
        'superadmin', null, 'active', true),
       ('c4000000-0000-0000-0000-0000000000d2','ZZZ Commission SupMgmt','zzz.com.supmgmt@s.test',
        'management','c4000000-0000-0000-0000-0000000000a1','active', true);

-- The auth rows for the invitees. public.users.id references auth.users.id and
-- invite-user mints the account first, so a test calling the function directly
-- has to stand in for that half or every insert dies on the foreign key.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       email, '', now(), now(), now()
from (values
  ('c4000000-0000-0000-0000-00000000e001'::uuid,'zzz.com.newmgmt@s.test'),
  ('c4000000-0000-0000-0000-00000000e002'::uuid,'zzz.com.newref@s.test'),
  ('c4000000-0000-0000-0000-00000000e003'::uuid,'zzz.com.newdev@s.test'),
  ('c4000000-0000-0000-0000-00000000e004'::uuid,'zzz.com.bysup@s.test'),
  ('c4000000-0000-0000-0000-00000000e005'::uuid,'zzz.com.agmgr@a.test'),
  ('c4000000-0000-0000-0000-00000000e006'::uuid,'zzz.com.agdir@a.test')
) as v(id, email);

-- ===========================================================================
-- 1. THE DEFECT ITSELF: Management, invited with the flag OFF
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"c4000000-0000-0000-0000-0000000000d1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.create_invited_user(
      'c4000000-0000-0000-0000-00000000e001'::uuid, 'zzz.com.newmgmt@s.test',
      'ZZZ New Management', 'management',
      'c4000000-0000-0000-0000-0000000000a1'::uuid, null, false, null, null)$$,
  'a supplier''s Management can be invited with the flag off');

select is(
  (select sees_commission from public.users where id = 'c4000000-0000-0000-0000-00000000e001'),
  true,
  'and lands seeing commission anyway, because Management IS the top of that rail');

-- ===========================================================================
-- 2. THE OTHER TWO SUPPLIER LEVELS ARE UNCHANGED
-- ===========================================================================
select lives_ok(
  $$select public.create_invited_user(
      'c4000000-0000-0000-0000-00000000e002'::uuid, 'zzz.com.newref@s.test',
      'ZZZ New Referrer', 'referrer',
      'c4000000-0000-0000-0000-0000000000a1'::uuid, null, true, null, null)$$,
  'a supplier''s Referrer can be invited');

-- Asked with the flag ON, which is the sharper test: the role arm has always
-- cleared it, and that arm must survive the supplier arm being added beside it.
select is(
  (select sees_commission from public.users where id = 'c4000000-0000-0000-0000-00000000e002'),
  false,
  'and a Referrer does not see commission even when asked for with the flag on');

select lives_ok(
  $$select public.create_invited_user(
      'c4000000-0000-0000-0000-00000000e003'::uuid, 'zzz.com.newdev@s.test',
      'ZZZ New Developer', 'developer',
      'c4000000-0000-0000-0000-0000000000a1'::uuid, null, true, null, null)$$,
  'a supplier''s Developer can be invited');

-- Matt's own description of the level: "Developer: uses the Dev Centre and
-- API; no commission."
select is(
  (select sees_commission from public.users where id = 'c4000000-0000-0000-0000-00000000e003'),
  false,
  'and a Developer sees no commission');

-- ===========================================================================
-- 3. THROUGH THE DOOR MATT USED: the supplier's own Management inviting
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"c4000000-0000-0000-0000-0000000000d2","role":"authenticated","aal":"aal2"}', true);

select lives_ok(
  $$select public.create_invited_user(
      'c4000000-0000-0000-0000-00000000e004'::uuid, 'zzz.com.bysup@s.test',
      'ZZZ Invited By Supplier', 'management',
      'c4000000-0000-0000-0000-0000000000a1'::uuid, null, false, null, null)$$,
  'a supplier''s own Management can invite a colleague at Management');

select is(
  (select sees_commission from public.users where id = 'c4000000-0000-0000-0000-00000000e004'),
  true,
  'and that colleague sees commission, which is the reported defect');

-- ===========================================================================
-- 4. AND NOT ONE INCH OF THE AGENCY LADDER
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"c4000000-0000-0000-0000-0000000000d1","role":"authenticated","aal":"aal2"}', true);

/* A MANAGER IS STILL A MANAGER. The same call, the same flag, the other rail:
   this is the assertion that would fail if the force had been written on the
   role instead of on the partner's kind, and it would have promoted every
   Manager in the product. */
select lives_ok(
  $$select public.create_invited_user(
      'c4000000-0000-0000-0000-00000000e005'::uuid, 'zzz.com.agmgr@a.test',
      'ZZZ Agency Manager', 'management',
      'c4000000-0000-0000-0000-0000000000a2'::uuid, null, false, null, null)$$,
  'an agency''s management can be invited with the flag off');

select is(
  (select sees_commission from public.users where id = 'c4000000-0000-0000-0000-00000000e005'),
  false,
  'and stays a MANAGER, because on the agency rail the flag is the level');

-- And the other half of that ladder still works, so the arm reads the caller.
select lives_ok(
  $$select public.create_invited_user(
      'c4000000-0000-0000-0000-00000000e006'::uuid, 'zzz.com.agdir@a.test',
      'ZZZ Agency Director', 'management',
      'c4000000-0000-0000-0000-0000000000a2'::uuid, null, true, null, null)$$,
  'an agency''s Director can be invited');

select is(
  (select sees_commission from public.users where id = 'c4000000-0000-0000-0000-00000000e006'),
  true,
  'and is a Director, which is the flag doing its job on that rail');

reset role;

-- ===========================================================================
-- 5. NO SUPPLIER MANAGEMENT IS LEFT BLIND, which is what the backfill was for
-- ===========================================================================
select is(
  (select count(*) from public.users u
     join public.partners p on p.id = u.partner_id
    where p.partner_kind = 'supplier' and u.role = 'management'
      and coalesce(u.sees_commission, false) = false),
  0::bigint,
  'and no supplier Management anywhere is left without commission');

select finish();
rollback;
