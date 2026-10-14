-- AN INVITATION IS SPENT ONLY ONCE IT HAS WORKED.
--
-- Found by doing what Matt asked for on 2026-10-13 -- "load an invite link
-- with a plain curl, then open it in a browser and complete sign-up" -- and
-- it is a defect I introduced in 20261009100000 and whose comment predicted
-- it:
--
--   "CLAIMED HERE, not by the caller afterwards. The edge function mints a
--    short-lived sign-in link straight after this returns, so the two have to
--    be one transaction or a failure between them leaves a token that is
--    spent and a person who got nothing."
--
-- They are NOT one transaction and cannot be: one is a Postgres function and
-- the other is an HTTPS call to GoTrue from a Deno process. So the ordering is
-- the only thing that decides what happens when the second half fails, and I
-- had it the wrong way round. On the probe the GoTrue call failed, the token
-- was already marked claimed, and the retry answered "That invitation has
-- already been used" -- about an invitation nobody had ever used.
--
-- THE FIX IS TO SPLIT THE QUESTION FROM THE SPENDING. `peek_staff_invite`
-- answers "may this token be used, and whose is it" and writes nothing.
-- `claim_staff_invite` is unchanged and remains the authoritative spend, which
-- the edge function now calls LAST, after the sign-in link exists. A failure
-- anywhere before that leaves the invitation exactly as it was and the person
-- can press the button again.
--
-- THE RACE THIS OPENS IS HARMLESS, and is worth stating rather than leaving
-- for somebody to find. Two clicks landing together both pass the peek, both
-- mint a token_hash, and the second overwrites the first in auth.users; one
-- claim lands and the other is refused. The holder ends up with one working
-- link, which is the same outcome as before, and nothing is spent that did
-- not work. The alternative -- claim first and compensate on failure -- is a
-- compensating write, which is the pattern this codebase removed from the
-- invite path in 20261006300000 for exactly this class of reason.

create or replace function public.peek_staff_invite(p_token uuid)
returns table(user_id uuid, email text, expires_at timestamptz)
language plpgsql stable security definer set search_path to ''
as $function$
declare inv public.staff_invites;
begin
  select * into inv from public.staff_invites si where si.token = p_token;
  /* THE SAME FOUR SENTENCES AS claim_staff_invite, and deliberately the same
     words: expired, already used, cancelled and never issued are four things
     to tell somebody and only one of them means "ask your administrator for
     another". A reader must not get a different sentence depending on which
     half of the flow refused them. */
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

  return query select inv.user_id, inv.email, inv.expires_at;
end $function$;

comment on function public.peek_staff_invite(uuid) is
  'May this staff invitation token be used, and whose is it. Writes NOTHING: it is the question, and claim_staff_invite is the spending. Raises the same four messages as the claim, so a reader cannot get different words depending on which half refused. Service role only: accept-invite asks this, mints the sign-in link, and only then claims.';

revoke all on function public.peek_staff_invite(uuid) from public, anon, authenticated;
grant execute on function public.peek_staff_invite(uuid) to service_role;
