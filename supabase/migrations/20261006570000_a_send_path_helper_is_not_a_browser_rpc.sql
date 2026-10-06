-- A SEND-PATH HELPER IS NOT A BROWSER RPC.
--
-- Round 6's isolation reviewer, against code I wrote an hour earlier.
--
-- HIGH. notification_recipients and notification_enabled (20261006510000,
-- 20261006530000) are SECURITY DEFINER and were granted to `authenticated`.
-- Neither contains any authorisation at all -- deliberately, because they are
-- the SEND PATH: they answer "who should be told", which is a question the
-- server asks on behalf of a cron job, not a question a browser gets to ask.
-- Granting them to authenticated made them the only two of 123
-- browser-callable definer functions in this schema with no reach test of any
-- kind. Measured on dev, as Regent's Negotiator at aal1, against an
-- application their own RLS returns zero rows for:
--
--   select * from public.notification_recipients('005188c2-...','deed_issued')
--     ->  negotiator@meridian.invalid | Tom Reddy | referrer
--
-- Another agency's staff name and address, no MFA, no position, RLS bypassed
-- because the function is definer.
--
-- THE FIX IS THE GRANT, NOT A GUARD. Nothing in src/ or supabase/functions
-- calls either of them; the send paths that will call notification_recipients
-- run with the service key. Adding a reach test would be inventing a caller
-- to justify a grant nobody asked for. notification_matrix and
-- may_edit_notification_matrix, which the screen really does call, keep their
-- grant and already gate on may_edit_notification_matrix.
--
-- I put this hole in. The lesson is narrow and worth writing down: when the
-- grant sweep buckets a new function, "the send path calls it" is
-- service_role, not authenticated, and the two are not interchangeable just
-- because both are servers.

revoke all on function public.notification_recipients(uuid, text) from public, anon, authenticated;
grant execute on function public.notification_recipients(uuid, text) to service_role;
revoke all on function public.notification_enabled(text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.notification_enabled(text, uuid, uuid, text, text) to service_role;

-- notification_matrix calls notification_enabled and is itself definer, so it
-- keeps working: inside a definer function the owner's privileges apply.

-- ---------------------------------------------------------------------------
-- LOCK. dev_sandbox_application_document is the only way a supplier developer
-- reaches the deed their own sandbox rehearsal produced, and dev-centre calls
-- it through the CALLER-scoped client on purpose ("using the service role here
-- would skip exactly those checks"). 20261006330000 revoked it from
-- authenticated, so the call was a hard 42501 for developer and admin alike
-- and the signing half of the integration could not be exercised at all.
--
-- It is safe to grant: the function tests `not a.livemode`, `is_aal2()`, and
-- `is_admin() or (app_role() = 'developer' and a.partner_id = app_partner())`
-- in its own predicate. That is exactly the reason it is called caller-scoped.
grant execute on function public.dev_sandbox_application_document(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- STEP-UP. Two more definer functions answered a password-only session, the
-- same class as staff_payment_page_token and agency_branches_for_match in
-- 20261006500000. Five others in the same finding are `language sql` with
-- union arms; they need a predicate on every arm or a conversion to plpgsql,
-- and that is recorded in QUEUE.md rather than done mechanically here.

-- application_journey(text)
CREATE OR REPLACE FUNCTION public.application_journey(p_ref text)
 RETURNS TABLE(referencing_mode text, status text, invited_at timestamp with time zone, registered_at timestamp with time zone, property_done boolean, about_done boolean, fee_paid_at timestamp with time zone, id_done boolean, financials_done boolean, submitted_at timestamp with time zone, decided_at timestamp with time zone, decision text, decline_reason text, guarantee_paid_at timestamp with time zone, deed_at timestamp with time zone, deed_state text, current_step text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not found then return; end if;
  if not coalesce((public.is_admin()
    or (public.app_role() = 'referrer'  and a.referrer_id = auth.uid())
    or (public.app_role() = 'developer' and a.partner_id = public.app_partner()
          -- The same agency predicate its four dev_* siblings were given in
          -- 20261006410000. On the house route the partner is every agency.
          and public.app_may_reach_application_org(a.partner_id, a.agency_id, a.branch_id))
    or (public.app_role() = 'management' and a.partner_id = public.app_partner()
        and public.app_may_reach_branch(a.branch_id))), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query select
    a.referencing_mode,
    a.status,
    (select max(ti.created_at) from public.tenant_invites ti where ti.application_id = a.id),
    (select ap.created_at from public.applicants ap where ap.id = a.applicant_id),
    (coalesce(btrim(a.prop_addr1),'') <> '' and coalesce(a.monthly_rent,0) > 0 and a.tenancy_start is not null),
    exists (select 1 from public.application_profiles pr where pr.application_id = a.id and pr.nationality is not null),
    (select ep.paid_at from public.application_eligibility_payments ep where ep.application_id = a.id),
    exists (select 1 from public.application_documents d where d.application_id = a.id and d.kind = 'id_document'),
    (exists (select 1 from public.application_documents d where d.application_id = a.id and d.kind = 'bank_connection')
       or (select count(*) from public.application_documents d where d.application_id = a.id and d.kind = 'bank_statement') >= 3),
    (select pr.completed_at from public.application_profiles pr where pr.application_id = a.id),
    a.decided_at,
    case when a.status = 'declined' then 'declined'
         when a.decided_at is not null or a.status in ('sent','paid','deed') then 'approved'
         else null end,
    a.decline_reason,
    a.paid_at,
    coalesce(a.deed_executed_at, a.deed_issued_at),
    a.deed_state,
    a.current_step;
end $function$;

-- my_partner_rates()
CREATE OR REPLACE FUNCTION public.my_partner_rates()
 RETURNS TABLE(partner_id uuid, partner_rate numeric, agent_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.may_see_commission() then return; end if;
  if public.is_admin() then
    return query select p.id, p.partner_rate, p.agent_rate from public.partners p;
  elsif public.app_role() = 'management' then
    return query select p.id, p.partner_rate, p.agent_rate
                 from public.partners p where p.id = public.app_partner();
  end if;
end $function$;

