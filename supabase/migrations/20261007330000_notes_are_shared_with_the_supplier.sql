-- ===========================================================================
-- NOTES ARE SHARED WITH THE SUPPLIER THAT REFERRED THE APPLICATION.
--
-- Matt, 2026-10-01, verbatim, correcting 20261007310000: "notes on an
-- application are shared between Opndoor and the supplier that referred it
-- (e.g. Rightmove's staff); on agency referrals (e.g. Regent) notes stay
-- Opndoor-only."
--
-- ===========================================================================
-- WHAT I GOT WRONG, AND THE PART THAT WAS RIGHT
-- ===========================================================================
--
-- 20261007310000 read "Notes are Opndoor-only: hide the Notes section
-- entirely from agency and supplier users" as one rule for every rail, and
-- made app_notes readable by Opndoor staff alone. The agency half of that is
-- what Matt wanted and stays. The supplier half is wrong: a supplier's staff
-- work the account with us, and the notes are the shared record of that.
--
-- The thing the original instruction was actually about -- an agency Director
-- reading Opndoor's internal notes on their own referral -- is untouched.
--
-- THE TENANT'S OWN FILES ARE NOT PART OF THIS. The correction says notes, and
-- a bank statement is not a note: application_documents keeps the rule
-- 20261007310000 gave it, on both rails.
--
-- ===========================================================================
-- WHICH RAIL AN APPLICATION IS ON, SAID ONCE
-- ===========================================================================
--
-- "The supplier that referred it" is the application's partner, when that
-- partner is a supplier company rather than one of our own rails. The client
-- already decides this in `partyIsSupplier`: not a house partner, and not an
-- agency (an agency is a partner on `opndoor_referenced`, which is Opndoor
-- doing the referencing). `is_supplier_partner` is the same sentence in SQL,
-- so the screen and the policy cannot drift into disagreeing about who a
-- supplier is.
--
-- The three house partners are not suppliers, so a direct referral and a
-- referencing-partner row keep notes Opndoor-only, which is the same answer
-- the agency rail gets and for the same reason: there is no outside company
-- on the other side of the conversation.
-- ===========================================================================

create or replace function public.is_supplier_partner(p_partner uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1 from public.partners p
     where p.id = p_partner
       and p.referencing_mode <> 'opndoor_referenced'
  ) and not coalesce(public.is_house_partner_id(p_partner), false)
$function$;

revoke all on function public.is_supplier_partner(uuid) from public, anon;
grant execute on function public.is_supplier_partner(uuid) to authenticated, service_role;

comment on function public.is_supplier_partner(uuid) is
  'Is this partner a supplier company, rather than one of our own rails or an agency? The SQL twin of partyIsSupplier on the client: not a house partner (opndoor-agents, opndoor-direct, referencing-partner) and not on opndoor_referenced, which is what an agency is. Used to decide who an application''s notes are shared with.';

-- ---------------------------------------------------------------------------
-- 1. READING A NOTE
-- ---------------------------------------------------------------------------
drop policy if exists app_notes_select on public.app_notes;
create policy app_notes_select on public.app_notes
  for select to authenticated
  using (
    coalesce(public.is_opndoor_staff(), false)
    /* THE SUPPLIER THAT REFERRED IT, and nobody else's. The subquery is
       itself RLS-scoped, so "an application you can see" still applies and
       a supplier's own reach test comes with it; what this adds is that the
       application must be on that supplier's rail, which keeps an agency
       referral out even when the reader could see the application. */
    or application_id in (
         select a.id from public.applications a
          where coalesce(public.is_supplier_partner(a.partner_id), false)
            and a.partner_id = public.app_partner()
       )
  );

comment on table public.app_notes is
  'The working record of an application, shared between Opndoor and the supplier that referred it. On an agency referral, a direct referral or the referencing rail there is no second party to share with, so the notes are Opndoor''s alone: the level words "management" and "referrer" are held by agency users too, so a role test is not a boundary here and the policy names the rail instead.';

-- ---------------------------------------------------------------------------
-- 2. WRITING ONE
-- ---------------------------------------------------------------------------
-- Shared means both sides can add to it. A supplier's management user, and
-- the person who referred it, write notes on their own applications again --
-- which is what they could do before 20261007310000, now restricted to the
-- rail where it is right. Agency users still cannot, on either count.
create or replace function public.add_application_note(p_ref text, p_body text)
returns public.app_notes
language plpgsql
security definer
set search_path to ''
as $function$
declare a public.applications; r text; owned boolean; b text; n public.app_notes;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := coalesce(a.referrer_id = auth.uid(), false);
  if not coalesce((
        public.is_opndoor_staff()
        or (public.is_supplier_partner(a.partner_id)
            and a.partner_id = public.app_partner()
            and (r = 'management' or (r = 'referrer' and owned)))
      ), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  b := btrim(coalesce(p_body, ''));
  if b = '' then raise exception 'A note cannot be empty.' using errcode = '22023'; end if;
  insert into public.app_notes(application_id, body, author, author_id)
  values (a.id, left(b, 2000), (select full_name from public.users where id = auth.uid()), auth.uid())
  returning * into n;
  return n;
end $function$;

revoke all on function public.add_application_note(text, text) from public, anon;
grant execute on function public.add_application_note(text, text) to authenticated, service_role;

comment on function public.add_application_note(text, text) is
  'Append one note to the working record of an application. Opndoor staff on any rail; the referring supplier''s management, and the person who referred it, on theirs. An agency user cannot, on any rail: on the agency rail the notes are Opndoor''s own.';
