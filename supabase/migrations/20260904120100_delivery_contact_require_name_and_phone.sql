-- Tighten delivery_contact_named to match the app-level deliveryContactReady rules:
-- a letting agent needs the agency name, the contact surname and a phone; a private
-- landlord needs the surname and a phone. (kind and email are already NOT NULL.)
--
-- NOT VALID so existing rows are not retro-checked. Earlier delivery contacts were
-- written under the looser rule (agency name for an agent, surname for a landlord)
-- and must not be rejected now. Every INSERT, and any UPDATE to a row, is checked
-- against the new rule from here on; only the one-time back-scan of existing rows
-- is skipped. Postgres cannot patch a CHECK body, so this drops and re-adds it.

alter table public.application_delivery_contacts
  drop constraint if exists delivery_contact_named;

alter table public.application_delivery_contacts
  add constraint delivery_contact_named check (
    (kind = 'letting_agent'
       and coalesce(btrim(agency_name), '') <> ''
       and coalesce(btrim(last_name), '') <> ''
       and coalesce(btrim(phone), '') <> '')
    or (kind = 'private_landlord'
       and coalesce(btrim(last_name), '') <> ''
       and coalesce(btrim(phone), '') <> '')
  ) not valid;

comment on constraint delivery_contact_named on public.application_delivery_contacts is
  'A letting agent needs agency name + contact surname + phone; a private landlord needs surname + phone. Matches deliveryContactReady. NOT VALID: existing rows written under the older, looser rule are grandfathered.';
