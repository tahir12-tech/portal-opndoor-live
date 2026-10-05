/* =====================================================================
   (zz) THE INVITE ALREADY KNOWS THE TENANT'S NAME. IT WAS NOT SAYING.

   Matt: "when a referred tenant opens their invite, prefill the account
   form with the name, email and mobile from the referral (editable),
   and skip asking again for property details the referral already
   holds."

   THE PROPERTY HALF IS ALREADY DONE, and in a stronger form than
   "skip": an invited application shows the property, rent and share the
   agent set, locked, with the tenancy start left editable. Apply.tsx
   says so on the screen.

   THE NAME HALF WAS NOT. tenant_invite_summary returns the email and
   the property; the register form at /apply/register starts empty, so a
   tenant whose agent has just typed their name and mobile into a
   referral types both again on the next screen.

   EDITABLE, NOT FIXED, which is Matt's word and the reason this is a
   PREFILL rather than more locked fields: the referral's record of a
   tenant's mobile is the agent's typing, and the tenant is the one who
   knows. The property is the agent's to state; the person's own name
   and number are not.

   THE TOKEN IS THE SECRET, as it already is for the email and the
   property address this function returns, and it was emailed to the
   person whose name and number these are. Nothing here widens who can
   ask: it widens what the same question answers, about the same person,
   to the same holder of the same link.
   ===================================================================== */

/* DROPPED FIRST: three columns are added to the returned row type, and
   Postgres will not change an OUT parameter list through CREATE OR REPLACE. */
drop function if exists public.tenant_invite_summary(uuid);

create or replace function public.tenant_invite_summary(p_token uuid)
returns table(valid boolean, email text, prop_addr1 text, prop_postcode text,
              monthly_rent numeric, tenancy_start date, already_claimed boolean,
              referrer_name text, first_name text, last_name text, phone text)
language sql stable security definer set search_path to ''
as $function$
  select
    i.expires_at > now(),
    i.email,
    a.prop_addr1, a.prop_postcode, a.monthly_rent, a.tenancy_start,
    i.claimed_at is not null,
    -- The agency the referral was filed against. Null is a real answer and the
    -- screen falls back rather than printing an empty gap.
    ag.name,
    /* (zz) WHAT THE AGENT ALREADY TYPED, for the register form to start
       from. Null where the referral did not carry it, which the form
       treats as "ask", not as an empty answer to show back. */
    a.tenant_first_name, a.tenant_last_name, a.tenant_phone
  from public.tenant_invites i
  join public.applications a on a.id = i.application_id
  left join public.agencies ag on ag.id = a.agency_id
  where i.token = p_token
$function$;

revoke all on function public.tenant_invite_summary(uuid) from public, anon;
grant execute on function public.tenant_invite_summary(uuid) to service_role;

comment on function public.tenant_invite_summary(uuid) is
  'What an invite link can tell its holder before they have an account: whether it is still valid, who it was sent to, the property and rent the agent set, and the name and mobile the agent typed, so the register form starts from them rather than asking again. Service role only: the tenant-auth edge function is the one caller, and the token is the secret.';
