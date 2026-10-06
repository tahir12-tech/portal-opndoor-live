-- ===========================================================================
-- ONE DELIVERY PER SIGNED DEED, AND THE PANEL SAYS WHEN IT WENT.
--
-- Matt, 2026-10-01, verbatim: "On GR-20846: the activity shows 'Deed of
-- Guarantee delivered to the agent' twice (16:49 and 16:51), and the Delivery
-- panel says the deed was sent at 16:45, before the tenant signed at 16:49.
-- Find why the signed deed was emailed to the agent twice and stop duplicates
-- (one delivery per signed deed unless someone presses Resend), and make the
-- Delivery panel show the time and recipients of the actual signed-deed
-- email."
--
-- ===========================================================================
-- WHAT GR-20846 ACTUALLY DID, FROM THE ACTIVITY LOG
-- ===========================================================================
--
--   15:45:41  payment_received
--   15:45:47  deed_sent         Deed of Guarantee sent FOR SIGNATURE
--   15:49:06  deed_signed       the tenant signs
--   15:49:09  deed_delivered    Deed sent to manager@regent.dev.test, automatic
--   15:51:05  deed_delivered    Deed sent to manager@regent.dev.test, by Tom Reeve
--
-- So the two sends are the automatic one on signature and a manual one two
-- minutes later. And the panel said the deed was "Sent 15:45:47", because
-- `my_application_delivery` returned `deed_sent_at` -- which is when the deed
-- went to the TENANT to be signed, four minutes before anybody signed it.
--
-- That is not two faults, it is one fault and its consequence. Nothing
-- recorded when the signed deed was delivered, so the panel answered with the
-- only timestamp it had; the figure it showed was earlier than the signature,
-- so it read as stale, and the obvious thing to do looking at it is press
-- Resend. The screen invited the duplicate.
--
-- ===========================================================================
-- WHAT THIS MIGRATION ADDS
-- ===========================================================================
--
--   deed_delivered_at    the FIRST successful delivery of the signed deed
--   deed_delivered_to    who that email actually addressed, all of them
--   deed_resent_at       the most recent successful delivery after the first
--
-- Three columns and three meanings, rather than one column that has to be
-- "first or last depending on who is asking". "One delivery per signed deed"
-- is then a question the database can answer: deed_delivered_at is set.
--
-- The guard goes in `send_deed_to_agent`, which every manual send passes
-- through: a second send is refused unless the caller says it is a resend,
-- and the refusal names when and to whom the deed went. The webhook's
-- automatic path gets the same rule in the function, so a PandaDoc redelivery
-- of document_completed cannot send a second copy either.
--
-- NOT A UNIQUENESS CONSTRAINT. A resend is legitimate and common -- the
-- address was wrong, the agent lost it, the first one bounced -- so the rule
-- is "not by accident", not "never again".
-- ===========================================================================

alter table public.applications
  add column if not exists deed_delivered_at timestamptz,
  add column if not exists deed_delivered_to text,
  add column if not exists deed_resent_at timestamptz;

comment on column public.applications.deed_delivered_at is
  'When the SIGNED deed was first successfully emailed to the agent. Not deed_sent_at, which is when the deed went to the tenant to be signed: the Delivery panel showed that one and so claimed a delivery four minutes before the signature.';
comment on column public.applications.deed_delivered_to is
  'Every address that first delivery was sent to, comma separated. The deed goes to the referrer and their copies in one email, so a single "sent to" is only ever part of the answer.';
comment on column public.applications.deed_resent_at is
  'The most recent successful delivery AFTER the first. Null on a deed that has gone out exactly once, which is what it should be.';

