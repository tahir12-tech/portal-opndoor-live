/* =====================================================================
   A PARTNER IS A SUPPLIER OR AN AGENCY, AND SAYS SO.

   Matt, 2026-10-02: "Every partner gets a fixed 'supplier or agency'
   setting of its own, decided when it's created ('Add supplier' makes a
   supplier; an agency partner is an agency) and never inferred from
   referencing mode. Referencing mode becomes independent: a supplier can
   use any referencing mode and stays a supplier."

   WHAT WAS WRONG. Three predicates decided what a partner IS by reading
   what happens to its applications:

     is_supplier_estate      not a house slug and mode <> opndoor_referenced
     is_our_estate_partner   mode = opndoor_referenced
     is_agent_estate         the route partner's mode = opndoor_referenced

   Referencing mode is a JOURNEY setting. It is snapshotted onto every
   application at creation precisely because it is expected to change.
   Hanging identity off it means an admin changing one supplier's journey
   silently moves that supplier into Opndoor's own estate -- measured on
   dev in a rolled-back transaction before this was written: Kestrel set
   to "opndoor referenced" left the Suppliers list, folded into "Agency
   referral", lost its via-labels, dropped off Reconciliation, and
   vanished from the supplier settlement, while the SQL side went on
   billing it. A screen that stops listing a supplier the database still
   bills is the fault, and it is not a screen fault.

   AND is_agent_estate ALREADY SAID SO IN A COMMENT. "An agency saying
   'we reference our own tenants' changes their journey; it does not take
   them out of our estate or off their agreement." True, and the line
   underneath read the mode anyway. The comment described the rule; the
   code described the only fact that was to hand.

   THE NEW FACT. `partners.partner_kind`, one of:

     supplier   a company Opndoor buys referrals from. Its partner row IS
                its company boundary, and its agencies are its estate.
     agency     a letting agency. Includes `opndoor-agents`, the house
                partner every agency Opndoor onboards shares -- see below.
     house      Opndoor's own plumbing: `opndoor-direct` and
                `referencing-partner`.

   WHY opndoor-agents IS 'agency' AND NOT 'house'. It is a house partner
   and stays one: `is_house_partner_id` is unchanged and still names all
   three slugs, which is what keeps it off customer screens. But house-ness
   and kind are different axes. An agency Director's own partner scope IS
   `opndoor-agents`, so calling its kind 'house' would take the agency rail
   out of the agency case and change every agency screen. Its kind is what
   it is the rail for.

   NOT UPDATABLE FROM THE BROWSER, deliberately. `authenticated` gets
   SELECT and no UPDATE, and `update_partner_settings` takes no argument
   for it. "Decided when it's created" is enforced by the grant, not by
   the absence of a control.
   ===================================================================== */

alter table public.partners
  add column partner_kind text not null default 'supplier';

alter table public.partners
  add constraint partners_kind_known
  check (partner_kind in ('supplier', 'agency', 'house'));

comment on column public.partners.partner_kind is
  'What this partner IS: supplier (we buy referrals from it), agency (a letting agency, including the opndoor-agents rail) or house (Opndoor plumbing). Fixed at creation. Never inferred from referencing_mode, which is a journey setting and is expected to change.';

/* THE BACKFILL, from what each partner really is today rather than from
   the column it is replacing. The default above already makes every
   existing row a supplier, which is right for Kestrel, Letly and the
   four test suppliers; these are the six that are not.

   new-supplier-3 IS THE BUG SITTING IN THE DATA. It was made by "Add
   supplier" and then set to "opndoor referenced", so today it is absent
   from the Suppliers list and reads as an agency. The default leaves it
   a supplier, which is the one row whose screen behaviour this migration
   changes. It holds no agencies and no applications. */
update public.partners set partner_kind = 'agency'
 where slug in ('harbour-lets', 'opndoor-agents');

update public.partners set partner_kind = 'house'
 where slug in ('opndoor-direct', 'referencing-partner');

/* Readable, not writable. Matches the SELECT grant the other fifteen
   columns carry; the absence of UPDATE is the point. */
grant select (partner_kind) on public.partners to authenticated;
grant select (partner_kind) on public.partners to anon;

/* =====================================================================
   THE THREE PREDICATES, REPOINTED.

   Each keeps its name, its signature and its meaning. Only the fact it
   reads changes. Measured against dev before and after: the truth table
   for all ten partners is identical except new-supplier-3, which is the
   row the change exists to correct.
   ===================================================================== */

