-- A CLIMBER IS RANKED FOR THE READER, NOT FOR THE PARTNER.
--
-- Q-10. `partner_weekly_climbers` ranked referrers within a PARTNER. Every
-- agency Opndoor onboards shares the house partner `opndoor-agents`, so on
-- the agency rail that put Regent's negotiators in one table with Northgate's,
-- picked the single biggest riser across all of them, and named that person in
-- the digest sent to every one of those agencies. The weekly email told an
-- agency that the person of the week worked at a competitor.
--
-- It was withdrawn rather than rescoped, and `agency_weekly_climber`
-- (20261006370000, leavers clause added by 20261006410000) is the twin that
-- brings the line back. This is the test it was missing.
--
-- THE PARTITION IS THE READER, WHICH IS THE PART WORTH PINNING. Not the
-- agency: a group director over two agencies should see the best riser across
-- the two they hold, not two winners and not one agency's. So the same
-- function, asked by two different people about the same week, must return
-- two different correct answers. That is assertions 1 and 4 below, and no
-- single-agency implementation can pass both.
--
-- THE FIXTURE, and why each person is in it.
--
--   agency A1, in group G1      Zoe   rises  (prev 0,    curr 1000)
--                               Yan   falls  (prev 2000, curr 0)
--                                       + a REFUNDED 10000 this week
--                               Aaron rises biggest, but has LEFT (9000)
--   agency A2, in group G1      Xena  rises  (prev 0,    curr 5000)
--                               Wes   falls  (prev 4000, curr 0)
--   agency A3, no group         Uma and Vic, both flat: nobody moved
--
-- Names are deliberately chosen so the tie-breaks are decidable by reading:
-- ranking is `fees desc, full_name asc`, and both the leaver trap and the
-- group answer turn on a tie broken by name.
--
--   For A1 alone      prev: Yan 1, Zoe 2      curr: Zoe 1, Yan 2
--                     Zoe +1, Yan -1                      -> Zoe, delta 1
--   For A1+A2         prev: Wes 1, Yan 2, Xena 3, Zoe 4
--                     curr: Xena 1, Zoe 2, Wes 3, Yan 4
--                     Xena +2, Zoe +2, both fallers -2
--                     tie on delta, "Xena" < "Zoe"        -> Xena, delta 2
--
-- Each wrong implementation fails a specific assertion:
--   rank per partner instead of per reader  -> 1 returns Xena, a competitor
--   drop the `u.status = 'active'` clause   -> Aaron ties Zoe on delta 1 and
--                                              wins the name tie, so 1 and 3
--                                              return a person who has left
--   count refunds as fees                   -> Yan holds rank 1 both weeks,
--                                              nobody rises, 1 returns nothing
--   collapse a group to one agency          -> 4 returns Zoe, not Xena
--   treat a branch position as one branch   -> 6 returns nothing
--   return a faller when nobody rose        -> 8 returns a name
--
-- Runs as postgres throughout: every assertion is about the VALUE a
-- security-definer function returns, not about a policy or a grant, so there
-- is nothing here that `set local role authenticated` would exercise.
-- testsRunAsTheirRole only flags assertions expecting 42501, and there are
-- none.

begin;
select plan(9);

-- ===========================================================================
-- THE ESTATE
-- ===========================================================================
insert into public.agency_groups (id, partner_id, name)
values ('93000000-0000-0000-0000-00000000f0f1'::uuid,
        (select id from public.partners where slug = 'opndoor-agents'),
        'ZZZ Climber Group');

insert into public.agencies (id, partner_id, group_id, name) values
  ('93000000-0000-0000-0000-0000000000a1',
   (select id from public.partners where slug = 'opndoor-agents'),
   '93000000-0000-0000-0000-00000000f0f1', 'ZZZ Climber Agency One'),
  ('93000000-0000-0000-0000-0000000000a2',
   (select id from public.partners where slug = 'opndoor-agents'),
   '93000000-0000-0000-0000-00000000f0f1', 'ZZZ Climber Agency Two'),
  -- Outside the group on purpose: it must not join the group reader's
  -- population, and it is where "nobody rose" is asserted.
  ('93000000-0000-0000-0000-0000000000a3',
   (select id from public.partners where slug = 'opndoor-agents'),
   null, 'ZZZ Climber Agency Three');

