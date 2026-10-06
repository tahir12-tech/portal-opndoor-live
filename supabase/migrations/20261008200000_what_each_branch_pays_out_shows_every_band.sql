-- "WHAT EACH BRANCH PAYS OUT" SHOWS EVERY BAND.
--
-- Matt (v): "Agency Commission tab, 'What each branch pays out': when the
-- deal varies by tenant count, show both, e.g. '20% (1 tenant), 25% (2 or
-- more)', not just 20%."
--
-- Test: supabase/tests/every_band_reaches_the_payout_table.test.sql
--
-- =========================================================================
-- THE SCREEN COULD NOT HAVE SHOWN THEM, WHICH IS WHY IT DID NOT
-- =========================================================================
--
-- `commission_split_batch` returns one `rate` per payee, resolved through
-- `resolve_pricing_agreement` at a tenant count of one. The bands exist --
-- `pricing_agreement_bands` holds one row per count with its own rate, and
-- Kestrel's hidden deal e4b75778 has three of them -- but nothing carried
-- them past the resolver. A reader of that table was being shown the
-- one-tenant rate of a deal that charges differently at two and at three,
-- with nothing to say so.
--
-- SO THE FIX IS A COLUMN, not a format. Adding "(1 tenant)" to a single
-- rate would be dressing one band as the whole deal.
--
-- DROPPED AND RECREATED because the row type changes, which CREATE OR
-- REPLACE refuses for a set-returning function. The DROP is in the file so
-- a clean apply does what dev did.
--
-- NULL WHERE THERE IS NOTHING TO SAY, which is most lines: a standard rate
-- and a single-band deal both have one rate for every tenant count, and a
-- `bands` array repeating it would make every row look banded.

drop function if exists public.commission_split_batch(uuid[]);

create function public.commission_split_batch(p_branches uuid[])
returns table(branch_id uuid, level text, org_id uuid, org_name text,
              rate numeric, source text, bands jsonb)
language plpgsql stable security definer set search_path to '' as $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  return query
  select b.id, s.level, s.org_id, s.org_name, s.rate, s.source,
         /* EVERY BAND OF THE DEAL BEHIND THIS LINE, in tenant order.
            Only for an AGREEMENT line: a standard rate and an explicitly
            set rate are one number for every tenant count, and `source`
            is the RULE's own word for which of the three this is, never
            inferred here.

            AND ONLY WHERE THERE IS MORE THAN ONE, which is the whole
            point: a one-band agreement charges the same at every count,
            and listing "25% (1 or more)" would turn a flat deal into a
            banded one on screen. */
         case when s.source = 'agreement' then (
           select jsonb_agg(jsonb_build_object(
                    'from', x.min_tenants,
                    'to', x.max_tenants,
                    'rate', x.agent_rate) order by x.min_tenants)
             from public.pricing_agreement_bands x
            where x.agreement_id = ag.id
              and (select count(*) from public.pricing_agreement_bands y
                    where y.agreement_id = ag.id) > 1
         ) end
  from public.branches b
  cross join lateral public.commission_split(b.id, b.partner_id) s
  /* RESOLVED AGAIN HERE because commission_split returns the rate and not
     the agreement it came from. At a tenant count of one, which is the
     same call it makes, so the agreement found is the same agreement. */
  left join lateral public.resolve_pricing_agreement(b.id, b.partner_id) ag on true
  where b.id = any(p_branches)
    and public.may_see_commission()
    -- Only branches the caller can already see; this adds no reach.
    and (public.is_admin() or public.app_reachable_agency(b.agency_id)
         or (public.app_has_scope() and b.id in (select public.app_scope_branches())));
end $function$;

revoke all on function public.commission_split_batch(uuid[]) from public, anon;
grant execute on function public.commission_split_batch(uuid[]) to authenticated, service_role;

comment on function public.commission_split_batch(uuid[]) is
  'Who is paid what on a referral made at each branch. `bands` carries every tenant-count band of the deal behind an agreement line, in tenant order, and is null for a standard or explicitly set rate and for a deal with only one band -- there is nothing to show where one rate covers every count.';
