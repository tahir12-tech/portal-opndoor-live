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
