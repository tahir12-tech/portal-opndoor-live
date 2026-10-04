-- THE FEE PREVIEW SAYS WHICH UNIT, SO THE FORM CAN SAY "1 MONTH".
--
-- Matt, 2026-10-04, item 2 of four: the fee basis unit, "1 month", not
-- "1 weeks".
--
-- Test: supabase/tests/the_preview_says_which_unit.test.sql
--
-- =========================================================================
-- A BAND IN MONTHS KEEPS ITS QUANTITY IN fee_basis_weeks
-- =========================================================================
--
-- 20261006120000 gave a fee basis a unit, and `resolve_fee` has returned the
-- pair ever since: a one-month band is (1, 'months'), a five-week band is
-- (5, 'weeks'). The quantity column kept its old name, which is fine while
-- the unit travels with it.
--
-- This function dropped the unit. So the form received 1 and worded it from
-- the quantity alone, printing "1 weeks of rent" under a figure that was one
-- MONTH of rent. The figure was right; the sentence under it was wrong by
-- about a factor of four, and ungrammatical as well.
--
-- MEASURED ON DEV BEFORE THE FIX, live data and not a fixture: the preview
-- for Kestrel Central at one tenant returned fee_amount 2000.00,
-- fee_basis_weeks 1.00, is_standard false. One week of that rent is 461.54.
--
-- IT WAS NEVER A SUPPLIER-ONLY DEFECT. Regent's bands are the same shape, so
-- the agency rail reads it too. It surfaced in the supplier audit only
-- because that is where the looking was being done.
--
-- THE TENANT'S EMAIL AND THE PAY PAGE WERE NEVER WRONG, which is worth
-- recording so nobody goes looking: those derive the basis arithmetically
-- from fee over rent (`feeBasisWeeksOf`), so a one-month band gives 4.33 and
-- is worded "one month's rent" correctly. Only the stored-quantity reader
-- was affected, and the form is the only one.
--
-- ADDITIVE. The column is appended to the result, so a caller that does not
-- select it is unaffected.

/* DROPPED FIRST, because a column is being ADDED to the result and
   CREATE OR REPLACE cannot change a function's return type. Without this a
   clean apply of the files fails where dev succeeded, which is the exact
   disagreement `npm run drift` exists to catch. */
drop function if exists public.referral_fee_preview(text, text, text, numeric, numeric[]);

CREATE OR REPLACE FUNCTION public.referral_fee_preview(p_agency text, p_branch text, p_partner_slug text, p_rent numeric, p_shares numeric[])
 RETURNS TABLE(fee_amount numeric, fee_basis_weeks numeric, fee_basis_unit text, is_standard boolean, agreement_id uuid, tenant_count integer, shares numeric[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_branch uuid; v_route uuid; v_partner uuid; v_n int; f record;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  v_n := greatest(coalesce(array_length(p_shares, 1), 1), 1);

  if p_partner_slug is not null and btrim(p_partner_slug) <> '' then
    select id into v_partner from public.partners where slug = p_partner_slug;
  end if;

  select b.id into v_branch
  from public.branches b join public.agencies a on a.id = b.agency_id
  where b.name = p_branch and a.name = p_agency
    and (v_partner is null or b.partner_id = v_partner)
  limit 1;

  -- Only branches the caller can already see. The preview adds no reach: an
  -- agent cannot price another agency's deal by typing its name.
  if v_branch is not null and not (
       public.is_admin()
       or exists (select 1 from public.branches b2 where b2.id = v_branch
                   and (public.app_reachable_agency(b2.agency_id)
                        or (public.app_has_scope() and b2.id in (select public.app_scope_branches())))))
  then
    v_branch := null;
  end if;

  v_route := case when v_branch is null then v_partner
                  else public.resolve_route_partner(v_branch, null) end;

  select f2.fee_amount, f2.fee_basis_weeks, f2.fee_basis_unit, f2.agreement_id
    into f
  from public.resolve_fee(v_branch, v_route, p_rent, v_n) f2;

  fee_amount := coalesce(f.fee_amount, p_rent);
  fee_basis_weeks := coalesce(f.fee_basis_weeks, 4.35);
  /* THE UNIT COMES OUT WITH THE QUANTITY, which is the whole of this change.
     resolve_fee has returned it since 20261006120000 and this function
     dropped it, so a band written in MONTHS arrived at the form as its
     quantity alone: a one-month band is stored as 1, and the form said
     "1 weeks of rent" over the right figure. Defaulted to 'weeks' because
     that is what an unqualified quantity has always meant here. */
  fee_basis_unit := coalesce(f.fee_basis_unit, 'weeks');
  agreement_id := f.agreement_id;
  is_standard := coalesce((select pa.is_standard from public.pricing_agreements pa where pa.id = f.agreement_id), true);
  tenant_count := v_n;
  shares := public.apportion(fee_amount, coalesce(p_shares, array[100]::numeric[]));
  return next;
end $function$


;

revoke all on function public.referral_fee_preview(text, text, text, numeric, numeric[]) from public, anon;
grant execute on function public.referral_fee_preview(text, text, text, numeric, numeric[]) to authenticated, service_role;

comment on function public.referral_fee_preview(text, text, text, numeric, numeric[]) is
  'What this referral will cost before it is sent: the tenancy fee, the basis as a QUANTITY AND ITS UNIT, whether the terms are standard, and each tenant''s share. Prices through resolve_fee and apportion, the same two functions create_joint_referral charges with.';
