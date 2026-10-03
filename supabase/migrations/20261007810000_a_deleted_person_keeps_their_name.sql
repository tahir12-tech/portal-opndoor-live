/* =====================================================================
   DELETE TAKES SOMEBODY OFF PEOPLE AND LEAVES THEIR NAME WHERE IT IS.

   Matt, 2026-10-03, verbatim: "After access is removed, offer 'Delete':
   'Delete Joe Joe? They disappear from People. Their name stays on referrals
   and activity they're part of.' The person is removed from People lists and
   can never sign in, but their name stays wherever they appear on past
   records. Recorded in Recent changes. Removed-but-not-deleted people show as
   'No access' with a 'Restore access' option."

   HIS SECOND SENTENCE IS THE WHOLE DESIGN, and it is why this is a STATUS and
   not a `delete from public.users`. A real delete would take the row that
   `applications.referrer_id` and `user_audit.target_user` point at; it would
   either fail on the foreign keys or, worse, cascade and take a name off a
   guarantee that was really referred by that person. Nothing is removed here.

   AND NOTHING NEEDED COPYING ANYWHERE, which is worth stating because it is
   the half somebody would otherwise build: `applications.referrer_name` has
   been snapshotted since #97 ("survives deactivation / users-RLS") and
   `activity_log.actor` is text. So the names Matt wants kept are already
   stored beside the records rather than joined to the person, and a deleted
   user's name goes on reading correctly on every past record with no work.

   WHY THE LIST IS THE ONE PLACE IT IS FILTERED. Every People screen in the
   product -- the admin team page, the agency People tab, the supplier People
   tab, Team -- is hydrated from `list_managed_users`. One clause there takes
   a deleted person off all four, and no screen can forget.

   THEY CAN NEVER SIGN IN, which costs nothing extra: the row is already
   `deactivated` before Delete is offered, so `auth.users.banned_until` is
   already 'infinity' and the sessions are already gone (admin_set_user_status
   does both). Delete re-states the ban rather than assuming it, because the
   ban is the half that actually keeps them out and a status nobody enforces is
   a label.

   RECORDED IN RECENT CHANGES by writing `user_audit` the same way a status
   change does, which is what that feed reads.
   ===================================================================== */

/* THE THIRD STATE. 'deleted' is reachable only from 'deactivated', which the
   function below enforces; the constraint only has to admit it. */
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'pending'::text, 'deactivated'::text, 'deleted'::text]));

/* ---------------------------------------------------------------------
   OFF EVERY PEOPLE LIST, IN ONE CLAUSE.
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION public.list_managed_users()
 RETURNS TABLE(id uuid, full_name text, email text, role text, status text, partner_slug text, last_sign_in_at timestamp with time zone, has_mfa boolean, home_branch_id uuid, sees_commission boolean, invited_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select u.id, u.full_name, u.email, u.role, u.status,
         p.slug as partner_slug,
         au.last_sign_in_at,
         exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as has_mfa,
         u.home_branch_id,
         u.sees_commission,
         coalesce(au.invited_at, u.created_at) as invited_at
  from public.users u
  left join public.partners p on p.id = u.partner_id
  left join auth.users au on au.id = u.id
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

/* ---------------------------------------------------------------------
   THE ACTION.
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user uuid)
 RETURNS public.users
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.users; res public.users; who text; me uuid := auth.uid();
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;

  /* THE SAME PERMISSION QUESTION admin_set_user_status ASKS, and deliberately
     not a wider one: whoever may remove somebody's access may finish the job,
     and nobody else. Both arms, so a Director can delete one of their own
     people and cannot reach anybody else's. */
  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);

  -- Belt and braces over the ladder, which already refuses self, and it says why.
  if p_user = me then
    raise exception 'You cannot delete your own account.' using errcode = '42501';
  end if;

  /* ACCESS COMES OFF FIRST, ALWAYS. Matt: "After access is removed, offer
     'Delete'." So this is reachable only from a person who already has none,
     which keeps the two steps two steps: an administrator cannot delete
     somebody straight off an active row by finding the RPC. */
  if cur.status <> 'deactivated' then
    raise exception 'Remove their access first, then delete them.' using errcode = '42501';
  end if;

  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  update public.users set status = 'deleted' where id = p_user returning * into res;

  /* THE BAN RE-STATED rather than assumed. It is already 'infinity' from the
     deactivation, and it is the half that actually keeps somebody out, so
     this does not depend on that having happened. */
  update auth.users set banned_until = 'infinity' where id = p_user;
  delete from auth.sessions where user_id = p_user;

  -- "Recorded in Recent changes": the feed reads user_audit.
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'status', 'deactivated', 'deleted', who, me);
  return res;
end $function$;

REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO service_role;
