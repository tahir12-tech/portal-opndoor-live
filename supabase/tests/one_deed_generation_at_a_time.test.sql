-- TWO PRESSES OF GENERATE MAKE ONE DEED.
--
-- The document-exists check inside generateDeed closes the SEQUENTIAL double
-- press: the second press finds a stamped id and refuses. It cannot close the
-- CONCURRENT one, because both presses read "no document" before either has
-- created one, and creating a document at PandaDoc takes seconds. That is the
-- window a person double-clicking occupies, and the old outcome was two live
-- signable Deeds of Guarantee for one application, the second stamped over the
-- first, the first left live in PandaDoc with nothing pointing at it.
--
-- What is asserted here is the half that lives in the database: the lease. The
-- PandaDoc calls cannot run from a test, so the race is exercised where it is
-- decided, at take_deed_lease, which is taken in ONE conditional UPDATE precisely
-- so two concurrent callers cannot both see it free.
--
-- AND IT IS A LEASE, NOT A LOCK. A lock held by a crashed or timed-out run never
-- releases and the application can never generate again, which is the dead end
-- 20261005260000 exists to undo. The stale-takeover assertions are the ones that
-- keep this fix from becoming that bug.
--
-- WHAT THIS FILE CANNOT ASSERT, said plainly. Every statement here runs in ONE
-- transaction, so the two callers below are sequential: they prove the refusal
-- RULE, not that the read and the write cannot be interleaved. Atomicity comes
-- from take_deed_lease being a single conditional UPDATE, and was proved
-- separately against dev by firing six simultaneous take_deed_lease calls from
-- six separate sessions at one application: exactly one returned true and five
-- returned false. Reproduce with, from six shells at once:
--   select public.take_deed_lease('<application uuid>');

begin;
select plan(13);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, refers_own_stock, partner_kind)
values ('8b000000-0000-0000-0000-000000000001', 'zzz-lease', 'ZZZ Lease Estate', 'opndoor_referenced', 0.25, 0.10, true, true, 'agency');
insert into public.agencies (id, partner_id, name)
values ('8b000000-0000-0000-0000-00000000000a', '8b000000-0000-0000-0000-000000000001', 'ZZZ Lease Lettings');
insert into public.branches (id, agency_id, partner_id, name)
values ('8b000000-0000-0000-0000-0000000000a1', '8b000000-0000-0000-0000-00000000000a', '8b000000-0000-0000-0000-000000000001', 'Lease Park');

-- Two paid applications: the second proves a lease is per application, not global.
insert into public.applications (
  id, guarantee_ref, branch_id, agency_id, partner_id,
  tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
  prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start,
  status, sent_at, paid_at, livemode, referencing_mode, partner_rate, agent_rate
) values
  ('8b000000-0000-0000-0000-0000000000c1', 'GR-LEASE-1',
   '8b000000-0000-0000-0000-0000000000a1', '8b000000-0000-0000-0000-00000000000a', '8b000000-0000-0000-0000-000000000001',
   'Mr', 'Lee', 'Sea', '1990-01-01', 'lee@zzzlease.test', '07700 900800',
   '1 Lease Road', 'London', 'NW1 1LS', 1000, 692.31, current_date + 30,
   'paid', now() - interval '2 days', now() - interval '1 day', true, 'pre_referenced_open', 0.25, 0.10),
  ('8b000000-0000-0000-0000-0000000000c2', 'GR-LEASE-2',
   '8b000000-0000-0000-0000-0000000000a1', '8b000000-0000-0000-0000-00000000000a', '8b000000-0000-0000-0000-000000000001',
   'Ms', 'Ada', 'Bee', '1990-01-01', 'ada@zzzlease.test', '07700 900801',
   '2 Lease Road', 'London', 'NW1 1LS', 1000, 692.31, current_date + 30,
   'paid', now() - interval '2 days', now() - interval '1 day', true, 'pre_referenced_open', 0.25, 0.10);

-- ---------------------------------------------------------------------------
-- FREE, TAKEN, AND REFUSED TO THE SECOND CALLER.
-- ---------------------------------------------------------------------------
select is((select deed_generating_since from public.applications
            where id = '8b000000-0000-0000-0000-0000000000c1'), null,
  'an application that has never generated holds no lease');

select ok(public.take_deed_lease('8b000000-0000-0000-0000-0000000000c1'),
  'the first caller takes the lease');

select isnt((select deed_generating_since from public.applications
              where id = '8b000000-0000-0000-0000-0000000000c1'), null,
  'and the row records when, so a crashed run can be timed out');

-- THE ASSERTION THE WHOLE FIX TURNS ON. This is the second press of Generate,
-- arriving while the first is still talking to PandaDoc.
select ok(not public.take_deed_lease('8b000000-0000-0000-0000-0000000000c1'),
  'the second caller is refused, which is the one document guarantee');

select ok(not public.take_deed_lease('8b000000-0000-0000-0000-0000000000c1'),
  'and so is the third, because refusal is not a one-off');

-- ---------------------------------------------------------------------------
-- A LEASE IS PER APPLICATION. A global lock would serialise every deed on the
-- platform behind the slowest PandaDoc call.
-- ---------------------------------------------------------------------------
select ok(public.take_deed_lease('8b000000-0000-0000-0000-0000000000c2'),
  'another application generates at the same time, unaffected');
select public.release_deed_lease('8b000000-0000-0000-0000-0000000000c2');

-- ---------------------------------------------------------------------------
-- RELEASE, AND THE RETRY THAT DEPENDS ON IT. A failure is retried
-- (20261005260000), so the failing run must hand the lease back or the retry
-- waits out the stale window for nothing.
-- ---------------------------------------------------------------------------
select public.release_deed_lease('8b000000-0000-0000-0000-0000000000c1');
select is((select deed_generating_since from public.applications
            where id = '8b000000-0000-0000-0000-0000000000c1'), null,
  'releasing clears the lease');

select ok(public.take_deed_lease('8b000000-0000-0000-0000-0000000000c1'),
  'and the next pass can take it immediately, which is what makes a retry work');

-- ---------------------------------------------------------------------------
-- THE STALE TAKEOVER: what stops this fix becoming the dead end it replaced.
-- An edge function that times out or dies never reaches its release.
-- ---------------------------------------------------------------------------
select ok(not public.take_deed_lease('8b000000-0000-0000-0000-0000000000c1'),
  'a lease taken one second ago is honoured');

-- Age it past the window, which is what a crashed run looks like an hour later.
update public.applications set deed_generating_since = now() - interval '1 hour'
 where id = '8b000000-0000-0000-0000-0000000000c1';

select ok(public.take_deed_lease('8b000000-0000-0000-0000-0000000000c1'),
  'a lease older than the stale window is taken over, so a crash is not permanent');

-- And the takeover re-stamps the clock rather than inheriting the old one, or the
-- second caller would immediately be stale too and the mutex would be worthless.
select ok((select deed_generating_since from public.applications
            where id = '8b000000-0000-0000-0000-0000000000c1') > now() - interval '1 minute',
  'and the takeover resets the clock, so it is a fresh lease and not an expired one');

-- The window is a parameter, so a caller that knows its own timeout can say so.
update public.applications set deed_generating_since = now() - interval '30 seconds'
 where id = '8b000000-0000-0000-0000-0000000000c1';
select ok(not public.take_deed_lease('8b000000-0000-0000-0000-0000000000c1', interval '5 minutes'),
  '30 seconds is not stale against a five minute window');
select ok(public.take_deed_lease('8b000000-0000-0000-0000-0000000000c1', interval '10 seconds'),
  'but it is against a ten second one');

select * from finish();
rollback;
