# Start here

Balal, this is for you. Ten minutes, then you will know where to start.

There are nine documents in this repo and you have read none of them. This one
tells you what happened, what to read, and what to do first.

---

## Two things that will bite you silently. Read these before anything else.

Both look fine when they are wrong. That is why they are at the top.

### 1. The partner API returns 501 to everyone unless one migration matches

`partners.referencing_mode` defaults to `pre_referenced_screened`. The create
path only implements `pre_referenced_open`, so **every `POST /v1/applications`
is refused** until a partner is explicitly set to it.

Migration `20260811090000_rightmove_referencing_mode.sql` does that for
Rightmove. It matches on **slug and name**, because no migration has ever
inserted a partner and this repo does not know their id. **If the production name
is not what it expects, it matches nothing, the push still succeeds, and the API
stays off.**

**When you run `db push` on production, read the output.** You want:

```
NOTICE:  ... referencing_mode pre_referenced_screened -> pre_referenced_open.
         The partner API is now live for them.
```

If you see `WARNING: NO RIGHTMOVE PARTNER MATCHED`, or see neither, fix it by
hand. The SQL is in `HANDOVER.md`, in the box at the very top.

Why it is hard to spot: nothing else about the request fails. The key
authenticates, the scopes pass, the payload validates, and *then* it 501s.

### 2. `verify_jwt` is not in this repo, and a plain redeploy re-enables it

```sh
npx -y supabase@2.111.0 functions deploy partner-api --no-verify-jwt
```

The partner API authenticates with an API key, not a Supabase JWT. With JWT
verification on, the platform rejects every request **before any of this code
runs**, so every partner call returns a `401` that is byte-identical to a bad
key. There is no `config.toml`, so this setting lives in the dashboard and any
plain `functions deploy` silently turns it back on. `stripe-webhook` and
`payment-page` have the same exposure.

---

## What this package is

A working copy of the portal, disconnected from production and pointed at a
disposable dev project, with a month of work on top. It has never been pushed to
your repo. Nothing here has touched the live system.

**What changed, in one page:**

**The partner API.** Partners create applications from their own system instead
of typing them into the portal, and receive webhooks as status changes. Key auth
with scopes, idempotency, rate limits, an error contract, and an outbound webhook
queue with retries and dead-lettering. Base URL is `https://api.opndoor.co/v1`,
which **does not exist yet** and is yours to set up.

**Sandbox, as one mode inside the live system.** Not a second project. An API key
prefix decides it: `opnd_test_` creates sandbox applications, `opnd_live_` creates
real ones. Sandbox uses sandbox Stripe and PandaDoc credentials, sends no opndoor
email, never reaches HubSpot, and its applications are invisible to every role
except through the Dev Centre. A partner rehearses the whole integration and then
swaps the key.

**A fourth role, `developer`, and the Dev Centre.** Monitoring, request logs with
redacted bodies, webhook delivery history with replay and test-event sending,
sandbox, live application metadata, API documentation and an OpenAPI 3.1 spec.

**Partner configuration.** `referencing_mode` plus two capability flags, portal
referrals and API access, editable with an audit trail. Creating a partner
through the product **never worked**: `addPartner` wrote to localStorage and
there was no `create_partner` RPC for it to call. Now there is.

**Nineteen defects found in the live system**, and **fifteen of them fixed here**,
one commit each. `REGRESSION.md` section D asserts every fix. Three could only be
done by you, and they are named below.

---

## What to read, in order

You do not need all of it. Stop when you have what you need.

| # | Document | Why | Time |
| - | -------- | --- | ---- |
| 1 | **`HANDOVER.md`** | The current state of everything. Start with the boxes at the top, then section 7, Open items. | 40 min |
| 2 | **`DEFECTS.md`** | Nineteen defects, worst first, each saying whether it is fixed here. Read defect 1 today: it is the one still open and it is a live credential. | 30 min |
| 3 | **`REGRESSION.md`** | A test plan written to pass on day one, so a failing row means a real change. | Reference |
| 4 | **`PARTNER-DOCS.md`** | What partners are given. Also the source of the docs panel and `openapi.json`. | 15 min |
| 5 | **`PARTNER-API.md`** | **Internal.** Why the API is shaped as it is. Sections carry SUPERSEDED banners where a decision was reversed. | As needed |
| 6 | **`HUBSPOT-SYNC-SPEC.md`** | The sync spec. Built, not a plan. Its constants need your verification. | As needed |
| 7 | **`HANDOVER-MACHINE.md`** | The original 6 July handover. Partly stale; its estate section needs your verification. | As needed |
| 8 | **`SANDBOX-MODE-SCOPE.md`** | Superseded. A record of a decision point, kept as evidence. | Skip |
| — | **`CHANGES-AGAINST-HANDOVER.md`** | What is on the branch and what reviewing it involves. Read this **before** reviewing the diff, not after: about a fifth of the line count is line endings and generated output, and it says which parts matter. | 10 min |

