-- A REFUND AFTER A STATEMENT HAS BEEN SENT IS A QUESTION, NOT A CORRECTION.
--
-- Matt, 2026-10-01, verbatim: "Refund after a commission statement has been
-- sent: when a refund lands on an application whose commission was already on
-- a sent statement, raise an internal alert to Opndoor naming the payee, the
-- statement reference and the commission affected. On that alert, Opndoor
-- admin chooses, with a confirmation box: (a) reissue a corrected statement to
-- the payee, or (b) carry the amount as a deduction line on the payee's next
-- statement. Nothing happens automatically. Record who chose what and when."
--
-- Tests: supabase/tests/a_refund_after_a_statement_is_a_question.test.sql
--
-- =========================================================================
-- "NOTHING HAPPENS AUTOMATICALLY" IS THE DESIGN, NOT A CAUTION
-- =========================================================================
--
-- The obvious build is to reverse the commission and move on. He is refusing
-- that, and he is right: a statement already sent is a document somebody may
-- have invoiced against. Changing what it said without telling them is how a
-- payee's books stop matching ours, and the payee finds out when a remittance
-- does not reconcile.
--
-- So a refund raises a QUESTION, and a person answers it. Everything here is
-- about recording the question accurately and the answer durably.
--
-- =========================================================================
-- WHY THE QUESTION IS COMPUTED BEFORE THE REFUND IS WRITTEN
-- =========================================================================
--
-- `commission_statement_lines` EXCLUDES refunded applications: "commission on
-- fees paid in the month, refunds excluded" is the basis printed on every
-- statement. So the moment apply_stripe_refund writes payment_state =
-- 'refunded', the line disappears from the recomputation -- which is correct
-- for next month and useless for this question, because the question is
-- precisely "what did the document we already sent say?".
--
-- The raiser therefore runs BEFORE the update, while the line is still there,
-- and reads the SAME function the run read. Not a reimplementation of the
-- arithmetic: the one source of truth, so the amount in the question is the
-- amount on the paper by construction rather than by agreement.
--
-- JOINED ON guarantee_ref, which is unique on applications and is already in
-- that function's output. The alternative was adding application_id to its
-- RETURNS TABLE, which cannot be done with CREATE OR REPLACE and would have
-- meant dropping and recreating a function on the money path for a column
-- that is already there under another name.
--
-- =========================================================================
-- WHAT "ALREADY ON A SENT STATEMENT" MEANS, EXACTLY
-- =========================================================================
--
-- `commission_statement_sends` holds one row per (month, payee) actually
-- posted. A line is on a sent statement when its payee_key appears there for
-- the month the application paid in. Not "the month has passed", not "a
-- statement probably went": the row is the evidence that a document left the
-- building, and nothing else is.
--
-- A refund of an application whose month was never posted needs no question
-- at all: next month's run will simply not include it, which is the whole of
-- the correct behaviour.

