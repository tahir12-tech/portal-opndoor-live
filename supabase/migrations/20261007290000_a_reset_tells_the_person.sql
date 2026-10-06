/* =====================================================================
   A TWO-FACTOR RESET TELLS THE PERSON IT HAPPENED.

   Matt, 2026-10-01: 'Two-factor reset email: add "Delete the old
   opndoor entry from your authenticator app before scanning the new
   code."'

   THERE WAS NO TWO-FACTOR RESET EMAIL. `admin_reset_user_mfa` writes an
   audit row and sends nothing, and the four screens that call it send
   nothing either. So somebody whose authenticator an administrator
   resets is signed out of every session, has their factor destroyed,
   and is told none of it -- which from their side is indistinguishable
   from being attacked.

   Matt's sentence needs an email to live in, and the email needs to
   exist anyway. This is the SQL half: the same judgement
   admin_reset_user_mfa already made, asked a second time so the edge
   function can learn the address.

   WHY THE BROWSER DOES NOT NOMINATE THE ADDRESS. An endpoint that
   emails whoever it is handed is a spam relay with opndoor.co on it.
   `authorise_password_reset` solved this first and this is its twin:
   SQL judges the caller against the ladder and hands back the address
   it holds. The address is not new knowledge for the client -- it is
   already on the hydrated row -- what is new is that SQL has agreed.

   NO AUDIT ROW HERE. The reset is already recorded by
   admin_reset_user_mfa; a second row would make one action look like
   two.

   Tests: supabase/tests/a_reset_tells_the_person.test.sql
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.authorise_mfa_reset_notice(p_user uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.users; who text; me uuid := auth.uid();
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);
  /* NO AUDIT ROW AND NO WRITES. admin_reset_user_mfa has already recorded
     the reset; this is the same judgement asked a second time so the edge
     function can learn the address WITHOUT the browser nominating one.
     An endpoint that emails whatever address it is handed is a spam relay
     with our domain on it. */
  return cur.email;
end $function$;

revoke all on function public.authorise_mfa_reset_notice(uuid) from public, anon;
grant execute on function public.authorise_mfa_reset_notice(uuid) to authenticated, service_role;

comment on function public.authorise_mfa_reset_notice(uuid) is
  'The address to tell that their two-factor was reset, for a caller who may act on them. Judges the same ladder as admin_reset_user_mfa and writes nothing: the reset is already audited. Exists so the browser never nominates the address an email is sent to.';
