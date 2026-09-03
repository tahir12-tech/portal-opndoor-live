-- ===========================================================================
-- Staff copy-link: the durable /pay?token page, not the raw Stripe URL.
--
-- ApplicationDetail showed applications.payment_url (the raw Stripe Checkout URL,
-- which expires 30 minutes after it was minted) as a copyable "Checkout link".
-- A staff member copying that into an email is the last route by which a link we
-- hand out can go stale. mint_payment_page_token is service_role only, so staff
-- cannot read the durable token directly; this returns it, gated to exactly the
-- applications_select access (admin, the managing partner, or the referrer), and
-- refreshes the 90-day expiry so the copied link is always live.
-- ===========================================================================
create or replace function public.staff_payment_page_token(p_ref text)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare v_app public.applications; v_token uuid;
begin
  select * into v_app from public.applications where guarantee_ref = p_ref;
  if not found then return null; end if;

  if not (public.is_admin()
       or (public.app_role() = 'management' and v_app.partner_id = public.app_partner())
       or (public.app_role() = 'referrer'   and v_app.referrer_id = auth.uid())) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  insert into public.payment_page_tokens(application_id, guarantee_ref, expires_at)
  values (v_app.id, v_app.guarantee_ref, now() + interval '90 days')
  on conflict (application_id) do update set expires_at = excluded.expires_at
  returning token into v_token;
  return v_token;
end $function$;

revoke execute on function public.staff_payment_page_token(text) from public, anon;
grant  execute on function public.staff_payment_page_token(text) to authenticated;

comment on function public.staff_payment_page_token(text) is
  'Returns the durable /pay page token for an application so staff can copy a payment link that never goes stale, gated to the same access as applications_select. Refreshes the 90-day expiry.';
