-- EACH TENANT SIGNS THEIR OWN DEED, AND THE JOURNEY RUNS FORWARDS.
--
-- Two rulings, one fixture, because they meet on the same rows: a joint tenancy
-- whose tenants pay at different times is exactly where a per-tenant deed gate
-- and a timestamp ordering rule both have to hold at once.
--
-- The assertion that matters most to the underwriter is the last one in the
-- first block: a tenancy's per-deed premiums must sum to what its single
-- pre-ruling row was billed, to the penny. If that ever fails we are either
-- over-billing or under-declaring, and neither is recoverable by apology.

begin;
select plan(19);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route)
values ('96000000-0000-0000-0000-000000000001', 'zzz-deed-estate', 'Deed Estate', 'opndoor_referenced', 0.25, 0.10, true);
insert into public.agencies (id, partner_id, name)
values ('96000000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000001', 'Deed Lettings');
insert into public.branches (id, agency_id, partner_id, name)
values ('96000000-0000-0000-0000-000000000003', '96000000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000001', 'Deed Branch');

insert into public.tenancies (id, monthly_rent, tenancy_start, prop_addr1, prop_city, prop_postcode)
values ('96000000-0000-0000-0000-00000000000f', 1750, current_date + 30, '9 Drift Road', 'London', 'NW1 9ZZ');

-- A THREE-WAY TENANCY ON £1,750, the case that used to drift. The shares are
-- what public.apportion produces, which is what create_joint_referral now writes.
insert into public.applications (
  id, guarantee_ref, branch_id, agency_id, partner_id,
  tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
  prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, sent_at,
  partner_rate, agent_rate, livemode, fee_amount, tenancy_id, tenancy_position,
  share_percent, share_amount, paid_at, referencing_mode
) values
  ('96000000-0000-0000-0000-000000000011', 'GR-ZZD-1', '96000000-0000-0000-0000-000000000003', '96000000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000001',
   'Mr','Ann','Three','1990-01-01','zzd1@example.test','07700900501','9 Drift Road','London','NW1 9ZZ',1750, current_date + 30, 'paid', now() - interval '3 days',
   0.25, 0.20, true, 673.08, '96000000-0000-0000-0000-00000000000f', 1, 33.34, 583.45, now() - interval '2 days', 'pre_referenced_open'),
  ('96000000-0000-0000-0000-000000000012', 'GR-ZZD-2', '96000000-0000-0000-0000-000000000003', '96000000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000001',
   'Ms','Bea','Three','1991-01-01','zzd2@example.test','07700900502','9 Drift Road','London','NW1 9ZZ',1750, current_date + 30, 'paid', now() - interval '3 days',
   0.25, 0.20, true, 673.08, '96000000-0000-0000-0000-00000000000f', 2, 33.33, 583.28, now() - interval '1 days', 'pre_referenced_open'),
  -- The third has NOT paid.
  ('96000000-0000-0000-0000-000000000013', 'GR-ZZD-3', '96000000-0000-0000-0000-000000000003', '96000000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000001',
   'Mx','Cai','Three','1992-01-01','zzd3@example.test','07700900503','9 Drift Road','London','NW1 9ZZ',1750, current_date + 30, 'sent', now() - interval '3 days',
   0.25, 0.20, true, 673.07, '96000000-0000-0000-0000-00000000000f', 3, 33.33, 583.27, null, 'pre_referenced_open'),
  -- AND A TENANCY OF ONE, which must be untouched by all of it.
  ('96000000-0000-0000-0000-000000000021', 'GR-ZZD-S', '96000000-0000-0000-0000-000000000003', '96000000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000001',
   'Mr','Solo','Alone','1988-01-01','zzds@example.test','07700900504','1 Alone Street','London','NW1 1AA',2000, current_date + 30, 'paid', now() - interval '3 days',
   0.25, 0.20, true, 2000, null, null, null, null, now() - interval '2 days', 'pre_referenced_open');

-- ---------------------------------------------------------------------------
-- EACH TENANT'S OWN GATE.
-- ---------------------------------------------------------------------------
select ok((select ready from public.deed_target('96000000-0000-0000-0000-000000000011')),
  'a tenant who has paid is ready for their own deed');
select ok((select ready from public.deed_target('96000000-0000-0000-0000-000000000012')),
  'and so is the second, without waiting for the third');
