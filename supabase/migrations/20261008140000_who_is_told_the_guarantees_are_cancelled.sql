-- WHO IS TOLD THE GUARANTEES ARE CANCELLED.
--
-- Matt (al): "the agent (and any landlord sent a deed) gets one email
-- listing every tenant on the tenancy and saying all guarantees for the
-- property are cancelled."
--
-- Test: supabase/tests/who_is_told_the_guarantees_are_cancelled.test.sql
--
-- =========================================================================
-- ONE EMAIL PER PROPERTY MEANS ONE QUESTION, ASKED OF THE TENANCY
-- =========================================================================
--
-- The webhook that triggers this knows one application. The email is about
-- a property. Everything in between -- which siblings there are, which of
-- them actually got a deed, who it went to, whether a landlord was sent one
-- -- is a question about data, and it belongs here rather than as four
-- round trips from Deno.
--
-- "ANY LANDLORD SENT A DEED" IS LITERAL. `landlord_email` is stored when
-- somebody uses Send deed to landlord, so its presence IS the record that a
-- landlord holds one. A landlord who was never sent anything must not get an
-- email about a document they have never seen.
--
-- ONLY ADDRESSES THAT WERE ACTUALLY SENT TO. `deed_delivered_to` is stamped
-- by record_delivery_attempt on success. Writing to the branch's current
-- contact list instead would email whoever happens to be on it today, which
-- on a let that fell through three weeks ago is somebody who has never heard
-- of this tenancy.
--
-- NOBODY AT ALL IS A VALID ANSWER, and the common one: a tenancy refunded
-- before any deed was issued has no agent delivery and no landlord. The
-- caller sends nothing, rather than inventing a recipient.

create or replace function public.guarantee_cancellation_notice(p_application uuid)
returns table (
  property text,
  agent_emails text[],
  landlord_email text,
  landlord_name text,
  tenants jsonb
) language sql security definer set search_path to '' as $function$
  with trigger_app as (
    select id, tenancy_id, prop_addr1, prop_postcode
      from public.applications where id = p_application
  ),
  /* THE WHOLE TENANCY, or the one application where there is no tenancy.
     A sole let is not a special case here: it is a list of one. */
  family as (
    select a.*
      from public.applications a, trigger_app t
     where (t.tenancy_id is not null and a.tenancy_id = t.tenancy_id)
        or (t.tenancy_id is null and a.id = t.id)
  )
  select
    (select trim(coalesce(t.prop_addr1,'') || ', ' || coalesce(t.prop_postcode,'')) from trigger_app t),
    /* DISTINCT, because every sibling's deed went to the same inbox and the
       agent must not be listed three times on a one-email rule. */
    (select array_agg(distinct f.deed_delivered_to)
       from family f where f.deed_delivered_to is not null and f.deed_delivered_to <> ''),
    (select f.landlord_email from family f
      where f.landlord_email is not null and f.landlord_email <> '' limit 1),
    (select f.landlord_name from family f
      where f.landlord_email is not null and f.landlord_email <> '' limit 1),
    /* EVERY TENANT, INCLUDING THE ONE WHOSE REFUND STARTED IT. From the
       agent's side there is no trigger and no cascade, only a let that is
       not going ahead, and a list missing a name invites them to ask which
       one is still on. */
    (select coalesce(jsonb_agg(jsonb_build_object(
              'name', trim(coalesce(f.tenant_first_name,'') || ' ' || coalesce(f.tenant_last_name,'')),
              'guaranteeRef', f.guarantee_ref
            ) order by f.tenancy_position nulls first, f.guarantee_ref), '[]'::jsonb)
       from family f)
$function$;

revoke all on function public.guarantee_cancellation_notice(uuid) from public, anon, authenticated;
grant execute on function public.guarantee_cancellation_notice(uuid) to service_role;

comment on function public.guarantee_cancellation_notice(uuid) is
  'Everything the one-per-property cancellation email needs: the address, the distinct agent inboxes a deed was actually delivered to, any landlord who was sent one, and every tenant on the tenancy. Empty arrays and nulls are the normal answer for a tenancy refunded before any deed went out, and the caller sends nothing rather than inventing a recipient.';
