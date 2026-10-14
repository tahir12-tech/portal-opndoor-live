/* =====================================================================
   WHICH OF THESE REFERRERS ARE OPNDOOR'S OWN STAFF.

   Matt (cq): "Referrals an Opndoor admin made on a customer's behalf
   still show the admin's name ('Nicholas Dwyer') in that customer's
   referrer lists, charts and exports; show 'opndoor (on your behalf)'
   in every customer view."

   =====================================================================
   WHY THE BROWSER CANNOT ANSWER THIS ITSELF
   =====================================================================

   The obvious fix is to mask in the client: the hydrated row carries
   `referrerRole`, so show the label when that role is opndoor's. It
   would have changed nothing, and it would have LOOKED built.

   Measured on dev as Kestrel Management (de6f243b), on GR-22162, the
   one such referral there is:

       referrer_name                      "Nicholas Dwyer"
       select from users by referrer_id    0 rows
       that user's role                    null

   `referrer_name` is a SNAPSHOT stored on the application, so it is
   readable. The user row behind it is not: users RLS hides opndoor
   staff from a customer, which is correct and stays. So `referrerRole`
   is null for exactly the rows that need masking, and a client-side
   mask keyed on it is a no-op.

   =====================================================================
   ONE BIT, ASKED ONCE, ABOUT IDS THE CALLER ALREADY HOLDS
   =====================================================================

   This takes the DISTINCT referrer ids off the rows the caller has
   already read and answers which of them are opndoor's. It is a read:
   nothing is written, `referrer_id` and `referrer_name` stay the
   record, and what a customer is SHOWN is decided in the client, where
   the product's other wording lives.

   WHY NOT A COMPUTED COLUMN OVER applications, which is the tidier
   PostgREST shape and was written first: `authenticated` holds SELECT
   on 90 of the 92 columns and deliberately not the table, so passing
   the whole row to a function is "permission denied for table
   applications". The column grants are a boundary (see
   applications_column_grants), so the function fits them rather than
   the other way round.

   WHY NOT A BATCH OVER APPLICATION IDS, which was the second shape: it
   would have had to re-implement the applications read policy inside a
   definer function to decide which rows the caller may ask about. The
   ids here come off rows RLS has already handed over, so there is no
   second copy of the policy to get wrong.

   DEFINER, NARROWLY. It reads users.role, which the caller may not. It
   returns ids the caller sent and nothing else: no name, no email, no
   row. The bit it adds to a customer's reach -- "this one is opndoor"
   -- is the thing we are telling them on purpose.
   ===================================================================== */

create or replace function public.opndoor_user_ids(p_users uuid[])
returns setof uuid
language sql stable security definer set search_path to ''
as $function$
  select u.id
    from public.users u
   where u.id = any (coalesce(p_users, '{}'::uuid[]))
     and u.role in ('superadmin', 'opndoor_manager')
     /* A BOOK HAS A HANDFUL OF DISTINCT REFERRERS, not thousands. The cap
        is not a performance guard, it is a shape guard: an array far
        larger than any real book means the caller is doing something
        this was not built for, and it answers nothing rather than
        becoming a lookup service. */
     and array_length(p_users, 1) <= 500
$function$;

revoke all on function public.opndoor_user_ids(uuid[]) from public, anon;
grant execute on function public.opndoor_user_ids(uuid[]) to authenticated, service_role;

comment on function public.opndoor_user_ids(uuid[]) is
  'Which of these user ids are opndoor''s own staff. The portal asks about the distinct referrers on rows it has already read, so that a referral opndoor made on a customer''s behalf can be shown to that customer as opndoor rather than as the member of staff who sent it. Returns ids and nothing else.';
