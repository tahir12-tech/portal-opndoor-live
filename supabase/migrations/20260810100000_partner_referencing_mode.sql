-- Per-partner referencing mode. See PARTNER-API.md section 3.
--
-- Says WHERE referencing happens and whether Opndoor's own acceptance criteria
-- apply. It is an extensible named set, not a boolean, because more modes are
-- expected and each one differs in its POST response, its required fields and
-- where the deed decision comes from.
--
--   pre_referenced_open       Partner referenced the tenant. Opndoor applies NO
--                             criteria: the partner decides who goes through.
--                             This is Rightmove, and it is a deliberate
--                             commercial position rather than the general case.
--
--   pre_referenced_screened   Partner referenced the tenant, but Opndoor's
--                             criteria still apply and an applicant can be
--                             declined. The expected shape for other referencing
--                             providers. NOT USABLE YET: see below.
--
--   opndoor_referenced        The partner is a CRM. They send tenant details,
--                             Opndoor emails the tenant a link, the tenant
--                             completes the application, and referencing happens
--                             on Opndoor's side. Not built.
--
-- THE DEFAULT IS DELIBERATELY THE SCREENED VALUE. A partner added without anyone
-- thinking about the mode gets criteria applied rather than waived. Waiving
-- criteria is a commercial concession and should require an explicit decision,
-- not be what you get by forgetting.
--
-- pre_referenced_screened HAS NOTHING TO CALL TODAY. There is no criteria engine
-- in this schema: no rules table, no evaluator, no 'declined' status. The API
-- must refuse to onboard a partner in this mode rather than silently accept
-- everyone, because silently accepting everyone is indistinguishable from
-- working and would be discovered commercially rather than technically.
--
-- ADDING A FOURTH MODE. Widen this constraint in a new migration, add a branch
-- to the mode dispatcher in the partner-api Edge Function, declare its
-- required-field delta and its response shape. No existing mode changes.
--
-- MODE IS NOT A PERMISSION. It is orthogonal to partner_api_keys.scopes: mode
-- says how an application is referenced, scopes say what a key may do. No code
-- path may infer one from the other.

alter table public.partners
  add column if not exists referencing_mode text not null default 'pre_referenced_screened';

alter table public.partners drop constraint if exists partners_referencing_mode_check;
alter table public.partners add constraint partners_referencing_mode_check
  check (referencing_mode in ('pre_referenced_open','pre_referenced_screened','opndoor_referenced'));

comment on column public.partners.referencing_mode is
  'Where referencing happens and whether Opndoor criteria apply. Extensible named set. Independent of partner_api_keys.scopes: mode is not a permission.';
