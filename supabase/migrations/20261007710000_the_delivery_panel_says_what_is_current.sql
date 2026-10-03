/* =====================================================================
   THE DELIVERY PANEL SAYS WHAT IS HAPPENING NOW.

   Matt, 2026-10-03, on GR-23853: "Delivery panel: after a start-date
   correction it still shows the old deed's delivery ('Delivered to
   joe@joe.com, 1 Oct 20:21') while the corrected deed is unsigned. Show
   the current deed's state ('Corrected deed awaiting the tenant's
   signature; it will be sent to joe@joe.com once signed'), with the
   earlier delivery listed as superseded."

   HALF OF THIS IS ALREADY DONE. 20261007640000 made a correction MOVE
   the delivery into `deed_delivery_superseded_at/_to`, so the panel no
   longer claims a delivery of an archived PDF: `delivered_at` is null
   and the state falls to `not_attempted`. What it then says is "Goes
   to: ...", which is true and tells the reader nothing about why the
   delivery they remember has vanished.

   SO THE PANEL NEEDS TWO FACTS IT COULD NOT SEE: which deed is current
   (`deed_state`, to tell "awaiting the tenant's signature" from "there
   is no deed yet") and the delivery that was superseded. Both are
   columns that already exist; this is the caller-scoped face of them.

   DROP AND RECREATE, because the return type gains columns and CREATE
   OR REPLACE cannot widen one. The grants are re-stated below for the
   same reason: a dropped function takes them with it, and
   definer_grants.test.sql would catch the omission a moment later.
   ===================================================================== */
drop function if exists public.my_application_delivery(uuid);

CREATE OR REPLACE FUNCTION public.my_application_delivery(p_app uuid)
 returns table(state text, to_email text, to_name text, source text, auto_send boolean,
              attempted_to text, attempted_source text, failed_at timestamptz, reason text,
              sent_at timestamptz, held boolean, delivered_at timestamptz, delivered_to text,
              resent_at timestamptz,
              /* THE DEED THAT IS CURRENT, so the panel can say what is
                 happening now rather than only what happened last. */
              deed_state text,
              /* AND THE DELIVERY A CORRECTION SUPERSEDED, which really
                 happened and which the agent still holds. */
              superseded_at timestamptz, superseded_to text)
language plpgsql stable security definer set search_path = '' as $$
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
    a.deed_delivered_at, a.deed_delivered_to, a.deed_resent_at,
    a.deed_state::text, a.deed_delivery_superseded_at, a.deed_delivery_superseded_to
  from (select 1) one
  left join lateral public.deed_delivery_target(p_app) t on true;
end $$;

revoke all on function public.my_application_delivery(uuid) from public, anon;
grant execute on function public.my_application_delivery(uuid) to authenticated, service_role;