select ok(not (select ready from public.deed_target('96000000-0000-0000-0000-000000000013')),
  'a tenant who has not paid is not ready, and holds nobody else up');

-- This is the ruling that changed. Under the firing-unit rule the answer for
-- every one of these was "no", because one tenant had not paid.
select is((select unpaid_count from public.deed_target('96000000-0000-0000-0000-000000000011')), 1,
  'the tenancy still knows one tenant is outstanding, for the screen to say so');

-- ---------------------------------------------------------------------------
-- WHAT THE DOCUMENT SAYS.
-- ---------------------------------------------------------------------------
select is((select share_amount from public.deed_target('96000000-0000-0000-0000-000000000011')), 583.45::numeric,
  'a deed covers that tenant''s own share of the rent');
select is((select co_tenant_names from public.deed_target('96000000-0000-0000-0000-000000000011')),
  'Bea Three, Cai Three', 'and names the other tenants, in tenancy order');
select is((select tenant_names from public.deed_target('96000000-0000-0000-0000-000000000011')),
  'Ann Three, Bea Three, Cai Three', 'and names everybody, so it says what tenancy it belongs to');
select is((select tenant_count from public.deed_target('96000000-0000-0000-0000-000000000011')), 3,
  'and knows how many it is one of');

-- ---------------------------------------------------------------------------
-- A TENANCY OF ONE IS BYTE-IDENTICAL.
--
-- co_tenant_names null is what omits BOTH new merge tokens in pandadoc.ts, so
-- the token list for a solo deed is character-for-character the six it always
-- was. These four assertions are that guarantee.
-- ---------------------------------------------------------------------------
select is((select co_tenant_names from public.deed_target('96000000-0000-0000-0000-000000000021')), null,
  'a solo deed has no co-tenants, which is what drops the two joint-only tokens');
select is((select tenant_names from public.deed_target('96000000-0000-0000-0000-000000000021')), null,
  'and no tenancy name list, so tenant_name falls back to the applicant as before');
select is((select share_amount from public.deed_target('96000000-0000-0000-0000-000000000021')), 2000::numeric,
  'and covers the whole rent, because the whole rent is theirs');
select is((select tenant_count from public.deed_target('96000000-0000-0000-0000-000000000021')), 1,
  'a tenancy of one counts as one, not as zero');

-- ---------------------------------------------------------------------------
-- THE UNDERWRITER IS BILLED THE SAME MONEY.
-- ---------------------------------------------------------------------------
select is((select sum(share_amount) from public.applications
            where tenancy_id = '96000000-0000-0000-0000-00000000000f'),
  1750.00::numeric, 'the shares of rent sum to the rent exactly, with no rounding dust');
select is((select round(sum(share_amount) * 0.135, 2) from public.applications
            where tenancy_id = '96000000-0000-0000-0000-00000000000f'),
  round(1750 * 0.135, 2)::numeric,
  'so the per-deed premiums sum to 13.5% of one month of the FULL rent');

-- ---------------------------------------------------------------------------
-- THE JOURNEY RUNS FORWARDS.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.applications set paid_at = sent_at - interval '1 day'
     where id = '96000000-0000-0000-0000-000000000011'$$,
  '23514', null,
  'a payment before the referral was sent is refused');

select lives_ok(
  $$update public.applications set paid_at = sent_at
     where id = '96000000-0000-0000-0000-000000000011'$$,
  'but an equal timestamp is fine: several writers stamp two of these at once');

select throws_ok(
  $$update public.applications set refunded_at = paid_at - interval '1 day'
     where id = '96000000-0000-0000-0000-000000000012'$$,
  '23514', null,
  'a refund before the payment it reverses is refused');

-- CROSS-CLOCK PAIRS ARE FLAGGED, NOT REFUSED: deed_sent_at comes from the Deno
-- runtime and the rest from Postgres, so an inversion can be millisecond skew
-- rather than a fault, and losing a PandaDoc webhook over it would be worse.
select lives_ok(
  $$update public.applications
       set deed_sent_at = now(), deed_executed_at = now() - interval '1 hour'
     where id = '96000000-0000-0000-0000-000000000012'$$,
  'an executed-before-sent deed is accepted, because the two clocks differ');
select ok(
  (select sequence_anomaly from public.applications where id = '96000000-0000-0000-0000-000000000012'),
  '...and flagged, so a human sees it');

select * from finish();
rollback;
