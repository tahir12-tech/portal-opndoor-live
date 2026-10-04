-- A FULL REFUND ON A JOINT TENANCY REFUNDS THE WHOLE TENANCY.
--
-- Matt, 2026-10-04 (al): "on a joint tenancy, when one tenant's fee is fully
-- refunded in Stripe, the tenancy isn't going ahead, so automatically refund
-- every other paid tenant on that tenancy through Stripe, cancel all their
-- deeds, and treat the whole tenancy as refunded. Only a full refund
-- triggers this, never a partial one. Record who and what triggered each
-- automatic refund in the activity log; if any co-tenant's refund fails,
-- alert ops and show it on Home."
--
-- And (an), confirming the design before it was built: "idempotency key per
-- application so a redelivered webhook can never refund twice, and
-- per-tenant, recorded, resumable refunds with ops alert and Home warning
-- for any that fail."
--
-- Test: supabase/tests/a_joint_refund_refunds_the_whole_tenancy.test.sql
--
-- =========================================================================
-- THIS IS THE ONLY THING IN THE QUEUE THAT MOVES MONEY OUTWARD BY ITSELF
-- =========================================================================
--
-- Everything else this week changed what a screen says, what a column holds
-- or what a guard refuses. This issues REAL REFUNDS to real people,
-- automatically, triggered by a webhook, with nobody in the loop. So the
-- shape of the thing is decided by what happens when it goes wrong, not by
-- what happens when it works.
--
-- STRIPE CALLS ARE NOT TRANSACTIONAL, so the cascade CANNOT be one
-- statement. A rollback cannot un-refund a co-tenant. The dangerous state is
-- the half-done cascade: two of three refunded, the third failed, and
-- nobody told. That is why this is a LEDGER and not a loop -- one row per
-- co-tenant, written before the money moves, so a crash leaves evidence
-- rather than a gap.
--
-- IDEMPOTENCY IS THE THING TO GET RIGHT BEFORE ANYTHING ELSE. Stripe
-- redelivers webhooks as a matter of course. Without a key, the second
-- delivery refunds everybody a second time. The key is DERIVED FROM THE
-- APPLICATION, not generated, so a retry computes the same one and Stripe
-- returns the original refund instead of making another.
--
-- ONE ROW PER APPLICATION, FOREVER, is what the unique constraint buys: the
-- ledger cannot hold two cascades for the same tenant even if two different
-- co-tenants' refunds both try to start one.

