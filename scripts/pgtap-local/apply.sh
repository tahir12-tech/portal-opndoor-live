#!/bin/bash
# Apply every migration in filename order to the LOCAL cluster. Never dev.
#
# ONE FIXTURE IS LOAD-BEARING. 20260814020000_my_org_shape.sql asserts the
# Meridian group fixture exists (2 agencies, 3 branches) and RAISES if not.
# No migration creates it -- supabase/fixtures/agency-group.sql does. So a
# clean apply needs the fixture injected at that point. Recorded as a finding.
S=/private/tmp/claude-502/-Users-nicholasdwyer-Downloads-portal-opndoor-liveCode/92662f0b-dd66-45e1-bdfa-ee3a6f2bfb36/scratchpad
PGBIN=$S/pg/pgsql/bin
REPO=${REPO:-/Users/nicholasdwyer/Downloads/portal-fix-the-seven}
PSQL="$PGBIN/psql -h 127.0.0.1 -p 54329 -U postgres -d portal -v ON_ERROR_STOP=1 -q"
n=0
for f in $REPO/supabase/migrations/*.sql; do
  b=$(basename "$f")
  if [ "$b" = "20260814020000_my_org_shape.sql" ]; then
    if ! out=$($PSQL -f "$REPO/supabase/fixtures/agency-group.sql" 2>&1); then
      echo "FIXTURE FAILED before $b"; echo "$out" | head -15; exit 1
    fi
    echo "  [fixture agency-group.sql loaded before $b]"
  fi
  if [ -f "$S/pg/prefix_${b%%_*}.sql" ]; then
    if ! out=$($PSQL -f "$S/pg/prefix_${b%%_*}.sql" 2>&1); then
      echo "PREFIX FAILED before $b"; echo "$out" | head -10; exit 1
    fi
    echo "  [prefix loaded before $b]"
  fi
  n=$((n+1))
  if ! out=$($PSQL -f "$f" 2>&1); then
    echo "FAILED at #$n: $b"
    echo "$out" | grep -E "ERROR|CONTEXT" | head -8
    exit 1
  fi
done
if ! out=$($PSQL -f "$S/pg/local-seed.sql" 2>&1); then
  echo "LOCAL SEED FAILED"; echo "$out" | head -10; exit 1
fi
echo "  [local harness seed loaded]"
echo "APPLIED ALL $n MIGRATIONS CLEANLY"
