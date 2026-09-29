-- ONE DOOR FOR WHO GETS TOLD.
--
-- Q-03 says the matrix is "enforced in the send path server-side, not by hiding
-- UI". There are six agent-facing send paths and they resolve their recipients
-- six different ways today: the deed asks deed_delivery_target, the expiry
-- reminder asks agency_notification_recipients on one rail and builds a list of
-- partner management on the others, the renewal notice builds a third list, and
-- referrerNotify reads one column. A matrix consulted in six places is a matrix
-- that is missed in one of them.
--
-- So there is one function. Every agent-facing send asks it, by notification
-- type, and gets back the addresses that party's matrix allows. The class each
-- address belongs to comes back with it, so an activity line can still say WHY
-- somebody was on it.
--
-- WHAT IT DOES NOT DO: tenant email. The tenant is not a party to the matrix --
-- Q-03 locks "every email to the tenant" out of it - and tenant sends keep
-- their own direct addressing. Nor ops alerts, for the same reason.
--
-- THE AGENCY RAIL REUSES THE LADDER rather than restating it.
-- agency_notification_recipients already returns the referrer and the ticked
-- users in scope, labelled by rung, and it is what the deed rule of
-- 20261006450000 is written in terms of. Mapping rung -> class here means the
-- matrix filters that list instead of replacing it, so the two cannot drift.

create or replace function public.notification_recipients(p_application uuid, p_type text)
returns table(email text, display_name text, recipient_class text)
language plpgsql stable security definer set search_path to '' as $function$
declare v_kind text; v_partner uuid; v_agency uuid; a public.applications;
begin
  if not exists (select 1 from public.notification_types() t where t.notification_type = p_type) then
    raise exception 'There is no such notification.' using errcode = '22023';
  end if;

  select * into a from public.applications where id = p_application;
  if not found then return; end if;

  select np.kind, np.partner_id, np.agency_id into v_kind, v_partner, v_agency
  from public.notification_party(p_application) np;

  -- The direct rail has no agent-facing party. A direct tenant's deed goes to
  -- the contact THEY named, which deed_delivery_target still resolves on its
  -- own; nothing here invents an agency for them.
  if v_kind = 'direct' then return; end if;

  if v_kind = 'agency' then
    return query
      select r.email, r.display_name,
             case when r.rung = 'referrer' then 'referrer' else 'ticked_users' end
        from public.agency_notification_recipients(p_application) r
       where public.notification_enabled(
               'agency', null, v_agency, p_type,
               case when r.rung = 'referrer' then 'referrer' else 'ticked_users' end);
    return;
  end if;

  -- SUPPLIER. The referrer is a real user row on this rail (attribution is NOT
  -- NULL off the house route), except where the referral came through an API
  -- key with no human attached -- which is the case Q-02's last sentence is
  -- about, and why the agent contact is resolved independently rather than as
  -- a fallback.
  return query
    select u.email, u.full_name, 'referrer'::text
      from public.users u
     where u.id = a.referrer_id
       and u.status = 'active'
       and public.notification_enabled('supplier', v_partner, null, p_type, 'referrer');

  return query
    select c.email, c.name, 'agent_contact'::text
      from public.effective_primary_contact_route(a.branch_id, a.partner_id) c
     where c.email is not null
       and public.notification_enabled('supplier', v_partner, null, p_type, 'agent_contact');
end $function$;

comment on function public.notification_recipients(uuid, text) is
  'The one door: every agent-facing send asks this, by notification type, and '
  'gets the addresses that party''s matrix allows. Tenant email and ops alerts '
  'are not in it -- Q-03 locks them out of the matrix -- and keep their own '
  'addressing.';

revoke all on function public.notification_recipients(uuid, text) from public, anon;
grant execute on function public.notification_recipients(uuid, text) to authenticated, service_role;
