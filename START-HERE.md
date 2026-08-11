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

**Eighteen defects found in the live system**, written up separately. None was
introduced by this work, except one that was and is marked as such.

---

## What to read, in order

You do not need all of it. Stop when you have what you need.

| # | Document | Why | Time |
| - | -------- | --- | ---- |
| 1 | **`HANDOVER.md`** | The current state of everything. Start with the boxes at the top, then section 7, Open items. | 40 min |
| 2 | **`DEFECTS.md`** | Eighteen defects in the live system, worst first. Read 1 and 4 today. | 30 min |
| 3 | **`REGRESSION.md`** | A test plan written to pass on day one, so a failing row means a real change. | Reference |
| 4 | **`PARTNER-DOCS.md`** | What partners are given. Also the source of the docs panel and `openapi.json`. | 15 min |
| 5 | **`PARTNER-API.md`** | **Internal.** Why the API is shaped as it is. Sections carry SUPERSEDED banners where a decision was reversed. | As needed |
| 6 | **`HUBSPOT-SYNC-SPEC.md`** | The sync spec. Built, not a plan. Its constants need your verification. | As needed |
| 7 | **`HANDOVER-MACHINE.md`** | The original 6 July handover. Partly stale; its estate section needs your verification. | As needed |
| 8 | **`SANDBOX-MODE-SCOPE.md`** | Superseded. A record of a decision point, kept as evidence. | Skip |

**`PARTNER-API.md` and `PARTNER-DOCS.md` have similar names and opposite
audiences. `-DOCS` goes out. `-API` does not.**

---

## The first five things to do

In this order. The first two are the boxes above.

**1. Read the two boxes at the top of this file.** Ten minutes, and they are the
difference between the API working and it refusing everything while looking
healthy.

**2. Rotate `REMINDERS_CRON_SECRET`.** It is a real credential committed to your
repo and pushed to `origin/main`. `DEFECTS.md` defect 1. Rotating is the fix;
deleting the line is not, because the history keeps it. This is the only item on
this list that is urgent independently of anything else here.

**3. Decide about the email redirect.** `DEFECTS.md` defect 4. Thirteen email
modules had their test-redirect removed, so they now email real tenants and real
agents. It is safe only while no `RESEND_API_KEY` is set on the dev project, so
**do not set one** until you have decided. This is a live-system question, not
ours.

**4. Run the regression plan against a disposable project.** `REGRESSION.md`.
It is written to pass, so anything failing is either a real regression or a row
you need to argue with. Run section A first.

**5. Then, and only then, decide whether to take any of this.** Nothing here is
pushed. If you want it, the branch is `partner-api` and it is 70-odd commits with
one logical change each.

---

## Two different conversations

These have different urgency and different owners, and mixing them is how the
urgent thing waits behind the interesting thing.

### Yours, on the live system, regardless of whether you take any of this code

These exist in production now and this work did not cause them.

| | What | Where |
| - | ---- | ----- |
| **Urgent** | The cron secret is committed and pushed | Defect 1 |
| **Urgent** | Thirteen email modules lost their test redirect and email real people | Defect 4 |
| | The repo cannot rebuild the live schema. Disaster recovery does not work | Defect 5 |
| | A payment on a staff-withdrawn application is taken and both sides are told the opposite | Defect 8 |
| | A failed deed void during a refund leaves a signable deed | Defect 9 |
| | A branch can lose its primary contact, stranding a paid tenant | Defect 6 |
| | Error toasts render as successes. Component fixed here, 33 call sites are not | Defect 13 |
| | `npm ci` fails, so there is no clean-room build and no CI | Defect 11 |
| | A test has been failing since 22 July | Defect 16 |
| | A renamed HubSpot property silently stops a field syncing | Defect 17 |

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
in pieces and is one missing flag. Under the right command: 127 tests, 126 pass.

**Grep the built bundle, not just the source.** A `?raw` import once shipped an
entire internal specification to every browser while the component filtered it at
render time. `REGRESSION.md` has the script.

**The Edge Function tests are a separate suite.** `deno test supabase/functions/_shared/`.

---

## If you read nothing else

Rotate the cron secret. Decide about the email redirect. And when you push
migrations to production, watch for the Rightmove line.