-- ---------------------------------------------------------------------------
-- 1. AN ALERT TYPE IN THE EXISTING CATALOGUE, not a new mechanism.
-- ---------------------------------------------------------------------------
-- OPERATIONS, and the group test is the one the catalogue states: "somebody
-- has to do something". Nothing moves until a person chooses, which is
-- literally that. It is not Critical -- no guarantee is at risk and no
-- identity is wrong -- and it is not Commercial, where `lapse` and
-- `renewal_notice` are things that happened rather than things to do.
create or replace function public.ops_notification_types()
returns table(alert_type text, label text, grp text, critical boolean, ord int)
language sql immutable as $$
  select * from (values
    -- CRITICAL: a guarantee is at risk, or money or identity is wrong.
    ('deed_claim_failed',              'Deed could not be claimed after payment', 'Critical', true,  1),
    ('deed_void_failed',               'Deed could not be voided after a refund', 'Critical', true,  2),
    ('deed_executed_after_refund',     'Deed executed after the fee was refunded','Critical', true,  3),
    ('deed_pdf_not_stored',            'Executed deed could not be archived',     'Critical', true,  4),
    ('deed_pdf_unavailable',           'Executed deed could not be fetched',      'Critical', true,  5),
    ('deed_sweep_all_failed',          'The whole deed sweep failed',             'Critical', true,  6),
    ('stripe_refund_not_applied',      'Stripe refunded and the row did not',     'Critical', true,  7),
    -- The closest thing the platform has to a security event.
    ('pandadoc_signature_rejected',    'Webhook signature rejected',              'Critical', true,  8),
    ('stripe_livemode_mismatch',       'Live/sandbox mismatch (payments)',        'Critical', true,  9),
    ('pandadoc_livemode_mismatch',     'Live/sandbox mismatch (deeds)',           'Critical', true, 10),

    -- OPERATIONS: somebody has to do something.
    ('deed_awaiting_staff_send',       'Deed needs a staff send',                 'Operations', false, 20),
    ('deed_no_delivery_contact',       'Deed has nobody to go to',                'Operations', false, 21),
    ('deed_delivery_target_unreadable','Deed recipients could not be resolved',   'Operations', false, 22),
    ('expiry_reminder_unaddressed',    'Expiry reminder reached nobody',          'Operations', false, 23),
    ('renewal_notice_unaddressed',     'Renewal notice reached nobody',           'Operations', false, 24),
    ('deed_sweep_failed',              'One application failed in the sweep',     'Operations', false, 25),
    ('deed_document_unattached',       'Document not attached to its application','Operations', false, 26),
    ('deed_orphan_document',           'Provider document with no application',   'Operations', false, 27),
    ('deed_stamp_partial',             'Deed stamped incompletely',               'Operations', false, 28),
    ('pandadoc_completed_unknown_document','Completion for an unknown document',  'Operations', false, 29),
    ('webhook_error',                  'An inbound webhook threw',                'Operations', false, 30),
    ('cron_error',                     'A scheduled job threw',                   'Operations', false, 31),
    ('commission_refunded_after_statement',
                                       'Refund on commission already statemented','Operations', false, 32),

    -- COMMERCIAL.
    ('lapse',                          'A guarantee lapsed',                      'Commercial', false, 40),
    ('renewal_notice',                 'A renewal is due',                        'Commercial', false, 41),

    -- INFORMATION.
    ('hubspot_map_drift',              'CRM mapping has drifted',                 'Information', false, 50)
  ) as t(alert_type, label, grp, critical, ord)
$$;

-- ---------------------------------------------------------------------------
-- 2. AN INCIDENT CAN NAME ITS APPLICATION.
-- ---------------------------------------------------------------------------
-- WHY THIS HAD TO CHANGE. ops_alerts dedupes on
-- (alert_type, coalesce(application_id, sentinel), hour_bucket), and
-- report_ops_incident has always passed NULL. For every existing caller that
-- is right: "the whole deed sweep failed" twice in an hour is one alert.
--
-- Here it is wrong. Two different applications refunded in the same hour are
-- two different questions about two different payees, and the second would
-- have been swallowed by the dedupe index and never raised. Nobody would have
-- known, because a suppressed alert looks exactly like no alert.
--
-- DROPPED AND RECREATED WITH A DEFAULT rather than overloaded: an overload
-- would leave report_ops_incident(text, text) and
-- report_ops_incident(text, text, uuid) both resolvable from a two-argument
-- call and Postgres would refuse it as ambiguous. Every existing caller passes
-- named arguments p_type and p_detail and resolves to this one unchanged.
drop function if exists public.report_ops_incident(text, text);

create or replace function public.report_ops_incident(
  p_type text, p_detail text, p_application_id uuid default null
)
returns void language plpgsql security definer set search_path to '' as $function$
declare v_secret text; v_rows int; v_base text;
begin
  begin
    insert into public.ops_alerts (alert_type, application_id, hour_bucket, detail)
    values (p_type, p_application_id, date_trunc('hour', now()), left(coalesce(p_detail,''), 500))
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then return; end if;

    v_base := public.ops_functions_base_url();
    if v_base is null then return; end if;

    select secret into v_secret from public.ops_secrets where name = 'reminders_cron';
    perform net.http_post(
      url := v_base || '/functions/v1/ops-alert',
      headers := jsonb_build_object('Content-Type','application/json','x-ops-secret', coalesce(v_secret,'')),
      body := jsonb_build_object('alert_type', p_type, 'application_id', p_application_id, 'message', coalesce(p_detail,''))
    );
  exception when others then
    null; -- best effort: never propagate an alerting failure to the caller
  end;
