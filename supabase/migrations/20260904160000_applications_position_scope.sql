-- Enforce the position ladder on APPLICATIONS at the RLS boundary (and in every
-- SECURITY DEFINER RPC that bypasses RLS), not only in the client.
--
-- THE LEAK. Under a shared partner (several competing agencies on one partner_id)
-- a scoped 'management' user saw every agency's applications. applications_select
-- had an UNCONDITIONAL management arm with the scope merely OR'd on top, so a
-- position could only ADD rows, never narrow. This converts the management arm to
-- the org-tables CASE (mirrors agencies_select/branches_select, 20260813040000):
--   when app_has_scope() then branch_id in app_scope_branches() else whole partner.
--
-- One policy fix cascades: the applications list, application detail, dashboard
-- KPIs/breakdowns and exports all descend from the same RLS read, and
-- activity_log_select / app_notes_select / application_documents_select nest a
-- subquery over applications, so they re-apply this policy automatically. The
-- SECURITY DEFINER RPCs below bypass RLS and are each scoped in their own body.
--
-- PRESERVED byte-for-byte for the unscoped world: is_admin (all), referrer (own),
-- developer (whole partner), and UNSCOPED management (whole partner, the CASE
-- ELSE). The Rightmove referral path is untouched (create_referral* are definer
-- and return the row directly; no trigger reads applications_select). Additive:
-- new policy/function versions only, no column/state/table change. Dev only.
--
-- NOTE the assertion strategy: the earlier scope migrations proved "unchanged" by
-- relying on user_scopes being empty; it no longer is (positions exist on dev), so
-- this migration guards STRUCTURALLY (the preserved arms and the scope helper are
-- present) and the change is verified end-to-end by impersonation after apply.

-- ---- applications_select: fold the scope into a CASE on the management arm ----
drop policy if exists applications_select on public.applications;
create policy applications_select on public.applications for select to authenticated
using (
  public.is_admin()
  or (public.app_role() = 'referrer'  and referrer_id = auth.uid())
  or (public.app_role() = 'developer' and partner_id = public.app_partner())
  or (
    public.app_role() = 'management'
    and partner_id = public.app_partner()
    and (case when public.app_has_scope()
              then branch_id in (select public.app_scope_branches())
              else true end)
  )
);

do $$
declare q text := pg_get_expr(
  (select polqual from pg_policy where polname = 'applications_select'),
  'public.applications'::regclass);
begin
  if q not like '%is_admin%' or q not like '%referrer%' or q not like '%developer%'
     or q not like '%app_scope_branches%' then
    raise exception 'applications_select is missing a preserved arm or the scope: %', q;
  end if;
end $$;

-- ---- application_commission_rates: dashboard commission + a competitor-id
--      enumeration primitive; scope its management arm ----
create or replace function public.application_commission_rates(p_partner uuid default null)
 returns table(application_id uuid, partner_rate numeric, agent_rate numeric)
 language sql stable security definer set search_path to ''
as $function$
  select a.id, a.partner_rate, a.agent_rate
  from public.applications a
  where public.is_aal2()
    and a.livemode
    and (
      public.is_admin()
      or (public.app_role() = 'management' and a.partner_id = public.app_partner()
          and (case when public.app_has_scope()
                    then a.branch_id in (select public.app_scope_branches())
                    else true end))
    )
    and (p_partner is null or a.partner_id = p_partner);
$function$;

-- ---- staff_payment_page_token: mints a live /pay link by ref; a scoped manager
--      must not mint one for a sibling agency's application ----
create or replace function public.staff_payment_page_token(p_ref text)
 returns uuid
 language plpgsql security definer set search_path to ''
as $function$
declare v_app public.applications; v_token uuid;
begin
  select * into v_app from public.applications where guarantee_ref = p_ref;
  if not found then return null; end if;

  if not (public.is_admin()
       or (public.app_role() = 'management' and v_app.partner_id = public.app_partner()
           and (not public.app_has_scope() or v_app.branch_id in (select public.app_scope_branches())))
       or (public.app_role() = 'referrer'   and v_app.referrer_id = auth.uid())) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  insert into public.payment_page_tokens(application_id, guarantee_ref, expires_at)
  values (v_app.id, v_app.guarantee_ref, now() + interval '90 days')
  on conflict (application_id) do update set expires_at = excluded.expires_at
  returning token into v_token;
  return v_token;
end $function$;

-- ---- add_application_note: scope its management arm ----
create or replace function public.add_application_note(p_ref text, p_body text)
 returns app_notes
 language plpgsql security definer set search_path to ''
