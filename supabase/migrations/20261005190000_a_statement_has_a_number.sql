-- A STATEMENT HAS A NUMBER, AND IT NEVER CHANGES.
--
-- The reference was derived from the payee's NAME:
--
--     STMT-AG-REGENT-S-LETTINGS-202609
--
-- which is readable and wrong. Rename the agency and September's reference
-- changes, so the statement they filed last month and the one they download
-- today are the same money under two numbers. A finance team reconciling by
-- reference has no way to know those are one document.
--
-- STMT-YYYY-MM-NNNN, with NNNN assigned once per payee per month and stored.
-- Not derived from anything mutable, and not derived at all:
--
--   * A HASH of the payee key would be stable but not sequential, and a
--     statement number that jumps from 0041 to 7318 invites the question of
--     what happened to the 7277 in between.
--   * A RANK over the month's payees, ordered by key, is sequential and stable
--     only until a payee is added: the next agency to earn anything in
--     September would renumber everyone after it, retrospectively, including
--     on statements already sent.
--
-- So it is assigned on first use and kept. The payee key is id-based
-- (partner|level:org_id), so a rename moves nothing.
--
-- ONE SEQUENCE PER MONTH, restarting each month, because the number's job is
-- to identify a statement within the month its period names, and 0001 to 0042
-- is a set somebody can check off against a payment run. A global sequence
-- would say nothing the month does not already say.

create table if not exists public.commission_statement_refs (
  statement_month text    not null,
  payee_key       text    not null,
  seq             integer not null,
  created_at      timestamptz not null default now(),
  primary key (statement_month, payee_key),
  unique (statement_month, seq)
);

comment on table public.commission_statement_refs is
  'The number in a statement reference, assigned once per payee per month and never changed. Keyed on the payee KEY, which is id-based, so renaming an agency does not renumber its statements.';

alter table public.commission_statement_refs enable row level security;

-- Readable by anybody who could already read the statement it numbers: the
-- reference is not a secret, and a screen that shows the statement has to be
-- able to print its number. Writing goes through the function below.
create policy csr_select on public.commission_statement_refs for select to authenticated
  using (public.is_aal2());
revoke all on public.commission_statement_refs from anon;
grant select on public.commission_statement_refs to authenticated;

-- ---------------------------------------------------------------------------
-- ASSIGN ONCE, THEN ALWAYS RETURN THE SAME ANSWER.
--
-- Idempotent by construction: the insert takes the next number for the month
-- and does nothing if the payee already has one, then the select reads
-- whatever is there. Two callers racing for the same payee produce one row and
-- one number, because the primary key settles it; two callers racing for
-- DIFFERENT payees in the same month are serialised by the unique constraint
-- on (month, seq), and the loser retries.
-- ---------------------------------------------------------------------------
create or replace function public.commission_statement_ref(p_month text, p_payee_key text)
returns text
language plpgsql security definer set search_path to ''
as $function$
declare v_seq int; v_try int := 0;
begin
  if p_month !~ '^\d{4}-\d{2}$' then
    raise exception 'A statement month is YYYY-MM.' using errcode = '22023';
  end if;

  loop
    select seq into v_seq from public.commission_statement_refs
     where statement_month = p_month and payee_key = p_payee_key;
    if found then
      return 'STMT-' || p_month || '-' || lpad(v_seq::text, 4, '0');
    end if;

    begin
      insert into public.commission_statement_refs (statement_month, payee_key, seq)
      select p_month, p_payee_key,
             coalesce((select max(r.seq) from public.commission_statement_refs r
                        where r.statement_month = p_month), 0) + 1;
      -- Fall through to the select at the top of the next turn, so the answer
      -- always comes from the stored row rather than from what we just tried.
    exception when unique_violation then
      -- Somebody else took that number between our max() and our insert.
      v_try := v_try + 1;
      if v_try > 20 then raise; end if;
    end;
  end loop;
end $function$;

comment on function public.commission_statement_ref(text, text) is
  'The reference for one payee''s statement in one month: STMT-YYYY-MM-NNNN. Assigned on first call and identical on every call after, so a reference printed on an email in October still matches the portal in March. Retries on a concurrent grab of the same number.';

revoke all on function public.commission_statement_ref(text, text) from public, anon;
grant execute on function public.commission_statement_ref(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- BACKFILL: none, deliberately. No statement has been sent from any
-- environment yet (commission_statement_sends is empty everywhere, and the
-- first send is 1 November), so there is no reference in the world to
-- preserve. The first run of the month assigns 0001 upwards.
-- ---------------------------------------------------------------------------
