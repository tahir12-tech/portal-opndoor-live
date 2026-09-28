-- A PAID APPLICATION WITH NO DEED IS FOUND, RATHER THAN WAITED FOR.
--
-- THE GAP. 20261005260000 ruled that a failed deed is retried and said "the next
-- automatic pass retries it". There is no automatic pass. Checked on dev: of the
-- eight cron-invoked functions (payment-reminders, expiry-reminders,
-- expiry-cohorts, renewal-notices, weekly-digest, commission-statements,
-- partner-webhooks, hubspot-sync) not one calls generateDeed. The only automatic
-- generation in the whole system is inside stripe-webhook at the moment the
-- payment lands.
--
-- So "the next pass" meant a Stripe REDELIVERY, which happens within Stripe's own
-- retry window of a few hours and then never again. Past that, a paid application
-- with no deed stays that way until a person opens it and presses Generate. On dev
-- right now eleven paid applications carry no document, and two of them
-- (GR-20761 paid 16 Sep, GR-20763 paid 20 Sep) show deed_attempts 0 and
-- deed_last_error null, which means generation was never ATTEMPTED rather than
-- having failed. Nothing was ever going to pick them up.
--
-- This is the selection half: which applications a sweep should try. The calling
-- half is the deed-sweep edge function, which claims and generates exactly the way
-- stripe-webhook does, so there is one generation path and not two.
--
-- WHY THE RULE LIVES IN SQL. It is the part worth testing, it has to agree with
-- claim_tenancy_deed about what "needs a deed" means, and a rule written in
-- TypeScript inside a cron is a rule nobody reads again.

create or replace function public.deeds_awaiting_generation(
  p_older_than interval default interval '30 minutes',
  p_limit int default 25
)
returns table (application_id uuid, guarantee_ref text, paid_at timestamptz, deed_attempts int)
language sql stable security definer set search_path to ''
as $function$
  select a.id, a.guarantee_ref, a.paid_at, a.deed_attempts
    from public.applications a
   where a.status = 'paid'
     -- A document exists, so there is nothing to generate. This is the same
     -- refusal claim_tenancy_deed makes, and the claim is still what gates the
     -- generation itself: this only avoids asking about rows we know it refuses.
     and a.pandadoc_document_id is null
     -- Voided, declined and executed are decisions a human made or a deed that is
     -- done. 'error' is deliberately NOT here: a failure is retried, which is the
     -- whole of 20261005260000.
     and (a.deed_state is null or a.deed_state = 'error')
     -- The money went back, so the guarantee it paid for must not be issued.
     and coalesce(a.payment_state, '') <> 'refunded'
     and a.withdrawn_at is null
     -- THE GENERATION WINDOW. A deed normally exists seconds after payment, so
     -- anything younger than this is probably mid-flight in stripe-webhook and
     -- sweeping it would be the second presser in a double-click. The lease
     -- (20261005280000) would refuse the loser anyway; this keeps us from
     -- routinely relying on that.
     and a.paid_at is not null
     and a.paid_at < now() - p_older_than
     -- ALREADY PARKED FOR A PERSON. Three consecutive failures mean a human has
     -- been asked to look, and an hourly robot retrying a known-broken row would
     -- raise an ops incident every hour and bury the alert that matters. Parking
     -- is still not a lock: Generate on the application works on these, which is
     -- the recovery path both rails' sequences depend on.
     and coalesce(a.deed_attempts, 0) < 3
     -- Somebody is generating this right now.
     and (a.deed_generating_since is null
          or a.deed_generating_since < now() - interval '5 minutes')
   order by a.paid_at
   limit greatest(p_limit, 0)
$function$;

comment on function public.deeds_awaiting_generation(interval, int) is
  'Paid applications that should have a deed and do not: no document, not terminal, not refunded or withdrawn, older than the generation window, not already parked after three failures, not currently leased. The selection half of the deed sweep; claim_tenancy_deed is still the gate on generating.';

revoke all on function public.deeds_awaiting_generation(interval, int) from public, anon;
grant execute on function public.deeds_awaiting_generation(interval, int) to service_role;
