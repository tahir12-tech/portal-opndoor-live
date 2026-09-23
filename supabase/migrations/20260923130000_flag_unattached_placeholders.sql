-- Flag every house-partner "Unattached" placeholder as is_placeholder.
--
-- 20260812100000 set is_placeholder on the opndoor-direct / referencing-partner
-- "Unattached" rows, but it ran before opndoor-agents existed, so that partner's
-- "Unattached" placeholder (created later by 20260904240000) was never flagged. The
-- Agencies list excludes agencies by is_placeholder, so the unflagged one leaks in.
-- Flag any house-partner "Unattached" agency/branch, idempotently.
update public.agencies set is_placeholder = true
where name = 'Unattached' and is_placeholder = false
  and partner_id in (select id from public.partners where slug in ('opndoor-direct', 'referencing-partner', 'opndoor-agents'));

update public.branches set is_placeholder = true
where name = 'Unattached' and is_placeholder = false
  and partner_id in (select id from public.partners where slug in ('opndoor-direct', 'referencing-partner', 'opndoor-agents'));