insert into public.branches (id, agency_id, partner_id, name) values
  ('93000000-0000-0000-0000-0000000000b1','93000000-0000-0000-0000-0000000000a1',
   (select id from public.partners where slug = 'opndoor-agents'),'ZZZ Climber Office One'),
  ('93000000-0000-0000-0000-0000000000b2','93000000-0000-0000-0000-0000000000a2',
   (select id from public.partners where slug = 'opndoor-agents'),'ZZZ Climber Office Two'),
  ('93000000-0000-0000-0000-0000000000b3','93000000-0000-0000-0000-0000000000a3',
   (select id from public.partners where slug = 'opndoor-agents'),'ZZZ Climber Office Three');

-- ===========================================================================
-- THE PEOPLE. Five referrers whose weeks are the subject, four readers who
-- ask the question from four different positions.
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('93000000-0000-0000-0000-00000000c001'::uuid,'zzz.climb.zoe@r.test'),
  ('93000000-0000-0000-0000-00000000c002'::uuid,'zzz.climb.yan@r.test'),
  ('93000000-0000-0000-0000-00000000c003'::uuid,'zzz.climb.aaron@r.test'),
  ('93000000-0000-0000-0000-00000000c004'::uuid,'zzz.climb.xena@r.test'),
  ('93000000-0000-0000-0000-00000000c005'::uuid,'zzz.climb.wes@r.test'),
  ('93000000-0000-0000-0000-00000000c006'::uuid,'zzz.climb.uma@r.test'),
  ('93000000-0000-0000-0000-00000000c007'::uuid,'zzz.climb.vic@r.test'),
  ('93000000-0000-0000-0000-00000000d001'::uuid,'zzz.climb.reader.agency@r.test'),
  ('93000000-0000-0000-0000-00000000d002'::uuid,'zzz.climb.reader.group@r.test'),
  ('93000000-0000-0000-0000-00000000d003'::uuid,'zzz.climb.reader.branch@r.test'),
  ('93000000-0000-0000-0000-00000000d004'::uuid,'zzz.climb.reader.none@r.test'),
  ('93000000-0000-0000-0000-00000000d005'::uuid,'zzz.climb.reader.three@r.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status,
                          sees_commission, home_branch_id)
select x.id, x.nm, x.em, x.rl,
       (select id from public.partners where slug = 'opndoor-agents'),
       x.st, x.sc, null
from (values
  -- THE NAMES CARRY THE TIE-BREAKS. "Aaron" sorts before "Zoe", which is why
  -- the leaver would win if the status clause were dropped; "Xena" sorts
  -- before "Zoe", which is why the group answer is Xena.
  ('93000000-0000-0000-0000-00000000c001'::uuid,'Zoe Climber A1',  'zzz.climb.zoe@r.test',   'referrer',  'active',      false),
  ('93000000-0000-0000-0000-00000000c002'::uuid,'Yan Faller A1',   'zzz.climb.yan@r.test',   'referrer',  'active',      false),
  ('93000000-0000-0000-0000-00000000c003'::uuid,'Aaron Left A1',   'zzz.climb.aaron@r.test', 'referrer',  'deactivated', false),
  ('93000000-0000-0000-0000-00000000c004'::uuid,'Xena Climber A2', 'zzz.climb.xena@r.test',  'referrer',  'active',      false),
  ('93000000-0000-0000-0000-00000000c005'::uuid,'Wes Faller A2',   'zzz.climb.wes@r.test',   'referrer',  'active',      false),
  ('93000000-0000-0000-0000-00000000c006'::uuid,'Uma Flat A3',     'zzz.climb.uma@r.test',   'referrer',  'active',      false),
  ('93000000-0000-0000-0000-00000000c007'::uuid,'Vic Flat A3',     'zzz.climb.vic@r.test',   'referrer',  'active',      false),
  ('93000000-0000-0000-0000-00000000d001'::uuid,'ZZZ Reader Agency','zzz.climb.reader.agency@r.test','management','active', true),
  ('93000000-0000-0000-0000-00000000d002'::uuid,'ZZZ Reader Group', 'zzz.climb.reader.group@r.test', 'management','active', true),
  ('93000000-0000-0000-0000-00000000d003'::uuid,'ZZZ Reader Branch','zzz.climb.reader.branch@r.test','management','active', false),
  ('93000000-0000-0000-0000-00000000d004'::uuid,'ZZZ Reader None',  'zzz.climb.reader.none@r.test',  'management','active', false),
  ('93000000-0000-0000-0000-00000000d005'::uuid,'ZZZ Reader Three', 'zzz.climb.reader.three@r.test', 'management','active', false)
) as x(id,nm,em,rl,st,sc);

