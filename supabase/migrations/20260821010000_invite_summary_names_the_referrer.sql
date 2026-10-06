-- ===========================================================================
-- The invite landing needs to know WHO referred them.
--
-- It says "Your agent has started this for you", which is wrong when the
-- referrer is a supplier rather than a letting agency, and there was no way to
-- say anything better: tenant_invite_summary returned the property and the rent
-- and nothing about the referrer, so the screen had to guess and guessed
-- "agent".
--
-- Returns the AGENCY name, not the individual referrer's name. The tenant knows
-- the organisation, not the person who typed the form, and the organisation is
-- what appears in the invite email, so the two now agree.
--
-- Return type changes, so this drops rather than replaces: create or replace
-- refuses a return-type change with 42P13.
-- ===========================================================================

-- The parameter is uuid, not text. tenant_invites.token is a uuid column and
-- PostgREST coerces the string the Edge Function sends. Dropping the wrong
-- signature drops nothing and the create then fails on uuid = text.
drop function if exists public.tenant_invite_summary(uuid);

create function public.tenant_invite_summary(p_token uuid)
returns table (
  valid boolean,
  email text,
  prop_addr1 text,
  prop_postcode text,
  monthly_rent numeric,
  tenancy_start date,
  already_claimed boolean,
  referrer_name text
)
language sql stable security definer set search_path to '' as $$
  select
    i.expires_at > now(),
    i.email,
    a.prop_addr1, a.prop_postcode, a.monthly_rent, a.tenancy_start,
    i.claimed_at is not null,
    -- The agency the referral was filed against. Null is a real answer and the
    -- screen falls back rather than printing an empty gap.
    ag.name
  from public.tenant_invites i
  join public.applications a on a.id = i.application_id
  left join public.agencies ag on ag.id = a.agency_id
  where i.token = p_token
$$;

revoke all on function public.tenant_invite_summary(uuid) from public;
grant execute on function public.tenant_invite_summary(uuid) to anon, authenticated, service_role;

comment on function public.tenant_invite_summary(uuid) is
  'What an invite landing page may show before anybody signs in. Includes the referring agency name so the page does not have to assume the referrer is a letting agent.';

do $$
begin
  if to_regprocedure('public.tenant_invite_summary(uuid)') is null then
    raise exception 'tenant_invite_summary did not get recreated';
  end if;
  -- anon must keep it: the landing page runs before sign-in.
  if not has_function_privilege('anon', 'public.tenant_invite_summary(uuid)', 'execute') then
    raise exception 'anon lost tenant_invite_summary; the invite landing runs before sign-in';
  end if;
end $$;
