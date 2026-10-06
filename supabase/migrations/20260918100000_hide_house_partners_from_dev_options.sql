-- Keep the house / plumbing partners out of the Dev Centre admin partner picker.
--
-- dev_partner_options() feeds the "scope to a partner" dropdown an Opndoor admin
-- uses across the Dev Centre tabs. It selected every partner, so the three house
-- partners showed up as pickable partners -- a breach of "the house partner must
-- never appear in a screen". This is the one partner LIST that comes from an RPC
-- rather than from the client's getPartners() (which now filters them client-side);
-- the same three slugs are excluded here.
--
-- Note opndoor-agents is excluded by slug, not by is_house_route: that flag is
-- false for it on purpose, because application_channel maps is_house_route -> 'Direct'
-- and the agency rail must classify as 'Agent referral'. The slugs are stable and
-- set by migration, the same contract public.application_channel relies on.
create or replace function public.dev_partner_options()
returns table (
  id                 uuid,
  slug               text,
  name               text,
  referencing_mode   text,
  api_access_enabled boolean
)
language sql stable security definer set search_path to '' as $$
  select p.id, p.slug, p.name, p.referencing_mode, p.api_access_enabled
  from public.partners p
  where public.is_aal2() and public.is_admin()
    and p.slug not in ('opndoor-direct', 'referencing-partner', 'opndoor-agents')
  order by p.name;
$$;

revoke all on function public.dev_partner_options() from public, anon;
grant execute on function public.dev_partner_options() to authenticated;