insert into public.user_scopes (user_id, kind, group_id, agency_id, branch_id) values
  ('93000000-0000-0000-0000-00000000c001','branch',null,null,'93000000-0000-0000-0000-0000000000b1'),
  ('93000000-0000-0000-0000-00000000c002','branch',null,null,'93000000-0000-0000-0000-0000000000b1'),
  ('93000000-0000-0000-0000-00000000c003','branch',null,null,'93000000-0000-0000-0000-0000000000b1'),
  ('93000000-0000-0000-0000-00000000c004','branch',null,null,'93000000-0000-0000-0000-0000000000b2'),
  ('93000000-0000-0000-0000-00000000c005','branch',null,null,'93000000-0000-0000-0000-0000000000b2'),
  ('93000000-0000-0000-0000-00000000c006','branch',null,null,'93000000-0000-0000-0000-0000000000b3'),
  ('93000000-0000-0000-0000-00000000c007','branch',null,null,'93000000-0000-0000-0000-0000000000b3'),
  -- The four readers, at four different heights on the same estate.
  ('93000000-0000-0000-0000-00000000d001','agency',null,'93000000-0000-0000-0000-0000000000a1',null),
  ('93000000-0000-0000-0000-00000000d002','group','93000000-0000-0000-0000-00000000f0f1',null,null),
  ('93000000-0000-0000-0000-00000000d003','branch',null,null,'93000000-0000-0000-0000-0000000000b1'),
  ('93000000-0000-0000-0000-00000000d005','agency',null,'93000000-0000-0000-0000-0000000000a3',null);
-- d004 deliberately holds NO position: a reader who covers nothing.

-- ===========================================================================
-- THE TWO WEEKS
-- ===========================================================================
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at, paid_at, payment_state)
select
  x.id, x.ref,
  (select id from public.partners where slug = 'opndoor-agents'),
  x.agency, x.branch, x.referrer, x.rname,
  'Mx', x.fname, 'Tenant', '1990-01-01', x.temail, '07700900000',
  '1 Climber Street', 'London', 'CL1 1AA',
  x.rent, current_date + 30, 'paid', true,
  0.25, 0.10, 'opndoor_referenced',
  x.whenpaid, x.whenpaid, x.pstate