create or replace function public.is_supplier_estate(p_partner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  -- The fact itself now. A supplier is a supplier whatever its journey.
  select coalesce(
    (select p.partner_kind = 'supplier'
       from public.partners p where p.id = p_partner),
    false)
$$;

create or replace function public.is_our_estate_partner(p_partner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  /* An estate Opndoor itself runs: an agency-kind partner (the
     `opndoor-agents` rail, or an agency with a partner row of its own),
     and the direct rail, whose applications are Opndoor's own.

     `referencing-partner` is NOT one, and was not one before either: it
     is the hand-over rail and holds no estate. Named rather than derived
     from `is_house_route`, because `opndoor-direct` carries that flag
     too and the two rails answer this differently. */
  select coalesce(
    (select p.partner_kind = 'agency' or p.slug = 'opndoor-direct'
       from public.partners p where p.id = p_partner),
    false)
$$;

create or replace function public.is_agent_estate(p_branch uuid, p_route_partner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  /* Deliberately the ROUTE PARTNER, not the branch's own choice and not
     resolve_referencing_mode's answer. An agency saying "we reference our
     own tenants" changes their journey; it does not take them out of our
     estate or off their agreement -- which is what this said all along,
     and now what it does. */
  select public.is_our_estate_partner(p_route_partner)
$$;

/* =====================================================================
   AND IT IS DECIDED AT CREATION.

   `create_partner` is the "Add supplier" button and nothing else, so it
   stamps 'supplier' rather than taking an argument nobody can answer
   differently. An agency partner is not something the product creates:
   agencies are created under the `opndoor-agents` rail, and Harbour Lets
   is a partner row Opndoor set up by hand. If that ever becomes a
   product action it gets its own entry point, which is a better place
   for the decision than a dropdown on this one.
   ===================================================================== */
create or replace function public.create_partner(
  p_name text,
  p_status text default 'onboarding',
  p_live_from date default null,
  p_partner_rate numeric default 0.25,
  p_agent_rate numeric default 0.10,
  p_referencing_mode text default 'pre_referenced_screened',
  p_portal_referrals boolean default true,
  p_api_access boolean default false
) returns public.partners language plpgsql security definer set search_path = '' as $$
declare base text; v_slug text; n int := 2; res public.partners; who text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;

  if btrim(coalesce(p_name,'')) = '' then
    raise exception 'Partner name is required' using errcode = '22023';
  end if;
  -- Same validation as update_partner_settings, deliberately identical so a
  -- partner cannot be created in a state the edit screen would refuse to save.
  if p_partner_rate is null or p_partner_rate < 0 or p_partner_rate > 1 then
    raise exception 'Partner commission must be between 0 and 100%%' using errcode = '22023';
  end if;
  if p_agent_rate is null or p_agent_rate < 0 or p_agent_rate > 1 then
    raise exception 'Agent commission must be between 0 and 100%%' using errcode = '22023';
  end if;
  if coalesce(p_status,'') not in ('active','onboarding','paused') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  if coalesce(p_referencing_mode,'') not in ('pre_referenced_open','pre_referenced_screened','opndoor_referenced') then
    raise exception 'Invalid referencing mode' using errcode = '22023';
  end if;

  -- partners_slug_valid restricts the slug to ^[a-z0-9-]+$, so strip anything
  -- else rather than letting the constraint reject a name a human typed
  -- reasonably.
  base := regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g');
  base := btrim(base, '-');   -- btrim takes the characters as a second arg; `both ... from` is trim() syntax
  base := left(nullif(base, ''), 40);
  if base is null then base := 'partner'; end if;

  v_slug := base;
  while exists (select 1 from public.partners where slug = v_slug) loop
    v_slug := base || '-' || n::text;
    n := n + 1;
  end loop;

  insert into public.partners(
    slug, name, status, live_from, partner_rate, agent_rate,
    referencing_mode, portal_referrals_enabled, api_access_enabled, partner_kind
  ) values (
    v_slug, btrim(p_name), p_status, p_live_from, p_partner_rate, p_agent_rate,
    p_referencing_mode, coalesce(p_portal_referrals, true), coalesce(p_api_access, false),
    -- SAID RATHER THAN DEFAULTED. This is the "Add supplier" button; the
    -- column's default says the same thing, and a reader of this insert
    -- should not have to go and look it up to know what is being made.
    'supplier'
  ) returning * into res;

  who := coalesce((select full_name from public.users where id = auth.uid()), 'opndoor admin');

  -- A creation row, so the audit trail starts at the beginning rather than at
  -- the first edit. Without it a partner's history begins mid-story.
  insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
  values (res.id, 'created', null,
          format('%s (%s), %s, %s, partner %s%%, agent %s%%, mode %s, portal %s, api %s',
                 res.name, res.slug, res.status, res.partner_kind,
                 to_char(res.partner_rate*100, 'FM990.0'), to_char(res.agent_rate*100, 'FM990.0'),
                 res.referencing_mode,
                 case when res.portal_referrals_enabled then 'on' else 'off' end,
                 case when res.api_access_enabled then 'on' else 'off' end),
          who);

  return res;
end $$;
