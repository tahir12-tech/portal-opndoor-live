-- apply_deed_executed SAYS WHAT IT DID.
--
-- It returned void, so its one caller could not tell the difference between "the
-- deed is executed" and "I refused to execute it", and did not ask. There are
-- three outcomes and they were indistinguishable:
--
--   executed   the normal path
--   refunded   the guard refuses: the money went back, so the guarantee it paid
--              for must not be issued
--   unknown    no application carries this document id
--
-- WHY IT MATTERS, and it is the refund case. pandadoc-webhook calls this, gets
-- nothing back, writes its success trail and answers PandaDoc 200. The dedup row
-- it wrote before calling means a redelivery is a no-op. So a completion for a
-- refunded application is refused by the database, reported as delivered by the
-- portal, and can never be re-presented. The only trace is one internal activity
-- row saying the document should be voided in PandaDoc, which nothing surfaces
-- and nobody is told to look for. The tenant has signed a deed that was refused
-- and nothing tells anyone it needs voiding.
--
-- On dev this is not hypothetical: 28 document.completed callbacks have verified
-- against this project's shared key and only one matches an application, so the
-- unknown branch is the common case here and it too returned silently.
--
-- A DROP AND RECREATE, because the return type changes. The body is otherwise
-- lifted verbatim: the same guard, the same two update branches, the same
-- coalesce rules. Only the return statements are new.

drop function if exists public.apply_deed_executed(text, text);

create or replace function public.apply_deed_executed(p_document_id text, p_pdf_path text)
returns text
language plpgsql security definer set search_path to ''
as $function$
declare a public.applications;
begin
  select * into a from public.applications where pandadoc_document_id = p_document_id;
  if not found then return 'unknown'; end if;

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
    return 'refunded';
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
  return 'executed';
end $function$;

comment on function public.apply_deed_executed(text, text) is
  'Execute a completed deed, and say which of three things happened: executed, refunded (the guard refused, and the document should be voided in PandaDoc), or unknown (no application carries this document id). It returned void, so its caller reported every refusal as a success and told PandaDoc 200, which is unrecoverable because the dedup row makes a redelivery a no-op.';

revoke all on function public.apply_deed_executed(text, text) from public, anon, authenticated;
grant execute on function public.apply_deed_executed(text, text) to service_role;