end $function$;

revoke all on function public.report_ops_incident(text, text, uuid) from public, anon, authenticated;
grant execute on function public.report_ops_incident(text, text, uuid) to service_role;

comment on function public.report_ops_incident(text, text, uuid) is
  'Record an ops alert and best-effort notify. p_application_id participates in the hourly dedupe key, so two alerts of one type about two different applications in one hour are two alerts.';

-- ---------------------------------------------------------------------------
-- 3. THE QUESTION ITSELF.
-- ---------------------------------------------------------------------------
create table if not exists public.statement_refund_questions (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.applications(id) on delete cascade,
  /* COPIED, not joined, and deliberately. The guarantee reference, the payee's
     name and the amount are what the SENT DOCUMENT said. A join would show
     what they are today, and the entire point of this row is the discrepancy
     between the two. */
  guarantee_ref   text not null,
  payee_key       text not null,
  payee_name      text not null,
  payee_level     text not null,
  statement_month text not null,
  statement_reference text,
  commission      numeric not null,
  raised_at       timestamptz not null default now(),

  /* THE ANSWER. Null until a person gives one: that is "nothing happens
     automatically", expressed as a column that starts empty. */
  decision        text check (decision in ('reissue', 'deduct')),
  decided_by      uuid references public.users(id),
  decided_at      timestamptz,

  /* (b) ONLY, and this is what stops the choice being a note to nobody: the
     month whose statement actually carried the deduction line. Until it is
     set, the deduction is still owed and the run will still pick it up. */
  settled_month   text,
  settled_at      timestamptz,

  /* (a) ONLY: the reference the corrected statement went out under. A
     reissued statement needs its OWN number, or two different documents
     share one and reconciliation breaks on the thing it is keyed by. */
  reissue_reference text,
  reissued_at     timestamptz,

  constraint statement_refund_questions_decided_together check (
    (decision is null and decided_by is null and decided_at is null)
    or (decision is not null and decided_at is not null)
  )
);

/* ONE QUESTION PER PAYEE PER APPLICATION PER MONTH. Stripe redelivers, and a
   redelivered webhook must not ask the same question twice. */
create unique index if not exists statement_refund_questions_once
  on public.statement_refund_questions (application_id, payee_key, statement_month);

/* THE TWO READS: the open list, and the deductions owed to a payee. */
create index if not exists statement_refund_questions_open_idx
  on public.statement_refund_questions (raised_at desc) where decision is null;
create index if not exists statement_refund_questions_owed_idx
  on public.statement_refund_questions (payee_key) where decision = 'deduct' and settled_month is null;

comment on table public.statement_refund_questions is
  'A refund landed on commission that was already on a sent statement. One row per payee per application, holding what the SENT document said, and the decision a person made about it. Never answered automatically.';

alter table public.statement_refund_questions enable row level security;
-- No policies. Read through refund_questions_open(), written through
-- raise_refund_after_statement() and decide_refund_question(), all definer.

-- ---------------------------------------------------------------------------
-- 4. RAISING IT.
-- ---------------------------------------------------------------------------
create or replace function public.raise_refund_after_statement(p_application uuid)
returns int
language plpgsql security definer set search_path to ''
as $function$
declare
  v_ref text; v_month_start date; v_month text; v_live boolean;
  r record; v_made int := 0; v_names text := ''; v_total numeric := 0;
