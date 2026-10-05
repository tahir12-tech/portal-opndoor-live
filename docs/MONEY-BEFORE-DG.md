# Every money figure on dev, before (dg)

> **Matt, 2026-10-05, item 13:** "(dg) the whole-book load, option 1: load
> per screen with sums on the server. Before starting, record every money
> figure on Reporting, League, exports and statements on dev; after, prove
> each matches exactly with a test. If it can't be finished complete and
> proven, don't commit a partial version."

**THE CHANGE IS NOT BUILT.** Moving the sums to the server is a rewrite of
where every figure on four surfaces comes from, and it cannot be finished
and proven in one night. This file is the half that CAN be done now, that
has to exist before the rest can start, and that nobody else can produce
later: what the figures are TODAY, measured on dev, with the query that
produced each one.

**HOW TO USE IT.** After the rewrite, run these queries again. Every number
below must be identical, to the penny. A figure that moves is the rewrite
having changed what a surface means, which is the one outcome that must not
happen quietly: these are what agencies and suppliers are paid.

Taken **2026-10-05, 06:30**, on `nfufwcpgrhfgwtphegca`, over `livemode`
rows only.

---

## 1. The whole book

The sum behind "Fees collected" on Reporting and the Agencies list, and the
refunds that separate gross from net. Since (cg) every surface that says
"Fees collected" means the net figure.

| measure | value |
| --- | ---: |
| Guarantee fees collected (gross) | **47,336.76** |
| Refunds | **6,228.46** |
| Net fees after refunds | **41,108.30** |
| Applications paid or deed-issued | 28 |
| Applications in the book | 49 |

```sql
select
  round(sum(case when a.status in ('paid','deed') then coalesce(a.fee_amount, a.monthly_rent) else 0 end), 2) as fees_gross,
  round(sum(case when a.payment_state='refunded' then coalesce(a.refunded_amount, coalesce(a.fee_amount,a.monthly_rent))
                 when a.payment_state='partially_refunded' then coalesce(a.refunded_amount,0) else 0 end), 2) as refunds
from public.applications a where a.livemode;
```

## 2. Per agency: net fees, and the commission frozen onto its referrals

The Agencies list, each agency's Reporting tab, and the League's Agencies
board. Two agencies are called Frost Partnership and they are two different
companies in two estates, which is why the estate is a column and not a
footnote.

| agency | estate | fees (net) | agency commission |
| --- | --- | ---: | ---: |
| Regent's Lettings | opndoor-agents | 15,219.29 | 3,548.66 |
| Northgate Lettings | opndoor-agents | 12,100.00 | 0.00 |
| Southbank Residential | opndoor-agents | 4,200.00 | 0.00 |
| Test Lettings asdah | kestrel-lettings | 3,789.01 | 378.90 |
| Frost Partnership | kestrel-lettings | 2,400.00 | 0.00 |
| Frost Partnership | opndoor-agents | 2,400.00 | 0.00 |
| Unattached | opndoor-direct | 1,000.00 | 0.00 |

Regent is the row to watch: 15,219.29 is 21,447.75 of fees less 6,228.46 of
refunds, and those are the two figures (cg) was about.

## 3. Per supplier: what the supplier is owed, and the agency side beside it

The supplier's own Reporting headline and the League's Suppliers board.
Refunded referrals are excluded, which is what "net of refunds" means here.

| supplier | supplier commission | agency side | applications |
| --- | ---: | ---: | ---: |
| kestrel-lettings | 947.25 | 378.90 | 2 |
| opndoor-agents | 0.00 | 3,548.66 | 20 |
| opndoor-direct | 0.00 | 0.00 | 1 |

Kestrel's 378.90 is **inside** the 947.25, not beside it: the arrangement is
carved, so opndoor pays Kestrel and Kestrel passes the agency's share on.
Any rewrite that makes these add to 1,326.15 has reintroduced (bp)(1).

## 4. Per payee per month: the commission statements

What `commission_statement_lines` produces, which is what the monthly run
sends and what the Commission tab and the statement downloads show.

| month | payee | total | lines |
| --- | --- | ---: | ---: |
| 2026-10 | opndoor-agents, agency b93277db (Regent's) | 1,947.12 | 5 |
| 2026-10 | kestrel-lettings, supplier 9ec3cdd0 | 947.25 | 2 |
| 2026-10 | kestrel-lettings, agency 77cbe1ac (Test Lettings asdah) | 378.90 | 2 |
| 2026-09 | opndoor-agents, agency b93277db (Regent's) | 1,601.54 | 5 |

September's 1,601.54 is the figure Matt reconciled the monthly trend
against on 2026-10-01, and it has not moved since.

---

## What the rewrite must not change

1. Every figure above, to the penny.
2. The RELATIONSHIPS, which are easier to break than the totals: the
   carved share stays inside the supplier's figure, net stays net, and a
   refunded referral earns nothing.
3. The frozen values. A referral carries its own fee, basis and commission
   lines; nothing recomputed on the server may replace them. That is the
   rule the whole commission model rests on and the reason these numbers
   can be compared at all.

## And the thing the rewrite is actually for

`src/lib/hydrate.ts:171` and `:175` select every agency and every branch the
caller's RLS allows, with no limit, inside the sign-in `Promise.all`. It
runs on sign-in, on partner switch and from Activity, whether or not a
picker is ever opened. `orgService.ts:19` then persists that whole array to
localStorage on every write, and `saveJSON` swallows a quota failure.

It has not been capped, deliberately: that array feeds Reporting, the
League, the exports and the league grouping, so a blanket `.limit()` would
not make those slow, it would make them WRONG, silently. Which is why the
answer is option 1 and why it is measured before it is moved.
