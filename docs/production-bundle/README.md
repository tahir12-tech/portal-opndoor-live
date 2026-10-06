# Production bundle: the commission columns

Narrowed from the dev work after the production check came back. **Sixteen of
the seventeen definer-helper revokes are not here**: those functions do not
exist on production, so revoking them would be a no-op with a migration stamp
attached. `hubspot_pending_events` does exist and is already locked to
`postgres` and `service_role`, so it needs nothing either. The whole
cross-partner PII chain is dev-only.

What is actually live and exposed is narrower and older:

| | Production today |
| - | ---------------- |
| `partners.partner_rate`, `partners.agent_rate` | selectable by `authenticated` |
| `applications.partner_rate`, `applications.agent_rate` | selectable by `authenticated`, because **20260811180000 was never applied** |
| `partners_select` | `is_admin() OR id = app_partner()`, with `require_aal2` restrictive |

`partners_select` on production does **not** admit `developer` by name, so the
developer-specific regression is dev-only too. The exposure that is live is to
any principal the policy already admits, which is a partner's own staff,
including a referrer.

## THE ORDER MATTERS. Three steps, not two.

The deployed client names `partner_rate` in the select it runs at sign-in.
Revoking the column makes PostgREST refuse the whole statement, so **management
cannot sign in**, and it fails at sign-in rather than on the screen that shows
commission. That is not a theory: it happened on dev during this work and was
caught by running the client's own select string as a management JWT.

Deploying the client first does not fix it either, because the new client calls
RPCs that would not exist yet.

So the RPCs go first, on their own, and nothing is revoked until the client that
no longer asks is live.

### Step 1: `01-add-rpcs.sql`

Purely additive. Creates `application_commission_rates()` and
`my_partner_rates()`. Revokes nothing. **The old client is unaffected** and
keeps reading the columns directly.

Check before continuing:

```sql
-- as an admin or management session, at AAL2
select count(*) from public.my_partner_rates();              -- expect >= 1
select count(*) from public.application_commission_rates();  -- expect >= 0, no error
```

And confirm the running client still works: sign in as management, load the
dashboard, see commission. Nothing should have changed for anyone.

### Step 2: deploy the client

The build containing the `hydrate.ts` change. It stops naming `partner_rate` and
`agent_rate` in the partners select, and reads both rate sets from the RPCs.

Check before continuing:

```
Sign in as management. Commission figures still display.
Sign in as a referrer. No commission anywhere, as before.
```

At this point the columns are still readable and nothing is protected yet. That
is deliberate: this step is reversible by redeploying the previous build.

### Step 3: `02-revoke-columns.sql`

The revoke. **Only run this once step 2 is live and verified**, because it is
the step that breaks an old client.

Check immediately after:

```sql
select has_column_privilege('authenticated','public.partners','partner_rate','select');      -- false
select has_column_privilege('authenticated','public.partners','agent_rate','select');        -- false
select has_column_privilege('authenticated','public.applications','partner_rate','select');  -- false
select has_column_privilege('authenticated','public.partners','name','select');              -- TRUE
```

Then sign in as management again. If sign-in fails here, step 2 did not reach
production: roll back by re-granting, do not debug it live.

```sql
-- rollback for step 3 only
grant select (partner_rate, agent_rate) on public.partners to authenticated;
grant select (partner_rate, agent_rate) on public.applications to authenticated;
```

The grant list in step 3 is **generated from production's own catalogue at run
time**, not written out. The first draft listed the columns by hand, got 28 of
58, and would have silently removed deed state, payment state, refunds,
withdrawals, expiry and the Stripe ids. A list copied from dev would have been
wrong the other way, because production is behind the tree and does not have
`applicant_id`, `share_amount`, `tenancy_id` or `tenant_middle_name`. Generating
it is the only version that is right on both.

## The trap this bundle inherits

A column-level REVOKE cannot subtract from a table-level GRANT, so step 3
replaces the table grant with a column list. **Every future column added to
`public.partners` or `public.applications` then needs its own grant or it is
silently invisible to the portal.** That is the bargain, and it is why the
column lists in `02-revoke-columns.sql` are written out rather than generated.

Balal should know this before he adds a column to either table.