begin
  select a.guarantee_ref,
         date_trunc('month', (a.paid_at at time zone 'Europe/London'))::date,
         to_char((a.paid_at at time zone 'Europe/London'), 'YYYY-MM'),
         a.livemode
    into v_ref, v_month_start, v_month, v_live
    from public.applications a
   where a.id = p_application;

  -- Never paid, so never on a statement. Nothing to ask.
  if v_month is null then return 0; end if;
  -- The statement run reads livemode rows only, so a sandbox row was never
  -- on a document and must not raise a question about one.
  if v_live is not true then return 0; end if;

  for r in
    /* THE SAME FUNCTION THE RUN READ, filtered to this application by the
       reference that is unique to it, and kept only where a statement for
       that payee and month was ACTUALLY POSTED. */
    select l.payee_key, l.org_name, l.level, l.commission
      from public.commission_statement_lines(v_month_start) l
      join public.commission_statement_sends s
        on s.statement_month = v_month and s.payee_key = l.payee_key
     where l.guarantee_ref = v_ref
       and l.commission > 0
  loop
    insert into public.statement_refund_questions (
      application_id, guarantee_ref, payee_key, payee_name, payee_level,
      statement_month, statement_reference, commission
    )
    values (
      p_application, v_ref, r.payee_key, r.org_name, r.level, v_month,
      /* READ, NEVER MINTED. commission_statement_ref assigns a number on
         first read; asking it here would burn the month's next number on a
         question rather than a document. A month that was posted has a row
         by definition, so this is never null in practice and is left
         nullable rather than defaulted to a lie. */
      (select 'STMT-' || v_month || '-' || lpad(x.seq::text, 4, '0')
         from public.commission_statement_refs x
        where x.statement_month = v_month and x.payee_key = r.payee_key),
      r.commission
    )
    on conflict (application_id, payee_key, statement_month) do nothing;

    if found then
      v_made := v_made + 1;
      v_names := v_names || case when v_names = '' then '' else ', ' end
                 || r.org_name || ' (' || to_char(r.commission, 'FM999999990.00') || ')';
      v_total := v_total + r.commission;
    end if;
  end loop;

  if v_made > 0 then
    perform public.report_ops_incident(
      'commission_refunded_after_statement',
      'Refund on ' || v_ref || ', whose commission for ' || v_month
        || ' was already on a sent statement. Affected: ' || v_names
        || '. Total commission in question ' || to_char(v_total, 'FM999999990.00')
        || '. Nothing has been changed: choose on Reconciliation whether to reissue'
        || ' a corrected statement or carry a deduction onto the next one.',
      p_application);
  end if;

  return v_made;
end $function$;

revoke all on function public.raise_refund_after_statement(uuid) from public, anon, authenticated;
grant execute on function public.raise_refund_after_statement(uuid) to service_role;

comment on function public.raise_refund_after_statement(uuid) is
  'Ask the question, if there is one: one row per payee whose SENT statement carried commission for this application. Must be called BEFORE the refund is written, while commission_statement_lines still returns the line.';

-- ---------------------------------------------------------------------------
-- 5. CALLED FROM THE REFUND PATH, BEFORE ANYTHING IS WRITTEN.
-- ---------------------------------------------------------------------------
-- The body is 20261006910000's, verbatim, with one loop added at the top.
-- Copied rather than edited in place because that migration is applied and a
-- correction is a new file.
create or replace function public.apply_stripe_refund(p_payment_intent text, p_refund_id text, p_amount numeric default null::numeric)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare r record; v_basis numeric; v_total_basis numeric; v_total numeric;
begin
  -- THE WHOLE FEE ON THIS PAYMENT, across every application behind it.
  select coalesce(sum(coalesce(a.paid_amount, a.fee_amount, 0)), 0)
    into v_total_basis
    from public.applications a
   where a.stripe_payment_intent_id = p_payment_intent;

  -- MATT'S RULE. An amount that is not the whole fee is refused, and nothing
  -- is written. No amount at all still means the whole fee, which is how
  -- every existing caller behaves and must keep behaving.
  if p_amount is not null and p_amount <> v_total_basis then
    raise exception
      'A refund must be the whole fee of %. Opndoor does not give part refunds; % was reported by Stripe and has not been recorded.',
      v_total_basis::text, p_amount::text
      using errcode = '22023';
  end if;

  /* THE QUESTION IS ASKED FIRST, and the order is the whole of its
     correctness. commission_statement_lines excludes refunded applications,
     so one statement below this point the line is gone and the amount that
     was on the sent document is unrecoverable from the live data.

     AFTER the part-refund refusal, though: a refund that is not going to be
     recorded must not raise a question about a correction nobody is making.

     Best effort, like the alerting it wraps. A fault in asking the question
     must not stop the refund being recorded: Stripe has already moved the
     money, and an unrecorded refund is the worse failure by a distance. The
     row is left for the reconciliation list either way. */
  begin
    for r in
      select id from public.applications
       where stripe_payment_intent_id = p_payment_intent
         and coalesce(payment_state, '') <> 'refunded'
    loop
      perform public.raise_refund_after_statement(r.id);
    end loop;
  exception when others then
    perform public.report_ops_incident(
      'commission_refunded_after_statement',
      'Could not work out whether the refund on payment intent ' || p_payment_intent
        || ' touched a statement that has already been sent. The refund itself HAS been'
        || ' recorded. Check this month''s statements for that guarantee by hand.',
      null);
  end;

  for r in
    select id, paid_amount, fee_amount, refunded_amount, stripe_refund_id
      from public.applications
     where stripe_payment_intent_id = p_payment_intent
  loop
    v_basis := coalesce(r.paid_amount, r.fee_amount, 0);

    -- The same refund redelivered. Stripe retries, and this must not count
    -- the money twice; the rest of the statement is idempotent.
    if r.stripe_refund_id is not distinct from p_refund_id then
      v_total := coalesce(r.refunded_amount, 0);
    else
      v_total := v_basis;
    end if;

    update public.applications set
      stripe_refund_id   = p_refund_id,
      refunded_at        = coalesce(refunded_at, now()),
      refunded_amount    = v_total,
      payment_state      = case when v_total >= v_basis then 'refunded'
                                else 'partially_refunded' end,
      refund_after_start = (tenancy_start <= current_date)
    where id = r.id;
  end loop;
