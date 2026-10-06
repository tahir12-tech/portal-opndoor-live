-- THE DEED GOES TO EVERYONE THE RULE NAMES.
--
-- The rule, stated: on an agency referral the executed deed goes to the user
-- who sent it AND to every user ticked "Receives notifications" whose
-- position covers the referral, as one send with each as a recipient, the
-- same as every other per-application notification.
--
-- agency_notification_recipients has always returned exactly that list, and
-- it is what expiry-reminders and renewal-notices send to. deed_delivery_target
-- then read it like this:
--
--   left join lateral (
--     select r.email, r.display_name, r.rung
--       from public.agency_notification_recipients(a.id) r
--      order by case r.rung when 'referrer' then 1 when 'copy' then 2 else 3 end, r.email
--      limit 1                                    <-- here
--   ) nr on true
--
-- So the deed, the one notification that carries the signed instrument, went
-- to a single address while every lesser notification went to the whole
-- ladder. A Director who ticked themselves got the expiry reminder and the
-- renewal notice and not the deed.
--
-- The limit was not a mistake about the rule. It was a consequence of the
-- function's shape: it returns "the target", singular, and three of its four
-- rungs genuinely are single addresses. The fix is to let the agency rail
-- return as many rows as the ladder has, and leave the other rails returning
-- one, because on those rails there IS one contact.
--
-- FALLBACKS UNCHANGED. agency_notification_recipients already emits the
-- branch-manager rung only when the referrer and the ticked users are both
-- empty, so a deactivated referrer still falls to the ticked users in scope,
-- then to an active manager covering the branch, then to nothing, which parks
-- and alerts. None of that is touched here: this reads the same ladder, it
-- just stops throwing away all but the first row of it.
--
-- auto_send and verified stay per-APPLICATION, repeated on each row. They
-- answer "may this be sent automatically" and "did the tenant verify this
-- address", and neither is a property of an individual recipient.
create or replace function public.deed_delivery_target(p_application uuid)
returns table(email text, display_name text, source text, verified boolean, auto_send boolean)
language sql stable security definer set search_path to ''
as $function$
  with a as (
    select * from public.applications where id = p_application
  ),
  ch as (
    select public.application_channel((select id from a)) as channel
  ),
  -- THE WHOLE LADDER, in rung order. No limit.
  nr as (
    select r.email, r.display_name, r.rung,
           case r.rung when 'referrer' then 1 when 'copy' then 2 else 3 end as pri
      from public.agency_notification_recipients((select id from a)) r
  ),
  d as (
    select * from public.application_delivery_contacts
     where application_id = (select id from a)
  ),
  rc as (
    select * from public.effective_primary_contact_route(
      (select branch_id from a), (select partner_id from a))
  ),
  c as (
    select * from public.effective_primary_contact((select branch_id from a))
  ),
  -- auto_send is a property of the application, so it is computed once.
  gate as (
    select (select channel from ch) <> 'Agent referral' or exists (select 1 from nr) as auto_send
  )
  -- THE AGENCY RAIL: one row per person on the ladder.
  select nr.email, nr.display_name, nr.rung,
         true,
         (select auto_send from gate)
    from nr
   where (select channel from ch) = 'Agent referral'

  union all

  -- EVERY OTHER RAIL, and the agency rail when the ladder is empty: the single
  -- contact, exactly as before. Direct stops at the tenant's own nominated
  -- contact and never reaches the route or branch mailbox.
  select
    case when (select channel from ch) = 'Direct'
         then (select email from d)
         else coalesce((select email from d), (select email from rc), (select email from c)) end,
    coalesce(
      nullif(btrim(coalesce((select agency_name from d), '')), ''),
      nullif(btrim(coalesce((select first_name from d), '') || ' ' || coalesce((select last_name from d), '')), ''),
      case when (select channel from ch) = 'Direct' then null
           else coalesce((select name from rc), (select name from c)) end
    ),
    case
      when (select application_id from d) is not null then 'delivery_contact'
      when (select channel from ch) = 'Direct' then 'delivery_contact'
      when (select id from rc) is not null then 'route_contact'
      else 'branch_contact'
    end,
    case when (select application_id from d) is not null
         then (select verified_at from d) is not null
         else true end,
    (select auto_send from gate)
  where not ((select channel from ch) = 'Agent referral' and exists (select 1 from nr))
$function$;

comment on function public.deed_delivery_target(uuid) is
  'Everyone the executed deed goes to. On the agency rail that is the whole notification ladder -- the referrer and every ticked user whose position covers the referral -- one row each, because the deed is a per-application notification like any other. On the supplier and direct rails it is the single contact those rails have. It used to take limit 1 off the ladder, so the ticked users received every notification except the one that mattered.';

-- ===========================================================================
-- AND THE MANUAL BUTTON SENDS TO THE SAME PEOPLE
-- ===========================================================================
-- send_deed_to_agent existed to stop the button and the webhook diverging, so
-- it has to follow the resolver into the plural. `select ... into` would take
-- an arbitrary row and silently drop the rest.
create or replace function public.send_deed_to_agent(p_app uuid, p_recipient_email text default null::text, p_save_contact boolean default false)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare a public.applications; r text; owned boolean;
        v_emails text[]; v_names text[]; v_primary text; v_primary_name text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where id = p_app;
  if not found then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := a.referrer_id = auth.uid();
  if not (public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_application_org(a.partner_id, a.agency_id, a.branch_id))
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

  -- THE WHOLE LIST, ordered so the referrer is first and is what a one-line
  -- "sent to" says when the screen has room for one name.
  select array_agg(t.email order by case t.source when 'referrer' then 1 when 'copy' then 2 else 3 end, t.email),
         array_agg(coalesce(t.display_name, t.email) order by case t.source when 'referrer' then 1 when 'copy' then 2 else 3 end, t.email)
    into v_emails, v_names
    from public.deed_delivery_target(p_app) t
   where coalesce(btrim(t.email), '') <> '';

  v_primary      := (v_emails)[1];
  v_primary_name := (v_names)[1];

  -- An override addresses the send to one person and does NOT silence the
  -- ladder's own answer, which the screen still shows as "resolved to".
  return jsonb_build_object(
    'sent_to',          coalesce(p_recipient_email, v_primary),
    'recipients',       case when p_recipient_email is not null
                             then to_jsonb(array[p_recipient_email])
                             else coalesce(to_jsonb(v_emails), '[]'::jsonb) end,
    'resolved_contact', v_primary,
    'resolved_name',    v_primary_name);
end $function$;
