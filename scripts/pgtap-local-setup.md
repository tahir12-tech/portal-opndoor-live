# Running the database suite with no Docker and no dev

`npm run test:db` is `supabase test db`, which needs Docker to start a
throwaway freshly-migrated Postgres. Docker is not installed on this machine.
`npm run test:db:dev` runs the same files against the **dev cloud project**,
which is fine normally and useless the moment the instruction is "do not touch
the dev project".

This document is the third way: a real Postgres, local, built by applying
every migration in filename order to an empty database.

**It is a stronger test than the dev runner, not a weaker one.** Dev carries
real seed rows and the accumulated state of 333 migrations applied over weeks,
so a pass there proves the assertions hold against *that* state. This cluster
proves a **clean apply**, which is what CI does and what `npm run drift` only
approximates by computing the final state statically.

Green as of 2026-09-29: **53 files, 850 assertions, 0 failing.**

## What it costs

A 309 MB Postgres download, unpacked to about 100 MB, living in the session
scratchpad rather than the repo. Setup takes a few minutes; a full rebuild and
re-apply afterwards takes **about ten seconds**.

## Building it from nothing

Everything lives under one directory, `$PGLOCAL`, which defaults to the
scratchpad path baked into `scripts/pgtap-local.sh`. Override with the
`PGLOCAL` environment variable.

### 1. Postgres binaries

No Homebrew, MacPorts or Docker is needed. EnterpriseDB publish a plain zip of
the binaries:

```
curl -sL -o pg16.zip \
  https://get.enterprisedb.com/postgresql/postgresql-16.4-1-osx-binaries.zip
unzip -q pg16.zip            # gives ./pgsql/bin/...
```

### 2. Stub the two extensions Supabase has and a stock build does not

The migrations `create extension pg_cron` and `pg_net`. Neither ships with
Postgres. Both are stubbed as **real extensions** -- control file plus SQL in
`pgsql/share/postgresql/extension/` -- so `create extension if not exists`
succeeds and the objects the product actually uses exist:

- `pg_cron` -> `cron.job`, `cron.job_run_details`, `cron.schedule` (both
  arities), `cron.unschedule` (both arities)
- `pg_net` -> `net.http_request_queue`, `net._http_response`, `net.http_post`,
  `net.http_get`

The stubs record rather than perform: `net.http_post` queues a row instead of
making a request. That is correct for testing and is the one place this
cluster deliberately differs from dev.

### 3. Cluster and roles

```
initdb -D data -U postgres --encoding=UTF8 --locale=C
pg_ctl -D data -o "-p 54329 -c listen_addresses=127.0.0.1 \
        -c unix_socket_directories=''" -l server.log start
```

TCP on loopback, not a Unix socket: the scratchpad path is longer than the
103-byte socket-path limit.

Then `roles.sql` once per cluster (roles are cluster-wide): `anon`,
`authenticated`, `service_role`, `authenticator`.

### 4. Bootstrap, per database

`bootstrap.sql` creates the Supabase scaffolding the migrations assume:
schemas `auth`, `extensions`, `storage`, `cron`, `net`, `vault`,
`graphql_public`; `pgcrypto` and `uuid-ossp` into `extensions`; the `auth`
tables this codebase touches (`users`, `identities`, `sessions`,
`mfa_factors`); and `auth.uid()`, `auth.jwt()`, `auth.role()`, `auth.email()`
with the same bodies Supabase ships.

**The load-bearing line** is the default privileges:

```sql
alter default privileges in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
```

Supabase grants ALL on every new public table to `anon` and `authenticated`,
and several findings turn on exactly that -- B19 is entirely about it. A local
database without this line would measure a **different product** and would
quietly pass tests that should fail.

### 5. Apply the migrations

`apply.sh` runs all 333 in filename order. Two of them need data that no
migration creates; see "Two clean-apply blockers" below.

### 6. pgTAP

pgTAP 1.3.3 has no C sources, so it needs no compiled module:

```
curl -sL -o pgtap.zip \
  https://github.com/theory/pgtap/releases/download/v1.3.3/pgtap-1.3.3.zip
unzip -q pgtap.zip && cd pgtap-1.3.3
make PG_CONFIG=../pgsql/bin/pg_config     # builds sql/pgtap.sql
```

`make` fails on the last step, generating `uninstall_pgtap.sql`, because it
shells out to an EDB Perl that is not there. That target is not needed and
`sql/pgtap.sql` is already built by then.

Install it into `extensions`, matching dev, so nothing lands in `public` and
the drift picture is unchanged.

## Two clean-apply blockers, which are findings in their own right

**A clean apply of this migration tree does not succeed on its own.** Two
migrations assert on data that no migration creates. Because nothing has been
pushed, CI has never run them either, so this had not been discovered.

1. **`20260814020000_my_org_shape.sql`** raises
   `the group fixture is not the shape this rule was written against` unless
   the `meridian-group` partner exists with exactly 2 agencies and 3 branches.
   Nothing in `supabase/migrations/` creates it --
   `supabase/fixtures/agency-group.sql` does. `apply.sh` therefore loads that
   fixture immediately before this migration.

2. **`20261006300000_nobody_works_here_without_a_position.sql`** refuses to
   finish while any active estate user holds no position and has no home
   branch to derive one from. The fixture from step 1 creates exactly such a
   user, `negotiator@meridian.invalid`. `apply.sh` places unpositioned estate
   users at their partner's first branch beforehand, which is what a human
   would do.

Both are **data** steps, not schema ones, so the schema this cluster produces
is still the real clean-apply schema.

## The local harness seed

`local-seed.sql` supplies two things dev has and an empty database does not.
Without them two tests fail for reasons that are nothing to do with the
product:

1. **An opndoor superadmin.** Several tests build a JWT from
   `(select id from public.users where role='superadmin' and status='active')`.
   With no such row the subselect is NULL, string concatenation makes the
   whole claims JSON NULL, and every guard reads as "no second factor" --
   surfacing as a bare `MFA required`. The fixtures create management and
   referrer users only.

2. **One attributed HTTP response.** `health_tells_you_what_to_do` asserts
   `bool_and(e ? 'job')` over `recent_http`. Over an **empty** array
   `bool_and` returns NULL, so the assertion fails vacuously. Dev has 546 such
   rows. One job run plus one response inside its five-minute correlation
   window makes the assertion real.

The second is worth noting as a mild test weakness: written with a `coalesce`
it would pass vacuously on an empty database instead of failing, which is
arguably worse.

## Running it

```
bash scripts/pgtap-local.sh                          # the whole suite
bash scripts/pgtap-local.sh supabase/tests/x.test.sql  # one file
```

Exit code is non-zero if anything fails or errors.

## Rebuilding after a migration change

Add the new migration, then rebuild from empty and re-apply. About ten
seconds. **Never** apply a correction by re-running an edited migration
against a cluster that already has it -- that is the rule in CLAUDE.md, and it
matters here for the same reason it matters on dev: the cluster stops
agreeing with a clean filename-order run, and every test then measures the
wrong database.