end $function$;

-- ---------------------------------------------------------------------------
-- 6. READING THE OPEN QUESTIONS.
-- ---------------------------------------------------------------------------
create or replace function public.refund_questions_open()
returns table(
  id uuid, guarantee_ref text, tenant_name text, payee_name text, payee_level text,
  statement_month text, statement_reference text, commission numeric,
  raised_at timestamptz, refunded_at timestamptz
)
language sql stable security definer set search_path to ''
as $function$
  select q.id, q.guarantee_ref,
         btrim(coalesce(a.tenant_first_name, '') || ' ' || coalesce(a.tenant_last_name, '')),
         q.payee_name, q.payee_level, q.statement_month, q.statement_reference,
         q.commission, q.raised_at, a.refunded_at
    from public.statement_refund_questions q
    join public.applications a on a.id = q.application_id
   where q.decision is null
     and public.is_opndoor_staff()
   order by q.raised_at desc, q.payee_name
$function$;

revoke all on function public.refund_questions_open() from public, anon;
grant execute on function public.refund_questions_open() to authenticated, service_role;

comment on function public.refund_questions_open() is
  'Refunds that landed on commission already sent on a statement, still awaiting a decision. Opndoor staff only: these are other companies'' commission figures.';

-- ---------------------------------------------------------------------------
-- 7. ANSWERING ONE.
-- ---------------------------------------------------------------------------
create or replace function public.decide_refund_question(p_id uuid, p_decision text)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_who text; q record;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  /* THE SAME GATE THE LIST HAS. Anybody who can read the question can answer
     it and nobody else can. A payee has no business here: the decision is
     about what Opndoor sends them. */
  if not coalesce(public.is_opndoor_staff(), false) then
    raise exception 'Only Opndoor decides what happens to a refunded statement line.' using errcode = '42501';
  end if;
  if coalesce(p_decision, '') not in ('reissue', 'deduct') then
    raise exception 'A decision is either reissue or deduct.' using errcode = '22023';
  end if;

  select * into q from public.statement_refund_questions where id = p_id;
  /* `q.id is null` rather than `if not found`: SELECT INTO leaves every field
     of the record NULL when nothing matched, and the null-safe-guards check
     refuses a bare `if not ...` in front of a raise. FOUND happens to be one
     of the few conditions that genuinely cannot be null, but a rule with an
     exception in it is a rule nobody applies. */
  if q.id is null then
    raise exception 'No such question.' using errcode = '22023';
  end if;
  /* DECIDED ONCE. A second answer would either send a second corrected
     statement or carry the deduction twice, and both are worse than the
     refusal. */
  if q.decision is not null then
    raise exception 'That was already decided on %.', to_char(q.decided_at, 'DD/MM/YYYY') using errcode = '22023';
  end if;

  update public.statement_refund_questions
     set decision = p_decision, decided_by = auth.uid(), decided_at = now()
   where id = p_id;

  select coalesce(nullif(btrim(full_name), ''), email) into v_who
    from public.users where id = auth.uid();

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('statement_refund', p_id,
          case when p_decision = 'reissue' then 'refund_statement_reissue' else 'refund_statement_deduct' end,
          q.payee_name || ': ' || to_char(q.commission, 'FM999999990.00')
            || ' of commission on ' || q.guarantee_ref || ', already sent on '
            || coalesce(q.statement_reference, 'the ' || q.statement_month || ' statement')
            || case when p_decision = 'reissue'
                    then ', to be corrected by a reissued statement'
                    else ', to be carried as a deduction on the next statement' end,
          coalesce(v_who, 'opndoor admin'), auth.uid());
