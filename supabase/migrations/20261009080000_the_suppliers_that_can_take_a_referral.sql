/* =====================================================================
   WHICH SUPPLIERS CAN TAKE A REFERRAL.

   Matt, 2026-10-04 (df): "Supplier pickers (New application 'Referred
   by', and anywhere else suppliers are chosen): make them
   type-to-search, like the agency picker, and list only suppliers that
   can take referrals (active, with a deal set). Hide paused,
   onboarding and no-deal suppliers, with a note 'Only suppliers with a
   live deal are shown'."

   AND 2026-10-05, CHOOSING WHAT "a deal set" MEANS: "go with B, a
   negotiated agreement that has not ended."

   THE THREE CANDIDATES AND WHY HIS CHOICE IS THE ONE THE DATABASE CAN
   ANSWER WELL, measured on dev the same day over ten suppliers, all of
   them active:

       "Live from" is set                        1 of 10
       a partner-scope agreement, not ended      3 of 10   <- B
       partner_rate is not null                  8 of 10

   The third is filled by default when a supplier is created, so it
   would have listed "No Deal Supplier" among the suppliers with a
   deal. The first is somebody having typed a date and says nothing
   about terms.

   WHY IT IS A SERVER QUESTION AT ALL. The browser holds the partners
   but not their pricing agreements, and it should not: a deal is
   commission, and the Referred by picker is drawn for an
   opndoor_manager, for whom may_see_commission is a flat no. So the
   question is answered here and the answer is a NAME AND AN ID,
   never a rate, a band or a date.

   SECURITY DEFINER FOR THAT REASON, with is_opndoor_staff inside: a
   manager may not read pricing_agreements and must still be able to
   pick a supplier to refer through.
   ===================================================================== */

create or replace function public.suppliers_that_can_take_referrals()
returns table(id uuid, slug text, name text)
language sql stable security definer set search_path to ''
as $function$
  select p.id, p.slug, p.name
  from public.partners p
  where public.is_opndoor_staff()
    and p.partner_kind = 'supplier'
    and p.status = 'active'
    /* B: A NEGOTIATED AGREEMENT THAT HAS NOT ENDED. `ended_at` is the
       end, not `effective_to`: ending a deal is an act somebody takes
       and it is what the Commission tab's "End this agreement" writes. */
    and exists (
      select 1 from public.pricing_agreements pa
       where pa.scope_level = 'partner' and pa.scope_id = p.id
         and pa.ended_at is null)
  order by p.name
$function$;

revoke all on function public.suppliers_that_can_take_referrals() from public, anon;
grant execute on function public.suppliers_that_can_take_referrals() to authenticated, service_role;

comment on function public.suppliers_that_can_take_referrals() is
  'The suppliers a referral may be filed under: supplier-kind, active, and holding a negotiated agreement that has not ended. Matt chose that last test on 2026-10-05 from three candidates. Returns a name and an id and nothing else, because its caller includes opndoor_manager, who may not read commission.';
