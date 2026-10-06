#!/bin/bash
# Type-check every edge function with Deno.
#
# WHY THIS EXISTS. `npm test` cannot collect the edge functions (see
# vitest.config.ts) and Deno was not installed on this machine until
# 2026-09-30, so nothing had ever type-checked them. The first run found two
# real defects, one of which crashed the nightly expiry-reminders job.
#
# Deno installs to ~/.deno/bin and is not on PATH in a non-login shell.
set -uo pipefail
export PATH="${DENO_INSTALL:-$HOME/.deno}/bin:$PATH"
command -v deno >/dev/null || { echo "Deno is not installed. curl -fsSL https://deno.land/install.sh | sh" >&2; exit 2; }
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ok=0; bad=0
for f in supabase/functions/*/index.ts supabase/functions/_shared/*.ts; do
  [ -f "$f" ] || continue
  if out=$(deno check "$f" 2>&1); then ok=$((ok+1)); else
    bad=$((bad+1)); echo "FAILED  $f"; echo "$out" | grep -E "TS[0-9]+|error:" | head -4 | sed 's/^/        /'
  fi
done
echo "deno check: $ok clean, $bad failing"
[ "$bad" -eq 0 ]
