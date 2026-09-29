#!/bin/bash
# Run the pgTAP suite against a LOCAL Postgres built by applying every
# migration in filename order to an empty database.
#
# WHY THIS EXISTS. There were two ways to run the suite and both are closed
# when dev is off limits:
#
#   npm run test:db      is `supabase test db`, which needs Docker. Not
#                        installed on this machine.
#   npm run test:db:dev  runs the files against the DEV cloud project. Fine
#                        normally, useless when the instruction is "do not
#                        touch the dev project".
#
# So this builds a real Postgres locally and runs against that. It is also a
# STRONGER test than the dev runner, and that is worth saying: dev carries
# real seed rows and the accumulated state of 333 applied migrations, so a
# pass there proves the assertions hold against *that* state. This cluster is
# built by applying all 333 files in order to an EMPTY database, which is what
# CI does and what `npm run drift` only approximates statically.
#
# SETUP lives in the scratchpad, not the repo, because it is a 300 MB Postgres
# build: see PGLOCAL below. scripts/pgtap-local-setup.md records how to
# rebuild it from nothing.
set -uo pipefail

PGLOCAL="${PGLOCAL:-/private/tmp/claude-502/-Users-nicholasdwyer-Downloads-portal-opndoor-liveCode/92662f0b-dd66-45e1-bdfa-ee3a6f2bfb36/scratchpad/pg}"
PGBIN="$PGLOCAL/pgsql/bin"
PGPORT="${PGPORT:-54329}"
PGDB="${PGDB:-portal}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -x "$PGBIN/psql" ]; then
  echo "No local Postgres at $PGLOCAL. See scripts/pgtap-local-setup.md." >&2
  exit 2
fi
if ! "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" -q; then
  echo "Local Postgres is not running on port $PGPORT. See scripts/pgtap-local-setup.md." >&2
  exit 2
fi

files=("$@")
if [ ${#files[@]} -eq 0 ]; then
  files=("$REPO"/supabase/tests/*.test.sql)
fi

total_ok=0 total_fail=0 errored=0 nfiles=0
failed_names=()

for f in "${files[@]}"; do
  nfiles=$((nfiles + 1))
  name="$(basename "$f")"
  out=$(PGOPTIONS="--search_path=public,extensions" "$PGBIN/psql" \
          -h 127.0.0.1 -p "$PGPORT" -U postgres -d "$PGDB" -q -t -A -f "$f" 2>&1)
  ok=$(grep -c '^ok [0-9]' <<<"$out")
  nok=$(grep -c '^not ok [0-9]' <<<"$out")
  err=$(grep -c '^psql:.*ERROR' <<<"$out")
  total_ok=$((total_ok + ok)); total_fail=$((total_fail + nok))
  if [ "$err" -gt 0 ]; then
    errored=$((errored + 1)); failed_names+=("$name")
    echo "ERROR $name"
    grep -E '^psql:.*ERROR' <<<"$out" | head -3 | sed 's/^/        /'
  elif [ "$nok" -gt 0 ]; then
    failed_names+=("$name")
    echo "FAIL  $name  $ok ok, $nok failing"
    grep '^not ok' <<<"$out" | head -6 | sed 's/^/        /'
  else
    echo "pass  $name  $ok ok, 0 failing"
  fi
done

echo
echo "files: $nfiles   passing assertions: $total_ok   failing assertions: $total_fail   errored files: $errored"
if [ ${#failed_names[@]} -gt 0 ]; then
  echo "not green: ${failed_names[*]}"
  exit 1
fi
