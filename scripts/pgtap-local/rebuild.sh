#!/bin/bash
S=/private/tmp/claude-502/-Users-nicholasdwyer-Downloads-portal-opndoor-liveCode/92662f0b-dd66-45e1-bdfa-ee3a6f2bfb36/scratchpad
PGBIN=$S/pg/pgsql/bin
$PGBIN/dropdb   -h 127.0.0.1 -p 54329 -U postgres --if-exists portal
$PGBIN/createdb -h 127.0.0.1 -p 54329 -U postgres portal
$PGBIN/psql -h 127.0.0.1 -p 54329 -U postgres -d portal -v ON_ERROR_STOP=1 -q -f $S/pg/bootstrap.sql || exit 1
echo "clean database 'portal' ready"