**`PARTNER-API.md` and `PARTNER-DOCS.md` have similar names and opposite
audiences. `-DOCS` goes out. `-API` does not.**

---

## The first five things to do

In this order. The first two are the boxes above.

**1. Read the two boxes at the top of this file.** Ten minutes, and they are the
difference between the API working and it refusing everything while looking
healthy.

**2. Rotate `REMINDERS_CRON_SECRET`.** A real credential, committed and pushed to
`origin/main`. Defect 1. Rotating is the fix; deleting the line is not, because
history keeps it. **This is the only defect on the list that is both urgent and
still open**, and it is open because nobody working from a repository could close
it.

**3. Set `EMAIL_REVIEW_ADDRESS` on every non-production environment.** The test
redirect is restored, as one switch in one shared helper, and that variable is
the switch. Set: all mail goes to the review inbox, including the PandaDoc deed
that a tenant would otherwise receive and sign. Unset: mail goes to the real
recipient, which is what production wants. Defect 4.

**4. Run the regression plan against a disposable project.** `REGRESSION.md`.
Section A is the lifecycle, B the partner API, **D the defect fixes**. D is the
one that tells you whether what was fixed here actually holds on your
infrastructure.

**5. Then decide whether to take any of this.** Nothing is pushed. The branch is
`partner-api`, one logical change per commit, so you can take or revert any
single defect fix on its own.

---

## Two different conversations

These have different urgency and different owners, and mixing them is how the
urgent thing waits behind the interesting thing.

### Yours, on the live system, and only three of them

**Fifteen of the nineteen defects are fixed in this tree**, one commit each so any
can be reverted independently, with `REGRESSION.md` section D asserting each fix.
That leaves three, and they are three because nobody working from a repository
could close them:

| | What | Why it had to wait for you |
| - | ---- | -------------------------- |
| **Urgent** | **Rotate `REMINDERS_CRON_SECRET`** | Defect 1. It is committed and pushed, so deleting the line retracts nothing: the value is in history and in every clone. Only rotation ends it, and that means Vault, the Edge Function secret and reseeding `ops_secrets`. All three are live infrastructure. |
| | **Schedule the webhook dispatcher** | A migration cannot know which project it is applied to, and hardcoding a URL is exactly how defect 2 happened. The statement is in the header of `20260810170000`. |
| | **Schedule the HubSpot map check** | Same reason. The check is built and is one call. Weekly is enough. Defect 17. |

Two more need your eyes rather than your hands:

| | What | What to do |
| - | ---- | ---------- |
| | **Defect 5**, the schema cannot be rebuilt | Fixed by two migrations that are no-ops where the work was already done by hand. Verify on production rather than assuming. |
| | **Defect 14**, the PandaDoc signature has no timestamp | The unsafe comparison is fixed. Whether PandaDoc can sign a timestamp is a question for them, and the answer decides whether more is needed. |

### Ours to hand over, which only matters if you ship this

| | What | Where |
| - | ---- | ----- |
| **Blocker** | Watch the Rightmove migration output on the production push | Box 1 above |
| **Blocker** | `api.opndoor.co` does not exist. No partner gets a key until it does | `HANDOVER.md` §12 |
| | Five sandbox secrets on production, or sandbox does not work | `HANDOVER.md` §11.3 |
| | Deploy `partner-api` with `--no-verify-jwt` | Box 2 above |
| | Schedule the webhook dispatcher, or deliveries queue for ever | Open item 9 |
| | Schedule the HubSpot map check | Open item 17 |
| | Verify the operational estate and the HubSpot constants | Both documents say which |

---

## Things worth knowing before you touch anything

Four traps, each of which cost time here.

**`tsc -p tsconfig.json` checks nothing.** It has `"files": []`. Use
`tsc -p tsconfig.app.json` or `tsc -b`.

**`npm test` does not exist.** The suite is `npm run smoke`. Running vitest
directly gives it no DOM and fails 14 of 15 files, which looks like the tree is
in pieces and is one missing flag. Under the right command: 127 tests, all passing.

**Grep the built bundle, not just the source.** A `?raw` import once shipped an
entire internal specification to every browser while the component filtered it at
render time. `REGRESSION.md` has the script.

**The Edge Function tests are a separate suite.** `deno test supabase/functions/_shared/`.

---

## If you read nothing else

**Rotate the cron secret.** It is the one thing on this list that nobody here
could do for you, and it is exposed now.

**Set `EMAIL_REVIEW_ADDRESS` on every non-production environment.** The redirect
is restored as a switch, and that variable is the switch. Production leaves it
unset and behaves exactly as it does today.

**And when you push migrations to production, watch for the Rightmove line.**
