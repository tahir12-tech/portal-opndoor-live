# Database tests (`supabase test db`)

pgTAP tests that run against a **freshly-migrated** database — all migrations
applied, then the assertions checked. This is the only layer that exercises real
Postgres GRANTs and RLS: the vitest suite runs in mock mode
(`SUPABASE_ENABLED` is forced `false` when `import.meta.env.MODE === 'test'`, see
`src/lib/supabase.ts`), so it never issues a real `authenticated` query and
cannot see a grant regression.

## Run

```bash
npm run test:db          # = supabase test db
```

Needs the Supabase CLI and Docker (it starts a throwaway Postgres, applies the
migrations, loads pgTAP, runs `supabase/tests/*.test.sql`). No remote
credentials and no network to the dev/prod projects.

### When there is no Docker

```bash
npm run test:db:dev      # = python3 scripts/pgtap-against-dev.py supabase/tests/*.test.sql
```

Runs the same files against **dev** instead of a throwaway Postgres, for
machines with no Docker. pgTAP 1.3.3 is installed into dev's `extensions`
schema, not `public`, so `npm run drift` is unaffected. Every file is
begin/rollback, so dev is not modified.

**CI remains the authority.** This proves the assertions hold against dev,
which carries real seed rows and the accumulated state of every migration ever
applied to it; it does not prove a clean filename-order run. That is what
`npm run drift` is for, and the two together are close to what CI does.

Worth knowing why it exists: `npm run test:db` could not run on the machine
this branch was built on, and the branch has never been pushed, so CI had
never seen it either. The suite had therefore never been executed at all, and
`manager_cannot_promote_themselves.test.sql` had been red since
`20261006550000` without anybody knowing. A test suite nobody can run is not a
test suite.

## What's covered

- **`applications_column_grants.test.sql`** — every column of
  `public.applications` is SELECT-able by `authenticated` except the commission
  denylist (`partner_rate`, `agent_rate`, read only through
  `application_commission_rates()`). This is the guard for the class of bug where
  a migration adds a client-visible column but forgets the
  `grant select (col) on public.applications to authenticated` that
  `20260811180000_revoke_commission_columns.sql` requires. Because it is driven
  from `information_schema`, a new ungranted column fails the test with its own
  name — a red test instead of a silent "permission denied for table
  applications" in front of a staff user.

## When it runs

`.github/workflows/ci.yml` runs this on **every push**: the `db-tests` job
installs the Supabase CLI, `supabase db start` applies every migration to a
throwaway Postgres, and `supabase test db --local` runs these tests. So a
migration that adds a client-visible column without its grant turns the push
red — the omission is loud, not a silent 500 in front of a staff user. Run it
locally the same way with `npm run test:db` (needs the Supabase CLI + Docker).

Note the same column-level-grant pattern also applies to `public.partners`
(`partner_rate`/`agent_rate`); a future guard could cover it the same way.
