Before doing anything else in a session, read docs/QUEUE.md. It is the list of
outstanding work. Resume from the first item not done. Every new instruction
from Matt is added to it verbatim and committed before work starts.

---

# The Opndoor referral portal

A guarantor service. Partner staff refer a tenant who failed referencing, the
tenant pays one month's rent through a tokenised link, and a Deed of Guarantee
is issued through PandaDoc.

React + Vite + TypeScript over Supabase: Postgres with RLS in
`supabase/migrations/`, Deno edge functions in `supabase/functions/`, client in
`src/`.

## The one thing to understand before changing anything

There are three rails, and they do not share a boundary shape.

- **The agency rail.** Every letting agency Opndoor onboards shares ONE house
  partner, slug `opndoor-agents`. So `partner_id = app_partner()` is **not** a
  company boundary here: it means "every agency Opndoor has onboarded". The
  agency is the boundary, and it is derived from the caller's POSITION in
  `public.user_scopes`.
- **The supplier rail.** A supplier is its own partner, so there
  `partner_id = app_partner()` IS the company boundary and is correct.
- **The direct rail**, on `opndoor-direct`.

Write authorisation with the `app_may_reach_*` predicates, which know the
difference. `partner_id = app_partner()` on its own is not an authorisation
test on the agency rail, and CI fails a new migration that uses it as one.

Levels: Director (`role = 'management'`, `sees_commission = true`) > Manager
(`role = 'management'`) > Negotiator (`role = 'referrer'`). Everybody on our
own estate holds a position; an unpositioned row is refused by a constraint
trigger.

## Rules

- **Never re-apply an existing migration to dev.** Any correction to an earlier
  migration goes in a NEW migration. Re-running one makes dev disagree with a
  clean filename-order run, and every test then measures the wrong database:
  that is exactly how a revoke that broke every user invite sat green in the
  suite for a day. `npm run drift` computes the final state from the files and
  diffs it against dev; it must be clean.
- The live Supabase project `xogpsaoyprgmxdkmcype` is **never** touched, read or
  written. Dev is `nfufwcpgrhfgwtphegca`.
- `origin` is a third-party live repository. **Matt pushes. Claude only
  commits.** Never push.
- Commit each step by path. Never `git add -A`.
- Typecheck is `npm run typecheck` (`tsc -b --noEmit`). Bare `tsc` compiles
  nothing, because the root tsconfig has `files: []`.
- Tests are `npm test` (`vitest run --environment jsdom`) and
  `npm run test:db` (pgTAP). Never report a bare test total: report added,
  removed and renamed separately.
- Deno is not installed here, so `deno test` and `deno check` cannot run. Syntax
  check an edge function with
  `./node_modules/.bin/esbuild --loader=ts < supabase/functions/<fn>/index.ts`.
- Migrations come before the functions that use them.
- No em dashes in product copy.
- Keep the dev server on 5174 running.
