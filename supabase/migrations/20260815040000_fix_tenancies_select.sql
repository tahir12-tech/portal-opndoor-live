-- ===========================================================================
-- tenancies_select was written to mean one thing and stored as another.
--
-- Written:  exists (select 1 from public.applications a where a.tenancy_id = id)
-- Stored:   EXISTS (SELECT 1 FROM applications a WHERE (a.tenancy_id = a.id))
--
-- The unqualified `id` bound to the INNER range table, because `applications`
-- has a column of that name. So the predicate is not merely false, it is
-- UNCORRELATED: it references nothing from the outer table, evaluates once for
-- the whole query, and asks "is any application its own tenancy". It denies
-- every row to every caller, superadmin included.
--
-- The four sibling policies in this schema use the correct form of the same
-- idiom and are unaffected:
--   exists (select 1 from public.applications a where a.id = <table>.application_id)
-- They are safe because the outer column is qualified with its own table name.
-- That is the fix here too: qualify both sides, always, inside a subquery.
--
-- Latent only because nothing reads public.tenancies yet. It would have
-- surfaced as "joint tenancies show nothing" on the day one was created, which
-- is a long way from the cause.
-- ===========================================================================

drop policy if exists tenancies_select on public.tenancies;
create policy tenancies_select on public.tenancies
  for select to authenticated
  using (
    exists (
      select 1 from public.applications a
       where a.tenancy_id = public.tenancies.id
    )
  );

-- ---------------------------------------------------------------------------
-- Assert the stored expression, not the text above. The whole defect was that
-- those two differ.
-- ---------------------------------------------------------------------------
do $$
declare v_qual text;
begin
  select qual into v_qual from pg_policies
   where schemaname = 'public' and tablename = 'tenancies' and policyname = 'tenancies_select';

  if v_qual is null then
    raise exception 'tenancies_select is missing';
  end if;
  if position('a.tenancy_id = a.id' in v_qual) > 0 then
    raise exception 'tenancies_select still binds both sides to the inner table: %', v_qual;
  end if;
  if position('tenancies.id' in v_qual) = 0 then
    raise exception 'tenancies_select does not correlate to the outer table: %', v_qual;
  end if;
end $$;