-- ---------------------------------------------------------------------------
-- 1. WHAT ALREADY HAPPENED, RECOVERED FROM THE ACTIVITY LOG
-- ---------------------------------------------------------------------------
-- Every delivery since the feature existed wrote "Deed sent to <addresses> ·
-- <mode>" as a business entry, so the history is readable even though nothing
-- was writing it to the row. Without this the panel would say "not recorded"
-- for every deed already delivered, including the two Matt is looking at.
with d as (
  select al.application_id,
         al.at,
         btrim(split_part(substring(al.message from 'Deed sent to (.*)$'), ' · ', 1)) as who,
         row_number() over (partition by al.application_id order by al.at) as n,
         count(*)    over (partition by al.application_id)                 as sends,
         max(al.at)  over (partition by al.application_id)                 as last_at
  from public.activity_log al
  where al.kind = 'deed_delivered'
    and al.message like 'Deed sent to %'
)
update public.applications a
   set deed_delivered_at = d.at,
       deed_delivered_to = nullif(d.who, ''),
       deed_resent_at    = case when d.sends > 1 then d.last_at end
  from d
 where d.application_id = a.id
   and d.n = 1
   and a.deed_delivered_at is null;

-- ---------------------------------------------------------------------------
-- 2. THE SEND IS WRITTEN DOWN WHEN IT HAPPENS
-- ---------------------------------------------------------------------------
-- Dropped and recreated rather than given a defaulted sixth argument: a
-- five-argument call would then match both signatures and Postgres refuses it
-- as ambiguous. Both callers are edge functions and both are updated with it.
drop function if exists public.record_delivery_attempt(uuid, boolean, text, text, text);

create or replace function public.record_delivery_attempt(
  p_app uuid, p_ok boolean, p_to text, p_source text, p_reason text default null,
  /* Everyone the email addressed. `p_to` is the primary contact; the deed goes
     to them and their copies in one message, and "sent to" that names one of
     four is the kind of half-answer this panel exists to stop. */
  p_recipients text default null
)
returns void
language plpgsql security definer set search_path to ''
as $function$
begin
  if p_ok then
    -- A success CLEARS the failure and the queue both. The address is kept: it
    -- is the answer to "where did it go", which is asked far more often than
    -- "why did it not".
    update public.applications
       set delivery_attempted_to = p_to,
           delivery_source       = p_source,
           delivery_failed_at    = null,
           delivery_reason       = null,
           awaiting_staff_send   = false,
           /* FIRST ONE WINS, and every one after it is a resend. The column
              is what "one delivery per signed deed" is checked against, so a
              later send must not quietly become the first. */
           deed_delivered_at     = coalesce(deed_delivered_at, now()),
           deed_delivered_to     = coalesce(deed_delivered_to, nullif(coalesce(p_recipients, p_to), '')),
           deed_resent_at        = case when deed_delivered_at is not null then now() else deed_resent_at end
     where id = p_app;
  else
    update public.applications
       set delivery_attempted_to = coalesce(p_to, delivery_attempted_to),
           delivery_source       = coalesce(p_source, delivery_source),
           delivery_failed_at    = now(),
           delivery_reason       = p_reason
     where id = p_app;
  end if;
end $function$;

