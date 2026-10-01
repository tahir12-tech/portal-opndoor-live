-- ===========================================================================
-- A CORRECTED DEED IS A NEW DEED, AND HAS TO BE DELIVERED.
--
-- Matt, 2026-10-01: "Signed deed email after a tenancy start correction: say
-- so at the top ... This corrected deed replaces the one sent on 1 Oct 2026."
--
-- WHICH IS A COPY RULE WITH A HOLE UNDER IT, and the hole is mine. Earlier
-- tonight 20261007320000 made the signed deed go out once: the webhook skips
-- an application whose deed_delivered_at is set, and send_deed_to_agent
-- refuses a second send unless the caller calls it a resend. Both tests ask
-- "has anything been delivered", and after a tenancy-start correction the
-- answer is yes -- about a deed that has since been voided and replaced.
--
-- So the corrected deed would have been signed and never sent.
--
-- THE TEST IS WHICH IS NEWER. A deed delivered after it was issued is the
-- one we have already sent; a deed ISSUED after the last delivery is a new
-- document, which is what a correction produces: tenancy-correction clears
-- deed_issued_at, voids the PandaDoc document and reissues, so the new
-- issue stamp lands after the old delivery stamp.
--
--   delivered_at >= issued_at   this deed has gone out      skip / refuse
--   issued_at  >  delivered_at  this is a later document    send it
--
-- A plain resend of the same deed still has delivered_at after issued_at, so
-- it is still refused without the flag, which is the rule Matt asked for.
-- ===========================================================================

create or replace function public.send_deed_to_agent(
  p_app uuid, p_recipient_email text default null, p_save_contact boolean default false,
  p_resend boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare a public.applications; r text; owned boolean;
        v_emails text[]; v_names text[]; v_primary text; v_primary_name text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where id = p_app;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := coalesce(a.referrer_id = auth.uid(), false);
  if not coalesce((public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_application_org(a.partner_id, a.agency_id, a.branch_id))
          or (r = 'referrer'   and owned)), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not coalesce(public.can_send_deed(r, owned), false) then
    raise exception 'send not permitted for this role' using errcode = '42501';
  end if;
  if a.status <> 'deed' then raise exception 'deed not yet issued'; end if;
  if r = 'referrer' and (p_recipient_email is not null or p_save_contact) then
    raise exception 'referrers may only send to the resolved contact and cannot save contacts' using errcode = '42501';
  end if;
  if p_recipient_email is not null and p_recipient_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Invalid recipient email' using errcode = '22023';
  end if;

  /* ONE DELIVERY PER SIGNED DEED, AND A CORRECTED DEED IS A DIFFERENT DEED.
     The clause that matters is the comparison: a deed delivered after it was
     issued has already gone out, and one issued after the last delivery is a
     later document that has not. */
  if a.deed_delivered_at is not null
     and coalesce(a.deed_issued_at, a.deed_delivered_at) <= a.deed_delivered_at
     and not coalesce(p_resend, false)
     and p_recipient_email is null then
    raise exception 'This deed already went to % on %. Confirm a resend to send it again.',
      coalesce(a.deed_delivered_to, a.delivery_attempted_to, 'the agent'),
      to_char(a.deed_delivered_at at time zone 'Europe/London', 'DD Mon YYYY at HH24:MI')
      using errcode = '22023';
  end if;

  select array_agg(t.email order by case t.source when 'referrer' then 1 when 'copy' then 2 else 3 end, t.email),
         array_agg(coalesce(t.display_name, t.email) order by case t.source when 'referrer' then 1 when 'copy' then 2 else 3 end, t.email)
    into v_emails, v_names
    from public.deed_delivery_target(p_app) t
   where coalesce(btrim(t.email), '') <> '';

  v_primary      := (v_emails)[1];
  v_primary_name := (v_names)[1];

  return jsonb_build_object(
    'sent_to',          coalesce(p_recipient_email, v_primary),
    'recipients',       case when p_recipient_email is not null
                             then to_jsonb(array[p_recipient_email])
                             else coalesce(to_jsonb(v_emails), '[]'::jsonb) end,
    'resolved_contact', v_primary,
    'resolved_name',    v_primary_name);
end $function$;

revoke all on function public.send_deed_to_agent(uuid, text, boolean, boolean) from public, anon;
grant execute on function public.send_deed_to_agent(uuid, text, boolean, boolean) to authenticated, service_role;

comment on function public.send_deed_to_agent(uuid, text, boolean, boolean) is
  'Authorise and resolve a manual send of the signed deed. Refuses a second send of the SAME deed unless p_resend says the caller has read when it last went; a deed issued after the last delivery is a different document (a tenancy-start correction reissues one) and goes out without asking.';
