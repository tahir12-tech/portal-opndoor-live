-- Precedence proof for public.resolve_rates. Run by `supabase test db` (pgTAP)
-- against a freshly-migrated database, so it re-checks after EVERY migration.
--
-- The resolver must pick the MOST SPECIFIC tier that is set: the brand (agency)
-- override, else the group override, else the partner base — per column, since
-- partner_rate and agent_rate resolve independently. See
-- 20260922120000_resolve_rates_brand_first.sql. This locks that order so it cannot
-- silently revert to group-first.

begin;
select plan(8);

-- Self-contained fixtures (rolled back). Fixed ids so the calls are explicit.
insert into public.partners (id, slug, name, partner_rate, agent_rate)
values ('11111111-1111-1111-1111-111111111111', 'zzz-resolve-test', 'Resolve Test Co', 0.25, 0.10);

insert into public.agency_groups (id, partner_id, name)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Resolve Test Group');

insert into public.agencies (id, partner_id, name, group_id)
values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Resolve Test Brand', '22222222-2222-2222-2222-222222222222');

insert into public.branches (id, agency_id, partner_id, name)
values ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Resolve Test Branch');

-- 1. No override anywhere -> the partner base (0.25 / 0.10).
select is((select partner_rate from public.resolve_rates('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111')), 0.25::numeric, 'no override: partner_rate is the base 0.25');
select is((select agent_rate   from public.resolve_rates('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111')), 0.10::numeric, 'no override: agent_rate is the base 0.10');

-- 2. Group override set, brand still null -> the group rate wins over base.
update public.agency_groups set partner_rate = 0.30, agent_rate = 0.12 where id = '22222222-2222-2222-2222-222222222222';
select is((select partner_rate from public.resolve_rates('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111')), 0.30::numeric, 'group set, brand null: group partner_rate 0.30 beats base');
select is((select agent_rate   from public.resolve_rates('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111')), 0.12::numeric, 'group set, brand null: group agent_rate 0.12 beats base');

-- 3. Brand sets ONLY partner_rate -> brand wins that column; agent falls to group.
update public.agencies set partner_rate = 0.28 where id = '33333333-3333-3333-3333-333333333333';
select is((select partner_rate from public.resolve_rates('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111')), 0.28::numeric, 'brand partner_rate 0.28 beats the group (most specific wins)');
select is((select agent_rate   from public.resolve_rates('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111')), 0.12::numeric, 'brand agent_rate unset: still inherits the group 0.12, not the base — per-column');

-- 4. Brand sets both -> brand wins both over the group.
update public.agencies set agent_rate = 0.11 where id = '33333333-3333-3333-3333-333333333333';
select is((select partner_rate from public.resolve_rates('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111')), 0.28::numeric, 'brand both set: brand partner_rate 0.28 wins');
select is((select agent_rate   from public.resolve_rates('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111')), 0.11::numeric, 'brand both set: brand agent_rate 0.11 wins over group 0.12');

select * from finish();
rollback;
