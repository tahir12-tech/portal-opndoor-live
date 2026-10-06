-- THE DEED'S COPIES ARE SWITCHABLE; THE DEED IS NOT.
--
-- Q-03 says the matrix is enforced in the send path, and names one thing that
-- is NOT switchable: "delivery of the executed deed to its recipient".
--
-- deed_delivery_target is the one resolver every deed send asks -- the
-- PandaDoc completion webhook, the manual "Send deed to agent", and every
-- reissue -- so the matrix is applied here rather than in any of them. A rule
-- applied in the caller is a rule the other caller forgets, and there are
-- three callers.
--
-- The locked half needs no special case in this file: notification_enabled
-- already answers TRUE for a locked cell whatever a stored row says, and
-- set_notification_setting already refuses to write one. On the agency rail
-- the locked cell is deed_issued to the REFERRER, which is the rung this
-- function has always put first. The copies -- the users ticked "Receives
-- notifications" whose position covers the referral -- are the switchable
-- half, and this is where switching them off takes effect.
--
-- The other two rails are untouched. A supplier's single resolved contact IS
-- the deed's recipient there and is locked; a direct tenant's nominated
-- contact is not an agent-facing party at all.

CREATE OR REPLACE FUNCTION public.deed_delivery_target(p_application uuid)
 RETURNS TABLE(email text, display_name text, source text, verified boolean, auto_send boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- THE AGENCY RAIL: one row per person on the ladder, FILTERED BY THE
  -- MATRIX. Q-03. The deed to its own recipient is a locked cell -- the
  -- referrer rung on this rail -- so notification_enabled answers true for it
  -- whatever any stored row says, and set_notification_setting refuses to
  -- turn it off. The COPIES are the switchable half: an agency that does not
  -- want its ticked users copied on the executed instrument can say so, and
  -- this is where that takes effect. Applied here rather than in the caller
  -- because deed_delivery_target is the one thing every deed send asks, and a
  -- rule applied in the caller is a rule the other caller forgets.
  select nr.email, nr.display_name, nr.rung,
         true,
         (select auto_send from gate)
    from nr
   where (select channel from ch) = 'Agent referral'
     and public.notification_enabled(
           'agency', null, (select agency_id from a), 'deed_issued',
           case when nr.rung = 'referrer' then 'referrer' else 'ticked_users' end)

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
