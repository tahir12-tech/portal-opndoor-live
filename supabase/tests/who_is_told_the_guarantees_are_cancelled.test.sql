-- WHO IS TOLD THE GUARANTEES ARE CANCELLED.
--
-- Matt (al): "the agent (and any landlord sent a deed) gets one email
-- listing every tenant on the tenancy and saying all guarantees for the
-- property are cancelled."
--
-- THE ASSERTIONS ARE MOSTLY ABOUT WHO IS *NOT* TOLD, which is where the
-- harm is. An email saying a guarantee has been cancelled, sent to somebody
-- who was never sent the guarantee, is worse than no email: it is us
-- telling a landlord about a document they have never seen, on a property
-- they may not know we were involved with.

begin;
select plan(8);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('d1000000-0000-0000-0000-0000000000d1','zzz-wt-agency','ZZZ WT Agency Partner',
        'opndoor_referenced', 0.30, 0.10, false, true, true, false, 'agency');
insert into public.agencies (id, partner_id, name) values
  ('d1000000-0000-0000-0000-0000000000a1','d1000000-0000-0000-0000-0000000000d1','ZZZ WT Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('d1000000-0000-0000-0000-0000000000b1','d1000000-0000-0000-0000-0000000000a1',
   'd1000000-0000-0000-0000-0000000000d1','ZZZ WT Office');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d1000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.wt.neg@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('d1000000-0000-0000-0000-00000000c001','ZZZ WT Negotiator','zzz.wt.neg@r.test','referrer',
   'd1000000-0000-0000-0000-0000000000d1','active',false);

insert into public.tenancies (id, monthly_rent, tenancy_start, prop_addr1, prop_city, prop_postcode)
values ('d1000000-0000-0000-0000-00000000aa01', 1800, current_date + 20,
        '5 Notice Lane','London','NL1 1AA');

-- THREE TENANTS. Two had a deed delivered to the SAME agent inbox, which is
-- the deduplication case; one never got a deed at all, which must still be
-- listed as a tenant but must not add a recipient. One landlord, recorded on
-- the middle application only.
insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenancy_id, tenancy_position,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, fee_amount, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, paid_at, deed_issued_at, deed_state, payment_state,
       deed_delivered_to, landlord_name, landlord_email, livemode)
values
  ('d1000000-0000-0000-0000-0000000000f1','GR-ZZWT01',
   'd1000000-0000-0000-0000-0000000000d1','d1000000-0000-0000-0000-0000000000a1',
   'd1000000-0000-0000-0000-0000000000b1','d1000000-0000-0000-0000-00000000c001',
   'd1000000-0000-0000-0000-00000000aa01', 1,
   'Mx','Ann','One','1990-01-01','zzz.wt.a@r.test','07700900830',
   '5 Notice Lane','London','NL1 1AA', 1800, 600, current_date + 20, 0.30, 0.10, 'opndoor_referenced',
   'deed', now(), now(), 'executed', 'refunded', 'lettings@zzzwt.test', null, null, true),
  ('d1000000-0000-0000-0000-0000000000f2','GR-ZZWT02',
   'd1000000-0000-0000-0000-0000000000d1','d1000000-0000-0000-0000-0000000000a1',
   'd1000000-0000-0000-0000-0000000000b1','d1000000-0000-0000-0000-00000000c001',
   'd1000000-0000-0000-0000-00000000aa01', 2,
   'Mx','Ben','Two','1990-01-01','zzz.wt.b@r.test','07700900831',
   '5 Notice Lane','London','NL1 1AA', 1800, 600, current_date + 20, 0.30, 0.10, 'opndoor_referenced',
   'deed', now(), now(), 'executed', 'paid', 'lettings@zzzwt.test', 'Len Landlord', 'len@zzzwt.test', true),
  ('d1000000-0000-0000-0000-0000000000f3','GR-ZZWT03',
   'd1000000-0000-0000-0000-0000000000d1','d1000000-0000-0000-0000-0000000000a1',
   'd1000000-0000-0000-0000-0000000000b1','d1000000-0000-0000-0000-00000000c001',
   'd1000000-0000-0000-0000-00000000aa01', 3,
   'Mx','Cal','Three','1990-01-01','zzz.wt.c@r.test','07700900832',
   '5 Notice Lane','London','NL1 1AA', 1800, 600, current_date + 20, 0.30, 0.10, 'opndoor_referenced',
   'paid', now(), null, null, 'paid', null, null, null, true);

