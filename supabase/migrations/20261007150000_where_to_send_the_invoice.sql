/* =====================================================================
   WHERE TO SEND THE INVOICE, AS A SETTING.

   Matt, 2026-10-01, verbatim: "Commission statements (agency and
   supplier, email and PDF): replace 'Paid by the 15th of the following
   month' with: 'Please send an invoice to opndoor for [total], quoting
   statement reference [reference], to [invoice email], including your
   bank details. Invoices received by the 8th are paid by the 15th.' The
   total and reference come from each statement; the invoice email is a
   setting Opndoor admin can change. Set it to [EMAIL]."

   NO DEFAULT, WHICH IS MATT'S OWN CORRECTION. His instruction ended
   "Set it to [EMAIL]" with the placeholder still in it, and when I said
   I would fall back to the product's own contact address rather than
   invent an invoicing one, he answered: "The invoice email is not
   hardcoded and has no default: make it a setting Opndoor admin fills
   in. Until it's set, don't send statements; show a clear warning on
   Home and Health saying the invoice email needs setting."

   HIS ANSWER IS BETTER AND THE REASON IS WORTH KEEPING. A fallback that
   WORKS is a fallback nobody replaces. Statements would have gone out
   for months quoting an address that was never meant to receive
   invoices, each one telling an agency where to send them, and the
   error would have surfaced as unpaid invoices rather than as anything
   anybody could see. With no default the statement cannot go out
   wrong -- it can only not go out, loudly, in two places somebody looks
   at every day.

   app_settings HELD ONLY NUMBERS, which is why it gains a column
   rather than a second table: its key, its audit trail and its policies
   are already the right ones, and a parallel text_settings would be two
   places to look for one answer.
   ===================================================================== */

alter table public.app_settings
  add column if not exists text_value text;

comment on column public.app_settings.text_value is
  'The value, where the setting is text rather than a number. num_value and text_value are never both meaningful for one key.';

/* ---- setting it ----------------------------------------------------- */

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
  'Set a text app setting. Opndoor admin only, audited. The first is statement_invoice_email, the address agencies and suppliers invoice.';

revoke all on function public.set_app_setting_text(text, text) from public, anon;
grant execute on function public.set_app_setting_text(text, text) to authenticated, service_role;

/* ---- reading it ----------------------------------------------------- */

/* THE ADDRESS THE STATEMENTS PRINT, OR NULL.

   A FUNCTION RATHER THAN A SELECT, because three callers need the same
   answer and the same emptiness: the monthly run reads it as
   service_role and refuses to post without it, and Home and Health read
   it as an admin to say so.

   NULL IS THE ANSWER WHEN IT IS UNSET, not an empty string and not a
   stand-in. Everything downstream tests for null, and a blank string
   would quietly print "to , including your bank details". */
create or replace function public.statement_invoice_email()
returns text
language sql
stable security definer
set search_path to ''
as $function$
  select nullif(btrim((select s.text_value from public.app_settings s
                        where s.key = 'statement_invoice_email')), '')
$function$;

comment on function public.statement_invoice_email() is
  'Where agencies and suppliers send their commission invoices. NULL until an Opndoor admin sets it, and the monthly run posts nothing while it is null.';

revoke all on function public.statement_invoice_email() from public, anon;
grant execute on function public.statement_invoice_email() to authenticated, service_role;

/* ---- and the one question Home and Health ask ----------------------- */

/* IS THE MONTHLY RUN ABLE TO POST AT ALL?

   One predicate, so the warning on Home, the check on Health and the
   refusal in the run cannot disagree about the answer. A screen that
   says everything is fine beside a cron that is refusing to send is
   worse than either alone.

   READABLE BY ANY OPNDOOR STAFF, because both screens are theirs and
   neither is admin-only. It answers a boolean and never the address, so
   it grants nothing. */
create or replace function public.statements_can_be_posted()
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select public.statement_invoice_email() is not null
$function$;

comment on function public.statements_can_be_posted() is
  'False while the invoice email is unset, which is when the monthly commission statement run posts nothing. Home and Health both read this.';

revoke all on function public.statements_can_be_posted() from public, anon;
grant execute on function public.statements_can_be_posted() to authenticated, service_role;
