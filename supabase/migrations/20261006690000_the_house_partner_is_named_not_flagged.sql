-- THE HOUSE PARTNER IS NAMED, NOT FLAGGED.
--
-- 20261006680000 defined is_house_partner_id as `partners.is_house_route`,
-- and that is the wrong column. Measured:
--
--   slug                  is_house_route   partner_rate
--   opndoor-agents        FALSE            0.2500
--   opndoor-direct        true             0.0000
--   referencing-partner   true             0.0000
--
-- `opndoor-agents` -- the one whose partner_rate IS Opndoor's margin, and the
-- whole reason the predicate exists -- is not flagged. So the fix for round
-- 7's E changed nothing: a Director still read 0.2500. Caught by re-running
-- the reproduction after applying, rather than by reading.
--
-- The client has had this right all along: `isHousePartner` in channel.ts
-- tests the SLUG against a named list of three, and `is_house_route` is a
-- different question (does this route carry our own stock). This is that same
-- list, in SQL, so the two cannot drift.

create or replace function public.is_house_partner_id(p_partner uuid)
returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.partners p
     where p.id = p_partner
       and p.slug in ('opndoor-direct', 'referencing-partner', 'opndoor-agents')
  )
$$;

comment on function public.is_house_partner_id(uuid) is
  'Opndoor''s own house/plumbing partners, BY SLUG -- the same three that '
  'HOUSE_PARTNER_SLUGS names in src/data/channel.ts. Not is_house_route, '
  'which asks a different question and is false for opndoor-agents.';
