-- A REFUNDED FEE CANCELS THAT TENANT'S GUARANTEE.
--
-- Matt, 2026-10-04 (ak): "when a tenant's fee is fully refunded, their
-- guarantee ends. 1) Mark their deed 'Cancelled: fee refunded' everywhere
-- (application page, tenancy box, exports, bordereau from the refund date),
-- never 'Deed executed'."
--
-- Test: supabase/tests/a_refunded_fee_cancels_the_guarantee.test.sql
--
-- =========================================================================
-- WHAT WAS ALREADY TRUE, measured before writing anything
-- =========================================================================
--
-- THE MONEY IS ALREADY HANDLED, both halves of (ak) item 5, and I nearly
-- rebuilt it. `commission_statement_lines` has excluded
-- `payment_state = 'refunded'` all along, so a refund in an unposted month
-- drops out of the statement by itself. And 20261007180000 wired
-- `raise_refund_after_statement` into `apply_stripe_refund`, so a refund
-- against a month already posted raises a `statement_refund_questions` row
-- for the next statement's deduction. Nothing here touches commission.
--
-- A LATE SIGNATURE IS ALREADY REFUSED. `apply_deed_executed` returns
-- 'refunded' and writes an internal row rather than issuing a deed, so a
-- PandaDoc completion arriving after the refund cannot resurrect cover.
--
-- WHAT WAS NOT TRUE: the deed itself. `stripe-webhook` voids an OUTSTANDING
-- deed on refund (deed_state = 'awaiting_tenant') and does nothing at all to
-- an EXECUTED one. GR-25235 on dev is the proof: refunded this afternoon,
-- `payment_state = 'refunded'`, and still `deed_state = 'executed'`, which
-- is the screen reading "Deed executed" on a guarantee that has ended. That
-- is the whole of what this migration fixes.
--
-- =========================================================================
-- 1. A DEED CAN BE CANCELLED, which the check constraint did not allow
-- =========================================================================
--
-- 'voided' IS NOT THE SAME THING and reusing it would have been wrong. A
-- voided deed was never signed: the signing link was killed before anybody
-- put their name to it. A cancelled deed WAS signed, and the instrument is
-- being ended. The tenant, the agent and the underwriter all need to be able
-- to tell those apart, and `executed_pdf_path` survives on the second.
--
-- ADDITIVE, so the referral path passes through none of it: no existing row
-- changes value and nothing that reads the old five values stops working.

alter table public.applications drop constraint applications_deed_state_check;
alter table public.applications add constraint applications_deed_state_check
  check (deed_state = any (array['awaiting_tenant','executed','declined','voided','error','cancelled']));

comment on column public.applications.deed_state is
  'Lifecycle of the Deed of Guarantee instrument. awaiting_tenant, executed, declined, voided (killed before signature), error, cancelled (signed, then ended because the fee was refunded). Cancelled keeps executed_pdf_path: the instrument existed and the record of it is what makes the cancellation auditable.';

-- When the instrument was ended, which is NOT always when the money went
-- back: a cascade refunds co-tenants minutes later, and a hand-cancellation
-- could be later still. The bordereau dates cover off the REFUND, so it uses
-- refunded_at; this column is for the audit trail of the deed itself.
alter table public.applications add column if not exists deed_cancelled_at timestamptz;
comment on column public.applications.deed_cancelled_at is
  'When the Deed of Guarantee was cancelled. Set only alongside deed_state = ''cancelled''.';

/* AND THE COLUMN HAS TO BE GRANTED, because applications is a DENYLIST
   table: 20260811180000 took the two commission columns off the table grant
   and re-granted every other column by name, so a column added later is not
   selectable by `authenticated` until a migration says so. The last time
   somebody forgot, eight lifecycle columns went ungranted and no staff role
   could load the dashboard at all.

   `applications_column_grants.test.sql` is the catalogue-driven guard that
   exists because of that outage, and it caught this one before the commit
   rather than after it. */
grant select (deed_cancelled_at) on public.applications to authenticated;

-- =========================================================================
-- 2. CANCELLING IS ONE FUNCTION, because three callers will need it
-- =========================================================================
--
-- The refund webhook, the joint-tenancy cascade, and whoever has to do it by
-- hand when Stripe and the portal disagree. One implementation means one
-- answer to "what does cancelling actually do", and one place to change it.
--
-- IDEMPOTENT, WHICH IS THE POINT. A Stripe webhook is redelivered as a
-- matter of course, and the cascade is resumable by design, so this is
-- called more than once for the same application in normal operation. It
-- returns false and writes nothing when there is nothing to do, rather than
-- logging the cancellation twice and emailing the agent twice.

create or replace function public.cancel_guarantee_for_refund(p_application uuid)
returns boolean language plpgsql security definer set search_path to '' as $function$
declare a public.applications;
begin
  select * into a from public.applications where id = p_application;
  if not found then return false; end if;

  -- ALREADY DONE. The second delivery of the same webhook lands here.
  if a.deed_state = 'cancelled' then return false; end if;

  /* THE MONEY MUST HAVE GONE BACK FIRST, and in full. This refuses rather
     than returning false, because a caller reaching here on an unrefunded
     application has a bug and silence would hide it. 'partially_refunded'
     is deliberately not enough: Matt's rule is that a part refund leaves
     the guarantee standing. */
  if coalesce(a.payment_state, '') <> 'refunded' then
    raise exception 'Cannot cancel the guarantee on % : payment_state is %, not refunded.',
      a.guarantee_ref, coalesce(a.payment_state, 'null') using errcode = '22023';
  end if;

  /* NOTHING TO CANCEL is not a failure. An application refunded before the
     deed was ever issued has no instrument to end, and the refund path has
     already voided an outstanding one. Only an EXECUTED deed becomes
     cancelled; everything else keeps the state it has. */
  if coalesce(a.deed_state, '') <> 'executed' then return false; end if;

  update public.applications
     set deed_state = 'cancelled', deed_cancelled_at = now()
   where id = a.id;

  /* BUSINESS, NOT INTERNAL. The agent placed this tenant and told a landlord
     there was a guarantee. Its ending is the single most important thing
     that has ever happened on this application from their side. */
  insert into public.activity_log (application_id, kind, message, actor, visibility)
  values (a.id, 'deed_cancelled',
          'Deed of Guarantee cancelled because the fee was refunded.',
          'System', 'business');

  return true;
end $function$;

revoke all on function public.cancel_guarantee_for_refund(uuid) from public, anon, authenticated;
grant execute on function public.cancel_guarantee_for_refund(uuid) to service_role;

comment on function public.cancel_guarantee_for_refund(uuid) is
  'End the Deed of Guarantee on a fully refunded application. Idempotent: returns false and writes nothing if already cancelled, or if there is no executed deed to cancel. Refuses if the fee has not been fully refunded. Commission needs no handling here: an unposted month excludes refunded rows already, and a posted one is covered by raise_refund_after_statement inside apply_stripe_refund.';