revoke all on function public.record_delivery_attempt(uuid, boolean, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_delivery_attempt(uuid, boolean, text, text, text, text) to service_role;

comment on function public.record_delivery_attempt(uuid, boolean, text, text, text, text) is
  'Write down one attempt to deliver the signed deed. On success it stamps the first delivery and, on any later success, the resend, so "has this deed been delivered" and "when did it last go" are different questions with different answers.';

-- ---------------------------------------------------------------------------
-- 3. A SECOND SEND HAS TO SAY IT IS ONE
-- ---------------------------------------------------------------------------
-- Same reason for the drop: p_resend has a default, so the three-argument call
-- the edge function makes today would be ambiguous against the old signature.
drop function if exists public.send_deed_to_agent(uuid, text, boolean);

create or replace function public.send_deed_to_agent(
  p_app uuid, p_recipient_email text default null, p_save_contact boolean default false,
  /* The caller has read "this already went to X on <date>" and meant it. */
  p_resend boolean default false
)
returns jsonb
language plpgsql security definer set search_path to ''
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

  /* ONE DELIVERY PER SIGNED DEED. The screen knows what it is about to repeat
     and asks; this is the rule underneath, so a second copy cannot be sent by
     a caller that does not ask -- including a webhook replaying a completion
     it has already delivered. An overridden address is a different send to a
     different person and is not caught by this. */
  if a.deed_delivered_at is not null and not coalesce(p_resend, false)
     and p_recipient_email is null then
    raise exception 'This deed already went to % on %. Confirm a resend to send it again.',
      coalesce(a.deed_delivered_to, a.delivery_attempted_to, 'the agent'),
      to_char(a.deed_delivered_at at time zone 'Europe/London', 'DD Mon YYYY at HH24:MI')
      using errcode = '22023';
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

revoke all on function public.send_deed_to_agent(uuid, text, boolean, boolean) from public, anon;
grant execute on function public.send_deed_to_agent(uuid, text, boolean, boolean) to authenticated, service_role;

comment on function public.send_deed_to_agent(uuid, text, boolean, boolean) is
  'Authorise and resolve a manual send of the signed deed. Refuses a second send to the resolved contact unless p_resend says the caller has read when it last went: one delivery per signed deed, and a resend is a decision rather than a repeat.';

-- ---------------------------------------------------------------------------
-- 4. AND THE PANEL READS THE DELIVERY, NOT THE SIGNATURE REQUEST
-- ---------------------------------------------------------------------------
drop function if exists public.my_application_delivery(uuid);

create or replace function public.my_application_delivery(p_app uuid)
returns table(
  state text, to_email text, to_name text, source text, auto_send boolean,
  attempted_to text, attempted_source text, failed_at timestamptz, reason text,
  sent_at timestamptz, held boolean,
  /* THE THREE THE PANEL WAS MISSING. `sent_at` stays, because "the deed went
     to the tenant to be signed at" is a real fact the panel may yet want, but
     it is no longer the one labelled "Sent". */
  delivered_at timestamptz, delivered_to text, resent_at timestamptz
)
language plpgsql stable security definer set search_path to ''
as $function$
declare a public.applications; r text; owned boolean;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where id = p_app;
  if not found then return; end if;
  r := public.app_role();
  owned := coalesce(a.referrer_id = auth.uid(), false);
  if not coalesce((public.is_admin()
          or r = 'opndoor_manager'
          or (r in ('management','referrer','developer') and a.partner_id = public.app_partner()
              and public.app_may_reach_branch(a.branch_id))), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if r = 'referrer' and not owned and not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query
  select
    case
      when a.delivery_failed_at is not null then 'failed'
      when a.awaiting_staff_send            then 'cannot_deliver'
      /* DELIVERED MEANS THE SIGNED DEED WENT, which is deed_delivered_at.
         It read deed_sent_at, so an application whose deed was out for
         signature and had been delivered to nobody showed as delivered. */
      when a.deed_delivered_at is not null  then 'delivered'
      else 'not_attempted'
    end,
    t.email, t.display_name, t.source, t.auto_send,
    a.delivery_attempted_to, a.delivery_source, a.delivery_failed_at, a.delivery_reason,
    a.deed_sent_at, a.awaiting_staff_send,
    a.deed_delivered_at, a.deed_delivered_to, a.deed_resent_at
  from (select 1) one
  left join lateral public.deed_delivery_target(p_app) t on true;
end $function$;

revoke all on function public.my_application_delivery(uuid) from public, anon;
grant execute on function public.my_application_delivery(uuid) to authenticated, service_role;

comment on function public.my_application_delivery(uuid) is
  'Where this application''s signed deed goes, where it went, and when it actually went. "Delivered" is deed_delivered_at, the signed-deed email to the agent, never deed_sent_at, which is the request for the tenant''s signature and happens before anybody has signed anything.';
