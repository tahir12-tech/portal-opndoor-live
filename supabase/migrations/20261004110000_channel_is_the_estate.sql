-- HOW A REFERRAL ARRIVED IS A FACT ABOUT THE RELATIONSHIP.
--
-- application_channel decided "agent referral" from the APPLICATION's
-- referencing_mode — who checked the tenant. That was the same answer for as
-- long as our agencies were the ones whose tenants we checked.
--
-- Regent is our agency and references their own tenants, so every one of their
-- rows rendered as "Supplier referral": the wrong pill, the wrong Route filter,
-- and the wrong bucket in every count that groups by channel.
--
-- The partner is already joined here, so the correction is to read the mode off
-- it rather than off the row. An agency typing a referral into the portal is an
-- agency referral whoever did the referencing; a supplier pushing one through
-- the API is a partner referral for the same reason.
--
-- src/data/channel.ts mirrors this function deliberately and is changed in the
-- same commit. The test at src/data/channel.test.ts locks the two together.
create or replace function public.application_channel(p_application uuid)
returns text
language sql stable security definer set search_path to ''
as $function$
  select case
    when p.slug = 'opndoor-direct'       then 'Direct'
    when p.slug = 'referencing-partner'  then 'Provider hand-over'
    -- An application on a house route that is neither is still house business.
    when p.is_house_route                then 'Direct'
    -- Otherwise it came from a partner. An agent referral is one typed in the
    -- portal by one of our agencies; a partner referral is one pushed through
    -- the API by a supplier. THE ESTATE is the honest discriminator, and it is
    -- a property of the partner — not of who checked the tenant.
    when p.referencing_mode = 'opndoor_referenced' then 'Agent referral'
    else 'Partner referral'
  end
  from public.applications a
  join public.partners p on p.id = a.partner_id
  where a.id = p_application
$function$;

comment on function public.application_channel(uuid) is
  'How an application arrived: Direct, Agent referral, Partner referral or Provider hand-over. Keyed on the ESTATE (the partner''s referencing_mode), because an agency of ours that checks its own tenants still typed the referral into the portal. Mirrored by channelOf in src/data/channel.ts.';
