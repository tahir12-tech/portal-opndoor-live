/* =====================================================================
   THE SENDER ADDRESS IS A SETTING.

   Matt, 2026-10-01, verbatim: "Every email is sent from
   no-reply@opndoor.co (display name 'opndoor'), with no Reply-To. The
   footer reads 'Questions? Email support@opndoor.co' as a mailto link.
   The sender address is a setting, not hardcoded."

   =====================================================================
   WHY AN ENV VAR DID NOT ALREADY SATISFY "A SETTING"
   =====================================================================

   `mailer.ts` reads `EMAIL_FROM` from the environment, which is not
   hardcoded and is still not a setting: changing it means a secret
   change and a redeploy of every edge function, by somebody with
   access to the Supabase project. Nobody running the business can do
   it, and nobody can see what it currently is without that access
   either.

   `app_settings` is where this product keeps the things an admin may
   change -- the bordereau rate, the invoice address -- with
   `set_app_setting_text` to write them and `settings_audit` recording
   who and when. The sender belongs there with them.

   THE ENV VAR STAYS, BELOW THE SETTING. A live environment may need to
   send from somewhere else before anybody can sign in to change it,
   and the order is: the setting, then EMAIL_FROM, then the built-in
   default. Each is a fallback for the one before being absent, never
   for it being wrong.

   =====================================================================
   AND THE DEFAULT GAINS A HYPHEN
   =====================================================================

   It was `noreply@opndoor.co`. Matt's is `no-reply@opndoor.co`. That is
   a different mailbox, and on a domain where neither has been verified
   yet it is the difference between an email arriving and not. The
   HANDOVER entry added with this migration is where that gets checked
   before go-live.

   Tests: supabase/tests/the_sender_address_is_a_setting.test.sql
   ===================================================================== */

/* SEEDED WITH THE ADDRESS MATT NAMED, so dev sends from the right place
   the moment the functions are redeployed, rather than waiting for
   somebody to notice the setting is empty. `on conflict do nothing`:
   an environment that has already set one keeps it. */
insert into public.app_settings (key, text_value, updated_by_name, updated_at)
values ('email_from', 'opndoor <no-reply@opndoor.co>', 'opndoor', now())
on conflict (key) do nothing;

/* THE WHOLE "Name <address>" STRING, not the address alone.

   Resend takes one `from` field and the display name is part of it, so
   splitting them into two settings would make an admin assemble a
   header. One setting, one thing to get right, and the reader below
   hands it to Resend unchanged. */
create or replace function public.email_from()
returns text
language sql
stable security definer
set search_path to ''
as $function$
  select nullif(btrim((select s.text_value from public.app_settings s
                        where s.key = 'email_from')), '')
$function$;

comment on function public.email_from() is
  'Who every email is sent from, as Resend wants it: "opndoor <no-reply@opndoor.co>". NULL until set, and the mailer then falls back to EMAIL_FROM and finally to its built-in default -- so an unset setting never stops an email, it only stops it being configurable.';

revoke all on function public.email_from() from public, anon;
grant execute on function public.email_from() to authenticated, service_role;

/* ---------------------------------------------------------------------
   AND THE WRITER LEARNS THE NEW KEY'S SHAPE.
   ---------------------------------------------------------------------
   `set_app_setting_text` checks the shape of what it is given, per key.
   It knew one key. A sender that is not a deliverable address stops
   EVERY email in the product, which is a worse failure than the invoice
   address it already guards -- so this one is checked harder: it must
   contain an address, and where it carries a display name the address
   must be in angle brackets, which is what Resend parses.

   Regenerated from 20261007150000 by script with one substitution
   asserted to match exactly once. */

create or replace function public.set_app_setting_text(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_old text; v_who text;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only Opndoor changes this setting.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_key), '') = '' then
    raise exception 'No setting named.' using errcode = '22023';
  end if;

  /* THE ONE TEXT SETTING THERE IS, AND IT IS AN ADDRESS. A free-text
     setter with no idea what it is setting would accept anything for
     any key; this one knows the key it has and checks the shape. Not a
     full RFC check: one that is wrong about a real address is worse
     than one that lets a typo through to a bounce, which is the same
     line add_partner_statement_recipient draws. */
  if btrim(p_key) = 'statement_invoice_email'
     and coalesce(btrim(p_value), '') <> ''
     and position('@' in btrim(p_value)) < 2 then
    raise exception 'Enter an email address.' using errcode = '22023';
  end if;

  /* THE SENDER STOPS EVERY EMAIL IN THE PRODUCT IF IT IS WRONG, so it is
     checked harder than the invoice address above. Resend parses either
     a bare address or "Display Name <address>"; anything else is
     rejected at send time, by which point the email is already lost. */
  if btrim(p_key) = 'email_from' then
    if coalesce(btrim(p_value), '') = '' then
      raise exception 'The sender address cannot be empty: every email in the product is sent from it.'
        using errcode = '22023';
    end if;
    if btrim(p_value) like '%<%' then
      if btrim(p_value) !~ '^[^<>]+<[^<>@[:space:]]+@[^<>@[:space:]]+\.[^<>@[:space:]]+>$' then
        raise exception 'Write the sender as a name and an address in angle brackets, like: opndoor <no-reply@opndoor.co>'
          using errcode = '22023';
      end if;
    elsif btrim(p_value) !~ '^[^<>@[:space:]]+@[^<>@[:space:]]+\.[^<>@[:space:]]+$' then
      raise exception 'Enter a sender address, like no-reply@opndoor.co, or a name and address like: opndoor <no-reply@opndoor.co>'
        using errcode = '22023';
    end if;
  end if;

  select text_value into v_old from public.app_settings where key = btrim(p_key);

  insert into public.app_settings (key, text_value, updated_by, updated_by_name, updated_at)
  values (btrim(p_key), nullif(btrim(coalesce(p_value, '')), ''), auth.uid(),
          coalesce((select full_name from public.users where id = auth.uid()), 'opndoor admin'), now())
  on conflict (key) do update
    set text_value = excluded.text_value,
        updated_by = excluded.updated_by,
        updated_by_name = excluded.updated_by_name,
        updated_at = now();

  select coalesce(nullif(btrim(full_name), ''), email) into v_who
    from public.users where id = auth.uid();

  insert into public.settings_audit (key, old_value, new_value, actor)
  values (btrim(p_key), v_old, nullif(btrim(coalesce(p_value, '')), ''), coalesce(v_who, 'opndoor admin'));
end $function$;

comment on function public.set_app_setting_text(text, text) is
  'Set a text app setting. Opndoor admin only, audited. statement_invoice_email is the address agencies and suppliers invoice; email_from is who every email is sent from.';