from (values
  -- THIS WEEK (paid 2 days ago)
  ('93000000-0000-0000-0000-00000000e001'::uuid,'ZZZ-CLB-01','93000000-0000-0000-0000-0000000000a1'::uuid,'93000000-0000-0000-0000-0000000000b1'::uuid,'93000000-0000-0000-0000-00000000c001'::uuid,'Zoe Climber A1','Zoe','zzz.t01@r.test',1000::numeric, now() - interval '2 days', null::text),
  -- Yan's only money this week is REFUNDED, so it must not count. If it did,
  -- Yan holds rank 1 both weeks and nobody in A1 rises at all.
  ('93000000-0000-0000-0000-00000000e002'::uuid,'ZZZ-CLB-02','93000000-0000-0000-0000-0000000000a1'::uuid,'93000000-0000-0000-0000-0000000000b1'::uuid,'93000000-0000-0000-0000-00000000c002'::uuid,'Yan Faller A1','Yan','zzz.t02@r.test',10000::numeric, now() - interval '2 days', 'refunded'::text),
  -- The biggest rise of the week belongs to somebody who has left.
  ('93000000-0000-0000-0000-00000000e003'::uuid,'ZZZ-CLB-03','93000000-0000-0000-0000-0000000000a1'::uuid,'93000000-0000-0000-0000-0000000000b1'::uuid,'93000000-0000-0000-0000-00000000c003'::uuid,'Aaron Left A1','Aaron','zzz.t03@r.test',9000::numeric, now() - interval '2 days', null::text),
  ('93000000-0000-0000-0000-00000000e004'::uuid,'ZZZ-CLB-04','93000000-0000-0000-0000-0000000000a2'::uuid,'93000000-0000-0000-0000-0000000000b2'::uuid,'93000000-0000-0000-0000-00000000c004'::uuid,'Xena Climber A2','Xena','zzz.t04@r.test',5000::numeric, now() - interval '2 days', null::text),
  -- LAST WEEK (paid 10 days ago)
  ('93000000-0000-0000-0000-00000000e005'::uuid,'ZZZ-CLB-05','93000000-0000-0000-0000-0000000000a1'::uuid,'93000000-0000-0000-0000-0000000000b1'::uuid,'93000000-0000-0000-0000-00000000c002'::uuid,'Yan Faller A1','Yanprev','zzz.t05@r.test',2000::numeric, now() - interval '10 days', null::text),
  ('93000000-0000-0000-0000-00000000e006'::uuid,'ZZZ-CLB-06','93000000-0000-0000-0000-0000000000a2'::uuid,'93000000-0000-0000-0000-0000000000b2'::uuid,'93000000-0000-0000-0000-00000000c005'::uuid,'Wes Faller A2','Wesprev','zzz.t06@r.test',4000::numeric, now() - interval '10 days', null::text),
  -- AGENCY THREE: both weeks identical, so the order never changes.
  ('93000000-0000-0000-0000-00000000e007'::uuid,'ZZZ-CLB-07','93000000-0000-0000-0000-0000000000a3'::uuid,'93000000-0000-0000-0000-0000000000b3'::uuid,'93000000-0000-0000-0000-00000000c006'::uuid,'Uma Flat A3','Umaa','zzz.t07@r.test',3000::numeric, now() - interval '2 days', null::text),
  ('93000000-0000-0000-0000-00000000e008'::uuid,'ZZZ-CLB-08','93000000-0000-0000-0000-0000000000a3'::uuid,'93000000-0000-0000-0000-0000000000b3'::uuid,'93000000-0000-0000-0000-00000000c006'::uuid,'Uma Flat A3','Umab','zzz.t08@r.test',3000::numeric, now() - interval '10 days', null::text),
  ('93000000-0000-0000-0000-00000000e009'::uuid,'ZZZ-CLB-09','93000000-0000-0000-0000-0000000000a3'::uuid,'93000000-0000-0000-0000-0000000000b3'::uuid,'93000000-0000-0000-0000-00000000c007'::uuid,'Vic Flat A3','Vica','zzz.t09@r.test',1000::numeric, now() - interval '2 days', null::text),
  ('93000000-0000-0000-0000-00000000e010'::uuid,'ZZZ-CLB-10','93000000-0000-0000-0000-0000000000a3'::uuid,'93000000-0000-0000-0000-0000000000b3'::uuid,'93000000-0000-0000-0000-00000000c007'::uuid,'Vic Flat A3','Vicb','zzz.t10@r.test',1000::numeric, now() - interval '10 days', null::text)
) as x(id,ref,agency,branch,referrer,rname,fname,temail,rent,whenpaid,pstate);

