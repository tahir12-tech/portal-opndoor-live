#!/bin/bash
S=/private/tmp/claude-502/-Users-nicholasdwyer-Downloads-portal-opndoor-liveCode/92662f0b-dd66-45e1-bdfa-ee3a6f2bfb36/scratchpad
PGBIN=$S/pg/pgsql/bin
# Into `extensions`, exactly where dev has it, so nothing lands in public and
# the drift picture is unchanged.
{ echo "set search_path = extensions, public;"; cat $S/pg/pgtap-1.3.3/sql/pgtap.sql; } \
  | $PGBIN/psql -h 127.0.0.1 -p 54329 -U postgres -d portal -v ON_ERROR_STOP=1 -q 2>&1 | grep -E "ERROR" | head -5
$PGBIN/psql -h 127.0.0.1 -p 54329 -U postgres -d portal -tAc \
  "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='extensions' and p.proname in ('plan','finish','ok','is','throws_ok','lives_ok')"