create table if not exists public.refund_cascades (
  id                uuid primary key default gen_random_uuid(),
  tenancy_id        uuid not null references public.tenancies(id) on delete cascade,
  -- The co-tenant this row is about: the one being refunded automatically.
  application_id    uuid not null unique references public.applications(id) on delete cascade,
  -- The application whose own refund set this off. Matt: "Record who and
  -- what triggered each automatic refund."
  triggered_by      uuid not null references public.applications(id) on delete cascade,
  /* DERIVED, NEVER GENERATED. A generated key would be a new key on every
     retry, which is the same as having none. */
  idempotency_key   text not null unique,
  state             text not null default 'pending'
                    check (state in ('pending','succeeded','failed','skipped')),
  stripe_refund_id  text,
  last_error        text,
  attempts          integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.refund_cascades is
  'One row per co-tenant automatically refunded because a sibling on the same tenancy was fully refunded. Written BEFORE the Stripe call, so a crash mid-cascade leaves evidence rather than a gap. Unique on application_id, so a redelivered webhook resumes rather than repeats.';
comment on column public.refund_cascades.idempotency_key is
  'Passed to Stripe as Idempotency-Key. Derived from the application id so a retry computes the same value and Stripe returns the original refund instead of issuing a second one.';
comment on column public.refund_cascades.state is
  'pending until the Stripe call returns. succeeded with a refund id; failed with last_error, which raises an ops incident and a Home warning; skipped where there was nothing to refund.';

create index if not exists refund_cascades_open_idx
  on public.refund_cascades (state) where state in ('pending','failed');

alter table public.refund_cascades enable row level security;

/* NO POLICY, DELIBERATELY, and this is the choice worth stating. RLS on with
   no policy denies every signed-in reader, which is what we want: the
   cascade is machinery, not a customer-facing record. What a partner should
   see is the activity log on their own application, which says the guarantee
   was cancelled and why. Opndoor reads this through the SECURITY DEFINER
   function below, so there is one audience and one shape. */

-- =========================================================================
-- STARTING ONE. Called by the refund webhook, once per refunded application.
-- =========================================================================

create or replace function public.start_refund_cascade(p_trigger uuid)
returns integer language plpgsql security definer set search_path to '' as $function$
declare a public.applications; v_made integer := 0; r record;
begin
  select * into a from public.applications where id = p_trigger;
  if not found then return 0; end if;

  -- A SOLE TENANCY HAS NOBODY TO CASCADE TO. Most of the book.
  if a.tenancy_id is null then return 0; end if;

  /* "ONLY A FULL REFUND TRIGGERS THIS, NEVER A PARTIAL ONE." The guard that
     keeps a goodwill refund of part of one tenant's fee from unwinding a
     whole tenancy. 'partially_refunded' is a different state precisely so
     this test can be exact rather than "some money went back". */
  if coalesce(a.payment_state, '') <> 'refunded' then return 0; end if;

  for r in
    select s.id, s.guarantee_ref
      from public.applications s
     where s.tenancy_id = a.tenancy_id
       and s.id <> a.id
       /* PAID AND NOT ALREADY BACK. An unpaid co-tenant has no money to
          return; one already refunded by hand needs no second refund. Both
          are correctly absent from the ledger rather than present as
          'skipped': a row here means "Stripe was asked", and asking is
          exactly what must not happen for these. */
       and s.paid_at is not null
       and coalesce(s.payment_state, '') in ('paid', 'partially_refunded')
  loop
    insert into public.refund_cascades (tenancy_id, application_id, triggered_by, idempotency_key)
    values (a.tenancy_id, r.id, a.id, 'refund-cascade-' || r.id::text)
    /* THE SECOND DELIVERY LANDS HERE and changes nothing. Not DO UPDATE:
       a row already in flight, or already succeeded, must not be reset to
       pending and refunded again. */
    on conflict (application_id) do nothing;

    if found then
      v_made := v_made + 1;
      insert into public.activity_log (application_id, kind, message, actor, visibility)
      values (r.id, 'refund_cascade_started',
              'Refund started automatically because ' || a.guarantee_ref
              || ' on the same tenancy was refunded in full, so the tenancy is not going ahead.',
              'System', 'business');
    end if;
  end loop;

  return v_made;
end $function$;

revoke all on function public.start_refund_cascade(uuid) from public, anon, authenticated;
grant execute on function public.start_refund_cascade(uuid) to service_role;

comment on function public.start_refund_cascade(uuid) is
  'Open a ledger row for every other paid, unrefunded applicant on this tenancy. Returns how many were opened. Idempotent: a redelivered webhook adds nothing. Returns 0 for a sole tenancy, and for anything that is not a FULL refund.';

-- =========================================================================
-- WORKING THROUGH ONE. Resumable: this is the whole of "resumable".
-- =========================================================================

create or replace function public.refund_cascade_work()
returns table (
  application_id uuid, guarantee_ref text, idempotency_key text,
  payment_intent text, fee numeric, attempts integer
) language sql security definer set search_path to '' as $function$
  select c.application_id, a.guarantee_ref, c.idempotency_key,
         a.stripe_payment_intent_id,
         coalesce(a.paid_amount, a.fee_amount, 0),
         c.attempts
    from public.refund_cascades c
    join public.applications a on a.id = c.application_id
   /* FAILED ROWS COME BACK. That is what makes the cascade resumable rather
      than merely recorded: a Stripe timeout leaves a failed row, the next
      delivery of the webhook picks it up, and the idempotency key means the
      retry cannot double-refund if the first call actually landed. */
   where c.state in ('pending', 'failed')
   order by c.created_at
$function$;

revoke all on function public.refund_cascade_work() from public, anon, authenticated;
grant execute on function public.refund_cascade_work() to service_role;

create or replace function public.record_refund_cascade(
  p_application uuid, p_state text, p_refund_id text default null, p_error text default null
) returns void language plpgsql security definer set search_path to '' as $function$
begin
  if p_state not in ('succeeded','failed','skipped') then
    raise exception 'Unknown cascade state %', p_state using errcode = '22023';
  end if;

  update public.refund_cascades
     set state = p_state,
         stripe_refund_id = coalesce(p_refund_id, stripe_refund_id),
         /* CLEARED ON SUCCESS. A row that says succeeded and still carries
            the error from the attempt before reads as a failure in every
            list that shows last_error. */
         last_error = case when p_state = 'succeeded' then null else p_error end,
         attempts = attempts + 1,
         updated_at = now()
   where application_id = p_application;

  if p_state = 'failed' then
    insert into public.activity_log (application_id, kind, message, actor, visibility)
    values (p_application, 'refund_cascade_failed',
            'The automatic refund for this tenant could not be taken through Stripe: '
            || coalesce(p_error, 'no detail') || '. Opndoor has been alerted.',
            'System', 'internal');
  end if;
end $function$;

revoke all on function public.record_refund_cascade(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_refund_cascade(uuid, text, text, text) to service_role;

-- =========================================================================
-- THE HOME WARNING. "if any co-tenant's refund fails, alert ops and show it
-- on Home."
-- =========================================================================
--
-- OPNDOOR STAFF ONLY. A half-done cascade is our failure to clear up, not
-- something to put in front of the agency whose tenant is waiting for money.
-- They see the per-application activity row; we see the list.

create or replace function public.refund_cascade_failures()
returns table (
  guarantee_ref text, tenant text, property text, last_error text,
  attempts integer, failed_at timestamptz, triggered_by_ref text
) language sql security definer set search_path to '' as $function$
  select a.guarantee_ref,
         trim(coalesce(a.tenant_first_name,'') || ' ' || coalesce(a.tenant_last_name,'')),
         trim(coalesce(a.prop_addr1,'') || ', ' || coalesce(a.prop_postcode,'')),
         c.last_error, c.attempts, c.updated_at, t.guarantee_ref
    from public.refund_cascades c
    join public.applications a on a.id = c.application_id
    join public.applications t on t.id = c.triggered_by
   where c.state = 'failed'
     and public.is_opndoor_staff()
   order by c.updated_at desc
$function$;

revoke all on function public.refund_cascade_failures() from public, anon;
grant execute on function public.refund_cascade_failures() to authenticated, service_role;

comment on function public.refund_cascade_failures() is
  'Co-tenant refunds that Stripe refused or could not be reached for. Opndoor staff only: a half-done cascade is ours to clear up, and the agency sees the per-application activity row instead. Empty for everybody else rather than refused, so the Home tile can call it unconditionally.';
