# Handover

Written for the developer taking this over. Assumes no knowledge of the session
that produced it.

**Status:** in progress. This document is updated as work lands. See
[Open items](#open-items-for-you) for what needs you.

---

## 1. What this working copy is

This is a copy of the live Opndoor portal codebase, taken so that changes can be
designed against a disposable environment rather than production.

The portal runs the guarantor service: partner staff refer a tenant who has
failed referencing, the tenant pays one month's rent through a tokenised link,
and a Deed of Guarantee is issued through PandaDoc.

Because it is a copy of live, it arrived still wired to the live Supabase
project. The first piece of work was disconnecting it. That is what section 2
covers.

### The rule this tree is built under

Changes here are **additive wherever possible**: new files and new migrations,
not edits to existing ones. The reason is that this tree gets reconciled against
live later, and additive changes merge cleanly while edits to existing files
produce conflicts that have to be resolved by hand under time pressure.

Where an existing file *was* modified, it is called out explicitly below with
the reason. Treat every such case as something to check rather than assume.

---

## 2. Disconnecting this copy from production

### Why

The tree was pointed at the live Supabase project `xogpsaoyprgmxdkmcype`
("portal.opndoor.Live") and carried a **live-mode Stripe publishable key**. Any
`supabase` CLI command run in it would have targeted production, and any local
run of the app would have talked to the live database and the live Stripe
account.

It is now pointed at `nfufwcpgrhfgwtphegca` ("opndoor-matt-dev"), a disposable
project.

### What changed

**Deleted `supabase/.temp/`.** Untracked CLI state directory. It held
`project-ref` and `linked-project.json` naming the live project, plus a
`pooler-url` with the live database host. Deleting it is safe: the Supabase CLI
regenerates this directory on the next `link`.

**Replaced `.env.local`.** It previously set `VITE_SUPABASE_URL` to the live
project and `VITE_STRIPE_PUBLISHABLE_KEY` to a `pk_live_` key. It now contains
only three lines pointing at the dev project with a Stripe **test** publishable
key.

This file is gitignored (`.env.*` in [.gitignore](.gitignore)), so none of the
live values were ever committed. Verified, not assumed.

**Removed a tracked CLI artefact that was leaking the live ref into git.**
See section 3, which is the part most worth your attention.

### A CLI version trap, if you script any of this

`npx supabase link --project-ref <ref>` **fails on CLI 2.112.0**, which is what
a bare `npx supabase` resolves to at the time of writing. It dies with:

```
LegacyLinkApiKeysNetworkError: failed to get api keys: SchemaError(
  Expected a string matching the RegExp ...T...Z$ at [2]["inserted_at"])
```

The API returns an `inserted_at` timestamp in a format the CLI's validator
rejects. This is a CLI bug, not a problem with the project or your credentials.

The trap is that **it half-succeeds**. It writes `linked-project.json` before it
crashes but never writes `project-ref`. So the directory looks linked while the
CLI still reports "Cannot find project ref. Have you run supabase link?".

**Pin to `supabase@2.111.0`**, which links cleanly:

```sh
npx -y supabase@2.111.0 link --project-ref nfufwcpgrhfgwtphegca
```

If you automate linking anywhere, pin the version rather than tracking latest.

### How to verify the disconnection yourself

```sh
cat supabase/.temp/project-ref          # expect: nfufwcpgrhfgwtphegca
cat supabase/.temp/linked-project.json  # expect: name "opndoor-matt-dev"
grep -r xogpsaoyprgmxdkmcype supabase/.temp/   # expect: no matches
git grep xogpsaoyprgmxdkmcype                  # expect: no matches
```

The last one is the important one. It asserts the live ref is not in any tracked
file.

---

## 3. The stray CLI artefact (worth reading)

`supabase/functions/supabase/.temp/linked-project.json` was **tracked by git**
and contained the live project ref. It had been committed and was present at
`HEAD`.

### Why .gitignore did not catch it

`.gitignore` contained:

```
supabase/.temp
```

A gitignore pattern containing a slash is **anchored to the repository root**.
So that rule covered `supabase/.temp` and nothing else. It never applied to the
nested `supabase/functions/supabase/.temp/`, which is where a CLI invocation run
from inside `supabase/functions/` had deposited its state.

### The fix

The file was deleted, and a bare pattern added:

```
.temp/
```

A pattern with no slash (other than a trailing one) matches **at any depth**, so
this catches the artefact wherever the CLI drops it. The original anchored rule
was left in place; it is harmless and removing it would be a needless edit.

Verify with:

```sh
git check-ignore -v supabase/functions/supabase/.temp/linked-project.json
```

### Deliberate departure from the rule

This modified two existing tracked files rather than adding new ones, which
departs from the additive-only rule in section 1. The reasoning: the deleted
file is generated CLI state, not application code, and leaving it in place would
mean the live project ref stays in git history going forward. The `.gitignore`
edit is additive within the file (lines added, nothing removed or reordered), so
it should merge without conflict.

Commit: `0bc7be2`.

### Still outstanding on this

Deleting the file removes it from the working tree and from future commits. It
**does not remove it from git history**. The live ref is still recoverable from
earlier commits in this repo and, more importantly, **in the live repository
this was copied from**, where the same file is presumably still tracked.

A Supabase project ref is not a credential. It is not secret in the way an API
key is, and RLS plus auth are what actually protect the project. But it should
not be in version control, and the same nested `.temp` directory in the live
repo will keep re-committing CLI state. Raising it with whoever owns that repo
is worthwhile.

---

## 4. Secret and reference audit

**Status: in progress.** A full read-only sweep of the tree is running, covering
Supabase project refs, Stripe credentials, third-party API keys (PandaDoc,
Resend, address lookup), JWTs and service-role keys, hardcoded production URLs,
and git history.

Every candidate is being re-checked against the actual file before it is
reported, to separate a genuine committed credential from the same string
appearing in documentation, in a test fixture, or as a variable name in a guard
clause.

This section will be filled in with the results. Anything found under
`supabase/migrations/` will be listed but **not changed**, because migrations
that have already been applied to live cannot be edited retroactively without
diverging the two projects.

---

## 5. Open items for you

| # | Item | Why it needs you |
| - | ---- | ---------------- |
| 1 | Supply the Supabase **anon key** for `nfufwcpgrhfgwtphegca` | `.env.local` currently has the placeholder `REPLACE_ME_ANON_KEY_FOR_nfufwcpgrhfgwtphegca`. The app will not connect until this is a real key. |
| 2 | Confirm edge function secrets are set on the dev project | Stripe secret key, Stripe webhook secret, PandaDoc API key and template id, Resend key. These live as Edge Function secrets on the Supabase project, never in this repo. The dev project needs its own set, pointed at **test/sandbox** credentials. |
| 3 | Register a Stripe **test-mode** webhook against the dev project | The live webhook points at the live functions URL. Payment flows will not complete in dev without a test-mode endpoint and its own signing secret. |
| 4 | Review the audit findings in section 4 | Particularly anything under `supabase/migrations/`, which has deliberately been left alone. |

### Deliberately not done

- **`VITE_ADDRESS_LOOKUP_KEY` is not set.** The New Application form falls back
  to manual address entry. This is an accepted limitation in dev, not a bug.
- **`VITE_PANDADOC_SANDBOX` is not set.** The deed UI will not show the
  "Sandbox" badge. The flag is cosmetic; it does not control which PandaDoc
  environment is used. That is determined by the server-side API key.
- **Nothing under `supabase/migrations/` has been touched.**
- **Git history has not been rewritten.** See section 3.

---

## 6. Environment reference

| Project ref | Name | Role |
| ----------- | ---- | ---- |
| `nfufwcpgrhfgwtphegca` | opndoor-matt-dev | **This tree targets this.** Disposable. |
| `xogpsaoyprgmxdkmcype` | portal.opndoor.Live | Live production. Do not link or push here from this tree. |
| `pwftaqtrrqtilxlvwxjd` | mdwyer@opndoor.co | A separate project. Appears in this tree; see section 4. |

Only ever link or push this working copy at `nfufwcpgrhfgwtphegca`.
