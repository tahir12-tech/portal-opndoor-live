-- A CHANGE OPNDOOR MADE WAS MADE BY OPNDOOR.
--
-- Matt (bm): "Customer-facing emails and screens: when Opndoor staff make
-- a change (start date, withdrawal, anything), say 'by opndoor', never the
-- staff member's name. Check every email template and activity line shown
-- to agency and supplier users."
--
-- IT IS A PRIVACY RULE AS MUCH AS A COPY ONE. An agency has no business
-- knowing which member of opndoor staff touched their record, and a name
-- invites them to ask for that person next time.
--
-- THE SWEEP, AND WHAT IT FOUND. Every function that writes an activity row
-- a customer can see -- visibility 'business' -- asked against dev, then
-- every one of those that reads a full_name. Two: these. The others log
-- 'System', 'Stripe', 'PandaDoc', 'Tenant' or 'Agent', which name a
-- machine or a side rather than a person.
--
-- AND THE TWO ARE NOT THE SAME RULE, which is the point of doing it by
-- reading rather than by search-and-replace. decline_application is
-- guarded by is_opndoor_staff(), so every caller is us. mark_withdrawn
-- admits an agency's own management and the referrer who owns the
-- referral, so most of its rows are a customer withdrawing their own
-- referral -- and naming that colleague is correct. Replacing the name in
-- both would have taken a customer's own name off their own action.
--
-- The non-SQL half of (bm) is in the same commit: amend-tenancy-start,
-- which feeds the start-date change's two activity lines and the
-- referrer's "the tenancy start date has changed ... by X" email, and the
-- two-factor reset email.

CREATE OR REPLACE FUNCTION public.mark_withdrawn(p_ref text, p_reason text, p_note text)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r text; owned boolean; who text; lbl text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := coalesce(a.referrer_id = auth.uid(), false);
  if not coalesce((public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_branch(a.branch_id))
          or (r = 'referrer' and owned)), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if a.status <> 'sent' then raise exception 'Only an application at Sent (before payment) can be withdrawn.' using errcode = '42501'; end if;
  if p_reason not in ('another_guarantor','tenancy_fell_through','duplicate','other') then
    raise exception 'Invalid withdrawal reason' using errcode = '22023';
  end if;
  if p_reason = 'other' and coalesce(btrim(p_note), '') = '' then
    raise exception 'A note is required when the reason is Other.' using errcode = '22023';
  end if;
  update public.applications
    set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = p_reason,
        withdrawn_note = nullif(btrim(coalesce(p_note,'')), ''), withdrawn_by = auth.uid()
    where id = a.id returning * into a;
  /* (bm) "BY OPNDOOR", NEVER THE STAFF MEMBER'S NAME -- but only when it
     WAS us. mark_withdrawn admits an admin, an agency's own management
     over a branch they reach, and the referrer who owns the referral, so
     most withdrawals are a customer withdrawing their own. Naming a
     colleague is right there; naming one of us is not. */
  who := case when coalesce(public.is_opndoor_staff(), false) then 'opndoor'
              else coalesce((select full_name from public.users where id = auth.uid()), 'a user') end;
  lbl := case p_reason
           when 'another_guarantor' then 'tenant found another guarantor'
           when 'tenancy_fell_through' then 'tenancy fell through'
           when 'duplicate' then 'duplicate referral'
           else 'other' end;
  insert into public.activity_log(application_id, kind, message, actor, visibility)
  values (a.id, 'withdrawn',
    'Application withdrawn (' || lbl || ')' || case when a.withdrawn_note is not null then ': ' || a.withdrawn_note else '' end || '.',
    who, 'business');
  return public.rates_for_reader(a);
end $function$;

CREATE OR REPLACE FUNCTION public.decline_application(p_ref text, p_reason text DEFAULT NULL::text)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; who text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  if not coalesce(public.is_opndoor_staff(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if a.status <> 'referencing' then
    raise exception 'Only an application awaiting a decision can be declined.' using errcode = '42501';
  end if;

  update public.applications
    set status = 'declined', decided_at = now(), decided_by_kind = 'staff',
        decline_reason = nullif(btrim(coalesce(p_reason,'')), '')
    where id = a.id returning * into a;

  /* (bm) UNCONDITIONALLY 'opndoor' HERE, unlike mark_withdrawn: the guard
     above is is_opndoor_staff(), so there is no non-opndoor caller to
     name. A coalesce to a person's name would be dead code that reads
     like a live case. */
  who := 'opndoor';
  insert into public.activity_log(application_id, kind, message, actor, visibility)
  values (a.id, 'application_declined',
    'Application declined by opndoor'
      || case when a.decline_reason is not null then ' (' || a.decline_reason || ')' else '' end || '.',
    who, 'business');
  return public.rates_for_reader(a);
end $function$;
