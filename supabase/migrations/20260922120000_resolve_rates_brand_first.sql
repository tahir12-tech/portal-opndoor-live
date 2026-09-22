-- resolve_rates: most specific tier wins — BRAND (agency) override, then GROUP
-- override, then the Opndoor base (partner) rate.
--
-- Previously the group won over the brand (coalesce(group, agency, partner)). The
-- approved model is that a brand's own rate overrides its group's: a group rate is
-- the default for its brands, and a brand that sets its own rate takes precedence.
-- So the coalesce order becomes agency -> group -> partner.
--
-- ONLY NEW REFERRALS ARE AFFECTED. create_referral snapshots the resolved rate onto
-- the application at creation and never recomputes it, so every existing application
-- keeps the exact rate it was created with; history does not move. This migration
-- redefines the resolver for future create_referral calls and for the client's
-- commission previews (which mirror this order).
create or replace function public.resolve_rates(p_branch uuid, p_route_partner uuid)
returns table (partner_rate numeric, agent_rate numeric)
language sql stable security definer set search_path to '' as $$
  select
    coalesce(a.partner_rate, g.partner_rate, p.partner_rate),
    coalesce(a.agent_rate,   g.agent_rate,   p.agent_rate)
  from public.partners p
  left join public.branches b on b.id = p_branch
  left join public.agencies a on a.id = b.agency_id
  left join public.agency_groups g on g.id = a.group_id
  where p.id = p_route_partner
$$;

comment on function public.resolve_rates(uuid, uuid) is
  'Commission for an application: the brand (agency) override, else the group override, else the partner base. Most specific wins. Every level is nullable and null means inherit, so with no brand or group rate set this returns exactly the partner rate. Snapshotted by create_referral at creation and never recomputed.';

revoke all on function public.resolve_rates(uuid, uuid) from public, anon;
grant execute on function public.resolve_rates(uuid, uuid) to authenticated, service_role;

-- Inertness guard, unchanged in spirit from the original: with no brand or group
-- rate set, every branch must still resolve to its partner's rate exactly. Swapping
-- the coalesce order cannot change that (coalesce over all-null overrides is the
-- partner rate either way), so this must still hold after the redefinition.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.branches b
  join public.partners p on p.id = b.partner_id
  cross join lateral public.resolve_rates(b.id, b.partner_id) r
  where (
    not exists (select 1 from public.agencies a where a.id = b.agency_id and (a.partner_rate is not null or a.agent_rate is not null))
    and not exists (
      select 1 from public.agencies a
      join public.agency_groups g on g.id = a.group_id
      where a.id = b.agency_id and (g.partner_rate is not null or g.agent_rate is not null)
    )
  ) and (
    r.partner_rate is distinct from p.partner_rate or r.agent_rate is distinct from p.agent_rate
  );
  if v_bad > 0 then
    raise exception '% branch(es) with no brand/group override resolve to a non-partner rate', v_bad;
  end if;
end $$;