-- ===========================================================================
-- 1-4. THE ONE EMAIL, addressed from the one application the webhook knows.
-- ===========================================================================
select is(
  (select property from public.guarantee_cancellation_notice('d1000000-0000-0000-0000-0000000000f1')),
  '5 Notice Lane, NL1 1AA',
  'the property is named from the trigger application');

select is(
  (select array_length(agent_emails, 1) from public.guarantee_cancellation_notice('d1000000-0000-0000-0000-0000000000f1')),
  1,
  'the agent inbox appears ONCE though two deeds went to it: one email per property, not per deed');

select is(
  (select agent_emails[1] from public.guarantee_cancellation_notice('d1000000-0000-0000-0000-0000000000f1')),
  'lettings@zzzwt.test',
  'and it is the inbox a deed was actually delivered to, not the branch''s current contact list');

select is(
  (select landlord_email from public.guarantee_cancellation_notice('d1000000-0000-0000-0000-0000000000f1')),
  'len@zzzwt.test',
  'the landlord recorded on a SIBLING is still found: the notice is about the property');

-- ===========================================================================
-- 5. EVERY TENANT, INCLUDING THE ONE WITH NO DEED. From the agent's side
--    there is no trigger and no cascade, only a let that is not going ahead,
--    and a list missing a name invites them to ask which one is still on.
-- ===========================================================================
select is(
  (select string_agg(t->>'guaranteeRef', ',')
     from public.guarantee_cancellation_notice('d1000000-0000-0000-0000-0000000000f1') n,
          jsonb_array_elements(n.tenants) t),
  'GR-ZZWT01,GR-ZZWT02,GR-ZZWT03',
  'all three tenants are listed, in tenancy order');

-- ===========================================================================
-- 6-7. NOBODY IS A VALID ANSWER, and it is the common one. A tenancy
--      refunded before any deed went out has no agent delivery and no
--      landlord, and must produce no recipients rather than a guess.
-- ===========================================================================
update public.applications set deed_delivered_to = null where tenancy_id='d1000000-0000-0000-0000-00000000aa01';
update public.applications set landlord_email = null, landlord_name = null
 where tenancy_id='d1000000-0000-0000-0000-00000000aa01';

select ok(
  (select agent_emails is null from public.guarantee_cancellation_notice('d1000000-0000-0000-0000-0000000000f1')),
  'no deed delivered anywhere means no agent to tell');

select ok(
  (select landlord_email is null from public.guarantee_cancellation_notice('d1000000-0000-0000-0000-0000000000f1')),
  'and a landlord who was never sent a deed is never told one was cancelled');

-- ===========================================================================
-- 8. A SOLE TENANCY IS A LIST OF ONE, not a special case and not empty.
-- ===========================================================================
insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, fee_amount, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, paid_at, deed_issued_at, deed_state, payment_state, deed_delivered_to, livemode)
values ('d1000000-0000-0000-0000-0000000000f9','GR-ZZWT09',
   'd1000000-0000-0000-0000-0000000000d1','d1000000-0000-0000-0000-0000000000a1',
   'd1000000-0000-0000-0000-0000000000b1','d1000000-0000-0000-0000-00000000c001',
   'Mx','Sol','Single','1990-01-01','zzz.wt.s@r.test','07700900839',
   '9 Lone Road','London','LR1 1AA', 900, 900, current_date + 20, 0.30, 0.10, 'opndoor_referenced',
   'deed', now(), now(), 'executed', 'refunded', 'sole@zzzwt.test', true);

select is(
  (select n.property || ' | ' || n.agent_emails[1] || ' | ' || jsonb_array_length(n.tenants)::text
     from public.guarantee_cancellation_notice('d1000000-0000-0000-0000-0000000000f9') n),
  '9 Lone Road, LR1 1AA | sole@zzzwt.test | 1',
  'a tenancy of one answers the same shape, so the caller has no second path');

select * from finish();
rollback;
