-- Reveal a webhook signing secret, one endpoint at a time.
--
-- A CHANGE OF POSITION, stated rather than slipped in. 20260810220000 kept the
-- secret out of dev_webhook_endpoints on the argument that a listing returning
-- signing secrets turns any read-scoped leak into a forgery capability. That
-- argument still holds for the LISTING, which is why the secret stays out of it.
--
-- But the secret is stored in plaintext, because signing requires it, and a
-- developer who has lost theirs currently has to delete a working endpoint and
-- recreate it. Revealing on request is the smaller harm: it is the partner's own
-- secret, it is already in their code, and the alternative pushes people towards
-- recreating endpoints, which loses delivery history.
--
-- So: one endpoint, by id, on an explicit call. The list stays clean, and the
-- reveal is a distinct action rather than a side effect of opening a page.
--
-- NOT AVAILABLE TO MANAGEMENT. They reach the Dev Centre only to revoke a leaked
-- API key. A signing secret lets its holder forge deliveries to the partner's own
-- endpoint, which is a developer concern.
--
-- An API KEY CANNOT BE REVEALED THIS WAY and there is deliberately no equivalent
-- function. Only key_hash is stored, so the key does not exist anywhere to
-- return. That asymmetry is a security property, not an oversight, and the Dev
-- Centre says so rather than implying the two behave alike.

create or replace function public.dev_webhook_endpoint_secret(p_id uuid)
returns text
language plpgsql stable security definer set search_path to '' as $$
declare v_partner uuid; v_secret text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select partner_id, secret into v_partner, v_secret
  from public.partner_webhook_endpoints where id = p_id;
  if v_partner is null then raise exception 'Endpoint not found.' using errcode = '22023'; end if;

  if not (public.is_admin()
          or (public.app_role() = 'developer' and v_partner = public.app_partner())) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return v_secret;
end $$;

comment on function public.dev_webhook_endpoint_secret(uuid) is
  'Returns one endpoint signing secret on explicit request. Kept out of the listing so a read of the endpoints page never carries secrets. Developer and opndoor admin only: management reaches the Dev Centre solely to revoke an API key.';

revoke all on function public.dev_webhook_endpoint_secret(uuid) from public, anon;
grant execute on function public.dev_webhook_endpoint_secret(uuid) to authenticated;
