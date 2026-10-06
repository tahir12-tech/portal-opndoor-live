-- A refunded application cannot execute a deed.
--
-- DEFECTS.md 9. The reachable path is a PandaDoc void that fails during a
-- refund: deed_state stays awaiting_tenant, the document id stays set, and the
-- signing link already in the tenant's inbox stays live. apply_stripe_refund
-- never touches status, so the application is still 'paid' and signing it takes
-- the ORDINARY branch below, issuing a full Deed of Guarantee, delivered to the
-- agent as valid, on an application whose fee has been refunded.
--
-- The Edge Function now handles the void failure and clears the document id, so
-- that specific route is closed. This is the guard underneath it, and it is
-- worth having separately: the function is the only thing standing between a
-- completed PandaDoc document and a legally operative deed, and it should refuse
-- on the state of the row rather than trusting that every caller cleared up
-- correctly.
--
-- Cheap, and it makes the outcome safe even if the void never happens at all.
--
-- Reproduced byte-for-byte from 20260703101635 with one guard added and nothing
-- else changed.

create or replace function public.apply_deed_executed(p_document_id text, p_pdf_path text)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare a public.applications;
begin
  select * into a from public.applications where pandadoc_document_id = p_document_id;
  if not found then return; end if;

  -- THE GUARD. A refunded application has had its money returned; issuing the
  -- guarantee it paid for is the one outcome that cannot be undone by a support
  -- conversation.
  --
  -- Recorded rather than silently ignored: a tenant who signed and heard nothing
  -- will ask, and whoever answers needs to find this. Internal visibility,
  -- because the partner-facing story is that the application was refunded, and a
  -- deed-related row on it would confuse rather than inform.
  if a.payment_state = 'refunded' then
    insert into public.activity_log(application_id, kind, message, actor, visibility)
    values (a.id, 'deed_execution_refused',
            'A deed completion arrived for this application after it was refunded, and was refused. '
            || 'The document should be voided in PandaDoc.',
            'System', 'internal');
    return;
  end if;

  if a.status = 'paid' then
    update public.applications set
      status            = 'deed',
      deed_state        = 'executed',
      deed_executed_at  = coalesce(deed_executed_at, now()),
      deed_issued_at    = coalesce(deed_issued_at, now()),
      executed_pdf_path = coalesce(p_pdf_path, executed_pdf_path)
    where id = a.id;
  else
    update public.applications set
      deed_state        = 'executed',
      deed_executed_at  = coalesce(deed_executed_at, now()),
      executed_pdf_path = coalesce(executed_pdf_path, p_pdf_path)
    where id = a.id;
  end if;
end $function$;

do $$
declare v int;
begin
  select count(*) into v from public.livemode_audit();
  if v > 0 then raise exception 'livemode_audit is not clean: % function(s).', v; end if;
end $$;