as $function$
declare a public.applications; r text; owned boolean; b text; n public.app_notes;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not found then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := a.referrer_id = auth.uid();
  if not (public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and (not public.app_has_scope() or a.branch_id in (select public.app_scope_branches())))
          or (r = 'referrer' and owned)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  b := btrim(coalesce(p_body, ''));
  if b = '' then raise exception 'A note cannot be empty.' using errcode = '22023'; end if;
  insert into public.app_notes(application_id, body, author, author_id)
  values (a.id, left(b, 2000), (select full_name from public.users where id = auth.uid()), auth.uid())
  returning * into n;
  return n;
end $function$;

-- ---- mark_withdrawn: scope its management arm ----
create or replace function public.mark_withdrawn(p_ref text, p_reason text, p_note text)
 returns applications
 language plpgsql security definer set search_path to ''
as $function$
declare a public.applications; r text; owned boolean; who text; lbl text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not found then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := a.referrer_id = auth.uid();
  if not (public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and (not public.app_has_scope() or a.branch_id in (select public.app_scope_branches())))
          or (r = 'referrer' and owned)) then
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
  who := coalesce((select full_name from public.users where id = auth.uid()), 'a user');
  lbl := case p_reason
           when 'another_guarantor' then 'tenant found another guarantor'
           when 'tenancy_fell_through' then 'tenancy fell through'
           when 'duplicate' then 'duplicate referral'
           else 'other' end;
  insert into public.activity_log(application_id, kind, message, actor, visibility)
  values (a.id, 'withdrawn',
    'Application withdrawn (' || lbl || ')' || case when a.withdrawn_note is not null then ': ' || a.withdrawn_note else '' end || '.',
    who, 'business');
  return a;
end $function$;

-- ---- amend_tenancy_start: scope its management arm (invoked under the caller's
--      JWT from the amend-tenancy-start Edge Function, so auth.uid() resolves) ----
create or replace function public.amend_tenancy_start(p_app uuid, p_new_start date)
 returns applications
 language plpgsql security definer set search_path to ''
as $function$
declare a public.applications; r text; owned boolean;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_new_start is null then raise exception 'A new tenancy start date is required' using errcode = '22023'; end if;
  if p_new_start < date '2000-01-01' or p_new_start > (current_date + interval '5 years')::date then
    raise exception 'Tenancy start date is out of range' using errcode = '22023';
  end if;
  select * into a from public.applications where id = p_app;
  if not found then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := a.referrer_id = auth.uid();
  if not (public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and (not public.app_has_scope() or a.branch_id in (select public.app_scope_branches())))
          or (r = 'referrer'   and owned)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not public.can_amend_tenancy_start(r, a.status, owned, a.deed_state) then
    raise exception 'amend not permitted for this role and status' using errcode = '42501';
  end if;
  -- Date only. expiry_date is generated from tenancy_start; the deed lifecycle is
  -- handled by the amend-tenancy-start Edge Function, not here.
  update public.applications set tenancy_start = p_new_start where id = p_app returning * into a;
  return a;
end $function$;

-- ---- send_deed_to_agent: scope its management arm (invoked under the caller's
--      JWT from the send-deed-to-agent Edge Function) ----
create or replace function public.send_deed_to_agent(p_app uuid, p_recipient_email text default null, p_save_contact boolean default false)
 returns jsonb
 language plpgsql security definer set search_path to ''
as $function$
declare a public.applications; r text; owned boolean; eff public.agent_contacts; recipient text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where id = p_app;
  if not found then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := a.referrer_id = auth.uid();
  if not (public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and (not public.app_has_scope() or a.branch_id in (select public.app_scope_branches())))
          or (r = 'referrer'   and owned)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not public.can_send_deed(r, owned) then
    raise exception 'send not permitted for this role' using errcode = '42501';
  end if;
  if a.status <> 'deed' then raise exception 'deed not yet issued'; end if;
  if r = 'referrer' and (p_recipient_email is not null or p_save_contact) then
    raise exception 'referrers may only send to the resolved contact and cannot save contacts' using errcode = '42501';
  end if;
  if p_recipient_email is not null and p_recipient_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Invalid recipient email' using errcode = '22023';
  end if;
  select * into eff from public.effective_primary_contact(a.branch_id);
  recipient := coalesce(p_recipient_email, eff.email);
  return jsonb_build_object('sent_to', recipient, 'resolved_contact', eff.email, 'resolved_name', eff.name);
end $function$;
