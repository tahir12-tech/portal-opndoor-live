-- Add application.reinstated. See PARTNER-API.md section 13.5.
--
-- THE PROBLEM THIS FIXES. Deliveries are unique per (endpoint, application,
-- event_type), which gives at-most-once per event type. That is the right
-- guarantee, but it left reinstatement invisible: a partner was told
-- application.lapsed and then nothing, because application.paid either had
-- already been delivered or would be indistinguishable from a first payment.
--
-- Neither alternative works:
--   * say nothing            the partner's record stays permanently wrong, showing
--                            an application as lapsed after it has been paid
--   * resend application.paid  anyone treating that as a first-payment signal
--                            double counts revenue, and the at-most-once index
--                            would suppress it anyway
--
-- So reinstatement gets its own event, emitted INSTEAD of application.paid.
-- at-most-once is preserved, and a partner can tell a first payment from a
-- resurrection without inferring it from ordering.
--
-- WHICH TRANSITIONS COUNT. apply_stripe_payment reinstates in exactly one branch
-- (20260705115059:66):
--
--     elsif a.status = 'expired' or (a.status = 'withdrawn' and a.withdrawn_by_tenant)
--
-- so both routes into it, a lapsed application paid late and a TENANT-DECLINED
-- withdrawal paid late, have identical shape and are both covered by testing
-- old.status. They are the same code path, not two similar ones.
--
-- A STAFF withdrawal paid late is deliberately NOT here, and cannot be. That
-- branch never changes status (20260705115059:77), so this trigger never fires
-- for it. The partner is told nothing at all, which is its own defect and is
-- recorded separately in DEFECTS.md rather than papered over here. Emitting a
-- reinstated event for it would be actively wrong: the application was not
-- reinstated, and real money is sitting on a withdrawn row awaiting a refund.
--
-- STATUS REMAINS NON MONOTONIC and partners must still be told so. Ordering is by
-- the event timestamp, and `status` in the payload is authoritative over the
-- event name.

create or replace function public.applications_emit_partner_webhook()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'application.created';
  elsif new.status is distinct from old.status then
    v_event := case new.status
      when 'paid' then
        -- The only way to arrive at 'paid' from a closed state is the reinstate
        -- branch of apply_stripe_payment, so this test is exact rather than
        -- heuristic. 'sent' to 'paid' is a first payment.
        case when old.status in ('expired', 'withdrawn')
             then 'application.reinstated'
             else 'application.paid'
        end
      when 'deed'      then 'application.deed_issued'
      -- 'lapsed', not 'expired'. This codebase uses "expiry" for two unrelated
      -- things: an unpaid application lapsing after 14 days (status), and the
      -- guarantee expiring 12 months after tenancy start (expiry_date).
      when 'expired'   then 'application.lapsed'
      when 'withdrawn' then 'application.withdrawn'
      else null
    end;
  end if;

  if v_event is null then return null; end if;

  -- Never let a webhook failure break the write that caused it. Unlike the
  -- ops-alert pattern this mirrors, the failure is recorded rather than
  -- swallowed into silence.
  begin
    perform public.enqueue_partner_webhook(new.id, v_event);
  exception when others then
    insert into public.activity_log (application_id, kind, message, actor, visibility)
    values (new.id, 'webhook_enqueue_failed',
            'Could not queue the ' || v_event || ' webhook: ' || sqlerrm,
            'System', 'internal');
  end;

  return null;
end $function$;

comment on function public.applications_emit_partner_webhook() is
  'Emits partner webhooks on status change from any path. A move to paid from expired or a tenant-declined withdrawal emits application.reinstated rather than application.paid, so at-most-once per event type is preserved without a partner either missing the resurrection or double counting it as a first payment.';