end $function$;

revoke all on function public.decide_refund_question(uuid, text) from public, anon;
grant execute on function public.decide_refund_question(uuid, text) to authenticated, service_role;

comment on function public.decide_refund_question(uuid, text) is
  'Record what Opndoor chose about a refund that hit a sent statement, and who chose it. Decided once: a second answer would reissue twice or deduct twice.';

-- ---------------------------------------------------------------------------
-- 8. THE DEDUCTION ACTUALLY APPEARING.
-- ---------------------------------------------------------------------------
-- "A deduction line must actually appear on the next statement if (b) is
-- chosen, or the choice is a note to nobody."
--
-- NOT FILTERED BY MONTH. Everything outstanding goes on the next statement
-- the payee receives, whenever that is. A deduction decided in March and a
-- payee with no business until July belongs on July's statement, not nowhere.
create or replace function public.statement_deductions(p_month date)
returns table(
  payee_key text, question_id uuid, guarantee_ref text,
  statement_reference text, statement_month text, commission numeric
)
language sql stable security definer set search_path to ''
as $function$
  select q.payee_key, q.id, q.guarantee_ref,
         q.statement_reference, q.statement_month, q.commission
    from public.statement_refund_questions q
   where q.decision = 'deduct'
     and q.settled_month is null
     /* A deduction cannot land on a statement for a month EARLIER than the
        one it was decided in: that statement has already gone. */
     and q.decided_at < (date_trunc('month', p_month) + interval '1 month')
   order by q.payee_key, q.guarantee_ref
$function$;

revoke all on function public.statement_deductions(date) from public, anon, authenticated;
grant execute on function public.statement_deductions(date) to service_role;

comment on function public.statement_deductions(date) is
  'Deductions owed on a payee''s next statement, from refunds that hit a statement already sent. Not filtered to one month: an outstanding deduction waits for the payee''s next statement however long that takes.';

create or replace function public.settle_statement_deductions(p_month text, p_payee_key text)
returns int
language plpgsql security definer set search_path to ''
as $function$
declare v_rows int;
begin
  update public.statement_refund_questions
     set settled_month = p_month, settled_at = now()
   where payee_key = p_payee_key
     and decision = 'deduct'
     and settled_month is null;
  get diagnostics v_rows = row_count;
  return v_rows;
end $function$;

revoke all on function public.settle_statement_deductions(text, text) from public, anon, authenticated;
grant execute on function public.settle_statement_deductions(text, text) to service_role;

comment on function public.settle_statement_deductions(text, text) is
  'Mark a payee''s outstanding deductions as carried, once the statement that carries them has actually been posted. Called by the run after the send succeeds, never before.';

create or replace function public.mark_refund_question_reissued(p_id uuid, p_reference text)
returns void
language sql security definer set search_path to ''
as $function$
  update public.statement_refund_questions
     set reissue_reference = p_reference, reissued_at = now()
   where id = p_id and decision = 'reissue' and reissued_at is null
$function$;

revoke all on function public.mark_refund_question_reissued(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_refund_question_reissued(uuid, text) to service_role;

comment on function public.mark_refund_question_reissued(uuid, text) is
  'Record the reference the corrected statement actually went out under, after it was sent. A reissued statement needs its own number or two documents share one.';
