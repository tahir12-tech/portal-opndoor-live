-- A STAFF INVITE LASTS SEVEN DAYS, AND SAYS WHEN IT WAS SENT AND WHEN IT ENDS.
--
-- Matt, 2026-10-09: "Build the invite change I asked for earlier (7-day
-- links, Accept invite page, sent date, expiry, resend and cancel)."
--
-- WHY THE SEVEN DAYS CANNOT BE A SETTING, which is the decision this file
-- rests on. An invite link today is GoTrue's own, and its life is
-- `mailer_otp_exp` on the Supabase project: ONE number, shared by invites,
-- password resets and magic links. CUTOVER.md 1.1 asks for 1800 seconds
-- because three places in the reset copy promise 30 minutes. Seven days for
-- an invite and thirty minutes for a reset cannot both come out of one
-- number, so a seven-day invite has to be OUR token, in our own table, with
-- our own page reading it.
--
-- AND IT FIXES THREE THINGS MATT ALREADY REPORTED, which is how I know the
-- shape is right rather than merely longer:
--
--   * "By 11:30 his sign-in account looked brand new ... He then got 'This
--     link is not valid', most likely from clicking an older email." A
--     resend used to leave the first link alive, because an invite writes
--     auth.users.confirmation_token and a resend writes recovery_token, two
--     different columns. One row per person here, regenerated on resend, so
--     there is exactly one live link at a time and the old one is dead.
--   * A link scanner that pre-fetches at delivery used to SPEND the invite,
--     because the email's button was a bare GET on /auth/v1/verify. Our link
--     is a page; redeeming it is a POST the page makes. A scanner fetching
--     it now does nothing at all.
--   * The Team list's sent date came from auth.users.invited_at, which is
--     set once when the account is made and never moves. After a resend it
--     named the wrong day. `sent_at` here is the day the LIVE link was sent.
--
-- WHAT IS NOT CHANGED. The tenant's own 7-day link (tenant_invites,
-- mint_tenant_invite) is untouched, and so is every path a referral takes.
-- This is additive: a new table, two new functions, and three columns added
-- to one read.

-- ---------------------------------------------------------------------------
-- 1. THE TOKEN.
--
-- Deliberately modelled on public.tenant_invites, which has carried the
-- tenant's 7-day link since August: an opaque uuid, an expiry, and a claim
-- stamp. One row per PERSON, because a person has at most one live
-- invitation, and `on conflict (user_id)` is then what makes a resend
-- cancel its predecessor rather than add to it.
-- ---------------------------------------------------------------------------
create table if not exists public.staff_invites (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  -- The address it was SENT to, kept beside the token rather than read back
  -- off the user, so a later email correction cannot silently re-point a
  -- link that is already in somebody's inbox.
  email text not null,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  sent_by uuid references public.users(id) on delete set null,
  claimed_at timestamptz,
  cancelled_at timestamptz,
  constraint staff_invites_expires_after_sending check (expires_at > sent_at)
);

comment on table public.staff_invites is
  'The live invitation for one member of staff: an opaque 7-day token, when it was sent and when it ends. One row per person, replaced on resend, so there is never more than one working link. The portal emails a link to this token rather than a GoTrue action link, because GoTrue''s expiry is one project-wide number shared with password resets.';

create index if not exists staff_invites_user_idx on public.staff_invites (user_id);

alter table public.staff_invites enable row level security;

/* NO POLICY, DELIBERATELY. The token is a credential: holding it is how
   somebody proves an invitation is theirs, so nothing reachable from the
   browser may read this table. The two functions below are definers and are
   granted to service_role only; the Team list reads the DATES through
   list_managed_users, which never returns the token. An admin who needs to
   know the state of an invite can see it; nobody can see the secret. */
revoke all on public.staff_invites from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. MINTING ONE, which is also how a resend cancels the last.
-- ---------------------------------------------------------------------------
create or replace function public.mint_staff_invite(p_user uuid, p_days integer default 7)
returns uuid
language plpgsql security definer set search_path to ''
as $function$
declare v_email text; v_token uuid; v_days integer := coalesce(p_days, 7);
begin
  if v_days < 1 or v_days > 30 then
    raise exception 'A staff invitation lasts between 1 and 30 days.' using errcode = '22023';
  end if;

  select u.email into v_email from public.users u where u.id = p_user;
  if v_email is null or btrim(v_email) = '' then
    raise exception 'There is no portal user % to invite.', p_user using errcode = '22023';
  end if;

  /* ONE ROW PER PERSON. The new token replaces the old one in place, which
     is the whole of "a resend cancels the previous link": there is only ever
     one row, so there is only ever one answer. claimed_at and cancelled_at
     are cleared because this IS a fresh invitation. */
  insert into public.staff_invites (user_id, email, expires_at, sent_by)
  values (p_user, btrim(lower(v_email)), now() + make_interval(days => v_days), auth.uid())
  on conflict (user_id) do update
    set token = gen_random_uuid(),
        email = excluded.email,
        sent_at = now(),
        expires_at = excluded.expires_at,
        sent_by = excluded.sent_by,
        claimed_at = null,
        cancelled_at = null
  returning token into v_token;

  return v_token;
end $function$;