-- ===========================================================================
-- 1 and 2. THE READER'S OWN AGENCY. Xena rose further than Zoe, and Aaron
-- further still, but neither is this reader's business: one works at another
-- agency, the other has left.
-- ===========================================================================
select is(
  (select climber_name from public.agency_weekly_climber(
     '93000000-0000-0000-0000-00000000d001', now() - interval '7 days', now(), now() - interval '14 days', now() - interval '7 days')),
  'Zoe Climber A1',
  'an agency reader is told about the best riser in their OWN agency');

select is(
  (select climber_delta from public.agency_weekly_climber(
     '93000000-0000-0000-0000-00000000d001', now() - interval '7 days', now(), now() - interval '14 days', now() - interval '7 days')),
  1,
  'and the delta is the places moved inside that agency, not across the partner');

-- ===========================================================================
-- 3. THE LEAVER. Aaron has the biggest rise in A1 and sorts first on the
-- name tie-break, so he wins the moment the status clause is dropped.
-- ===========================================================================
select isnt(
  (select climber_name from public.agency_weekly_climber(
     '93000000-0000-0000-0000-00000000d001', now() - interval '7 days', now(), now() - interval '14 days', now() - interval '7 days')),
  'Aaron Left A1',
  'somebody who has left is never the climber, however far they rose');

-- ===========================================================================
-- 4 and 5. THE GROUP READER. Same week, same function, different answer:
-- across the two agencies this reader holds, Xena is the bigger riser.
-- ===========================================================================
select is(
  (select climber_name from public.agency_weekly_climber(
     '93000000-0000-0000-0000-00000000d002', now() - interval '7 days', now(), now() - interval '14 days', now() - interval '7 days')),
  'Xena Climber A2',
  'a group reader is told about the best riser across the agencies they hold');

select is(
  (select climber_delta from public.agency_weekly_climber(
     '93000000-0000-0000-0000-00000000d002', now() - interval '7 days', now(), now() - interval '14 days', now() - interval '7 days')),
  2,
  'and the ranking is recomputed over the whole group, so the delta is larger');

-- ===========================================================================
-- 6. A BRANCH POSITION REACHES ITS AGENCY. The reader holds one branch; the
-- population is the agency that branch belongs to, which is how the rest of
-- the digest already resolves a branch position.
-- ===========================================================================
select is(
  (select climber_name from public.agency_weekly_climber(
     '93000000-0000-0000-0000-00000000d003', now() - interval '7 days', now(), now() - interval '14 days', now() - interval '7 days')),
  'Zoe Climber A1',
  'a branch reader gets their agency''s climber, not an empty answer');

-- ===========================================================================
-- 7. A READER WHO COVERS NOTHING IS TOLD NOTHING, rather than being given the
-- estate's climber by default.
-- ===========================================================================
select is_empty(
  $$ select climber_name from public.agency_weekly_climber(
       '93000000-0000-0000-0000-00000000d004',
       now() - interval '7 days', now(), now() - interval '14 days', now() - interval '7 days') $$,
  'a reader with no position is told about nobody');

-- ===========================================================================
-- 8. NOBODY ROSE, SO NOBODY IS NAMED. Agency three's two referrers earned
-- exactly the same in both weeks, so the order never changed. The digest must
-- render no line rather than crown whoever happens to be top.
-- ===========================================================================
select is_empty(
  $$ select climber_name from public.agency_weekly_climber(
       '93000000-0000-0000-0000-00000000d005',
       now() - interval '7 days', now(), now() - interval '14 days', now() - interval '7 days') $$,
  'when nobody improved their place, there is no climber of the week');

-- ===========================================================================
-- 9. ONE NAME. The digest has room for one line, and the function is the only
-- thing deciding which; a second row would be silently dropped by whichever
-- caller read it first.
-- ===========================================================================
select is(
  (select count(*) from public.agency_weekly_climber(
     '93000000-0000-0000-0000-00000000d002', now() - interval '7 days', now(), now() - interval '14 days', now() - interval '7 days')),
  1::bigint,
  'and it answers with exactly one name, never a list');

select * from finish();
rollback;