comment on function public.mint_staff_invite(uuid, integer) is
  'Issue the live invitation link for one member of staff and retire any previous one, by replacing the single row that person has. Returns the opaque token the email carries. Service role only: it is called by invite-user, never by a browser.';

revoke all on function public.mint_staff_invite(uuid, integer) from public, anon, authenticated;
grant execute on function public.mint_staff_invite(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. REDEEMING ONE.
--
-- Each refusal has its OWN message, because "this link is not valid" was the
-- sentence Matt spent two days behind: expired, already used, cancelled and
-- never existed are four different things to tell somebody, and only one of
-- them means "ask your administrator for another".
-- ---------------------------------------------------------------------------
create or replace function public.claim_staff_invite(p_token uuid)
returns table(user_id uuid, email text, expires_at timestamptz)
language plpgsql security definer set search_path to ''
as $function$
declare inv public.staff_invites;
begin
  select * into inv from public.staff_invites si where si.token = p_token;
  /* coalesce ON `found`, which guardsAreNullSafe requires of every raising
     guard and which the rest of this codebase writes the same way. A plpgsql
     FOUND is never null after a SELECT INTO; the rule is a blanket one
     precisely so that nobody has to decide that case by case. */
  if not coalesce(found, false) then
    raise exception 'That invitation link is not one we issued.' using errcode = '22023';
  end if;
  if inv.cancelled_at is not null then
    raise exception 'That invitation was cancelled.' using errcode = '22023';
  end if;
  if inv.claimed_at is not null then
    raise exception 'That invitation has already been used.' using errcode = '22023';
  end if;
  if inv.expires_at <= now() then
    raise exception 'That invitation expired on %.', to_char(inv.expires_at, 'FMDD FMMonth YYYY')
      using errcode = '22023';
  end if;

  /* CLAIMED HERE, not by the caller afterwards. The edge function mints a
     short-lived sign-in link straight after this returns, so the two have to
     be one transaction or a failure between them leaves a token that is
     spent and a person who got nothing. */
  update public.staff_invites si set claimed_at = now() where si.token = p_token;

  return query select inv.user_id, inv.email, inv.expires_at;
end $function$;

comment on function public.claim_staff_invite(uuid) is
  'Spend one staff invitation token and say whose it was. Raises a DIFFERENT message for expired, already used, cancelled and never issued, because only one of those means "ask for another". Service role only: accept-invite calls it and then mints the short-lived link that actually signs the person in.';

revoke all on function public.claim_staff_invite(uuid) from public, anon, authenticated;
grant execute on function public.claim_staff_invite(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. THE SENT DATE AND THE EXPIRY, WHERE THE TEAM LIST ALREADY LOOKS.
--
-- Three columns added to the one function all four people screens hydrate
-- from. A different output shape cannot be a CREATE OR REPLACE, so this is a
-- drop and a create, with the grants restated.
--
-- `invited_at` STAYS, unchanged, and still comes from auth.users. It is the
-- day the account was made, which is a different fact from the day the live
-- link was sent, and the people screens that show "Invited 3 October" for
-- somebody who has never been resent are reading it correctly.
-- ---------------------------------------------------------------------------
drop function if exists public.list_managed_users();

create function public.list_managed_users()
returns table(id uuid, full_name text, email text, role text, status text,
              partner_slug text, last_sign_in_at timestamptz, has_mfa boolean,
              home_branch_id uuid, sees_commission boolean,
              invited_at timestamptz,
              invite_sent_at timestamptz, invite_expires_at timestamptz,
              invite_state text)
language sql stable security definer set search_path to ''
as $function$
  select u.id, u.full_name, u.email, u.role, u.status,
         p.slug as partner_slug,
         au.last_sign_in_at,
         exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as has_mfa,
         u.home_branch_id,
         u.sees_commission,
         coalesce(au.invited_at, u.created_at) as invited_at,
         si.sent_at as invite_sent_at,
         si.expires_at as invite_expires_at,
         /* ONE RULE, IN SQL, so the four screens cannot each decide what an
            expired invite looks like. Read in the order a reader would ask:
            was it withdrawn, was it used, has it run out, otherwise it is
            live. 'none' is a person invited before this table existed, or
            somebody who never needed an invitation at all. */
         case
           when si.user_id is null              then 'none'
           when si.cancelled_at is not null     then 'cancelled'
           when si.claimed_at is not null       then 'used'
           when si.expires_at <= now()          then 'expired'
           else                                      'live'
         end as invite_state
  from public.users u
  left join public.partners p on p.id = u.partner_id
  left join auth.users au on au.id = u.id
  left join public.staff_invites si on si.user_id = u.id
  where public.is_aal2()
    /* "The person is removed from People lists": here, once, for all four
       screens, which are all hydrated from this function. Not a filter in the
       client, which would be four filters. */
    and u.status <> 'deleted'
    and (public.is_admin()
         or (public.app_role() = 'management' and u.partner_id = public.app_partner()
             and public.app_may_reach_user(u.id))
         or u.id = auth.uid());
$function$;

comment on function public.list_managed_users() is
  'Every person the caller may manage, for all four people screens. Carries the live invitation''s sent date, expiry and state (live, expired, used, cancelled, none) but never its token.';

revoke all on function public.list_managed_users() from public, anon;
grant execute on function public.list_managed_users() to authenticated, service_role;
