# The end-to-end walk, on dev

**Q-08. 2026-09-29.** Matt's instruction: *"Walk it end to end on dev, one
real application per rail: agency referral (single and joint), supplier
referral via Kestrel, direct. Each to executed deed, checking every email and
who received it."*

---

## What I could walk, and what I could not

**Walked, on dev, for real:** creating the referral on each rail, and then
asking every resolver what it produced — the fee, the basis, the rates, the
commission split, and *who each event would be sent to*. That last is the
substance of "who received it": the recipient list is computed by
`notification_recipients` and `deed_delivery_target`, and those are the
functions the send paths ask. Every walk ran inside a transaction that was
rolled back, so dev holds no walk data.

**Not walked, and it is not a small gap:** payment, deed generation, and the
emails themselves. Taking a payment needs Stripe, generating a deed needs
PandaDoc, and both happen inside Deno edge functions. **Deno is not installed
on this machine**, so those functions cannot run here at all, and no email
can be sent or read. That half has to be walked in a browser against dev, and
the steps are listed at the end.

So: the money and the recipients are verified. The delivery is not.

---

## What the walk found

### The four rails, created and priced

| rail | reference | rent | fee | basis | agent rate | deed goes to |
| --- | --- | --- | --- | --- | --- | --- |
| Agency, single (Regent's Park) | GR-21954 | £2,400 | £1,661.54 | 3 weeks | 20% | the referrer |
| Agency, joint (Regent pair) | GR-21955 / GR-21956 | £2,400 | £1,384.62 + £1,384.61 | 5 weeks | 25% | the referrer |
| Supplier (Kestrel Central) | GR-21957 | £1,500 | £1,500.00 | one month | 10% | the branch's agent contact |

**Regent's two bands both work, live.** A single tenant prices at three weeks
and 20%; the pair prices at five weeks and 25%, and the two shares sum to
£2,769.23 exactly with the last applicant taking the rounding penny. This is
the thing I had told Matt was impossible, corrected earlier today, now
confirmed against real dev data rather than a fixture.

**The supplier fee is one month's rent** and pays the supplier 25% with 10%
to the agent underneath, as its standard terms say.

### Who is told, per rail

| event | agency rail | supplier rail |
| --- | --- | --- |
| paid | the referrer | the referrer |
| deed issued | the referrer | the referrer **and** the branch's agent contact |

That is the designed shape: on the agency rail the deed goes to the person
who sent the referral and to any ticked colleague in scope; on the supplier
rail it also goes to the agent contact, because that rail has no positions
and the contact is the deed's recipient.

---

## One thing the walk turned up

**A fee basis is stored as `4.35` with the unit `months`.** 4.35 is the number
of *weeks* in a month, so the stored pair reads as "4.35 months" — which would
be four months' rent, not one. The fee itself is right (£1,500 on a £1,500
rent), and nothing shows a customer the raw pair: the only thing that renders
it is `feeBasisLabel`, which checks `is_standard` first and correctly says
"one month's rent".

So it is a latent inconsistency rather than a defect: the quantity and the
unit disagree, and they only agree by nobody reading them together. It has
been added to the security backlog rather than fixed, because fixing it means
touching the one number every fee in the product is derived from, and that is
not a change to make at the end of a long day. Anything new that reads
`fee_basis_weeks` and `fee_basis_unit` as a pair — a statement line, an
export column, an API response — will state it wrongly until it is fixed.

---

## The half that needs a browser

These need Stripe test mode, PandaDoc, and an inbox. On **dev**
(`nfufwcpgrhfgwtphegca`), not production.

For each of the four rails:

1. Create the referral through the form, not the RPC, so the screen's own
   validation and the fee preview are exercised.
2. Open the tenant's payment link. Check the amount matches the table above,
   and that the page names one month's rent or the agreed weeks correctly.
3. Pay with a Stripe test card.
4. Check the payment email reached the tenant, and that the referrer was told.
5. Let the deed generate. Check the PandaDoc document names the right
   property and the right tenant, and on the joint pair, that there are **two
   documents and not one**.
6. Sign it.
7. Check the executed deed email, and specifically **who is on it**: the
   referrer on the agency rail; the referrer and the agent contact on the
   supplier rail. This is the one that has been wrong before.

Two cases worth adding to that list, because they are where the money is:

- **The joint pair's commission.** Two applications, one tenancy. The
  statement must show £2,769.23 of fee and 25% of it as commission, once —
  not twice, and not £2,769.24.
- **A refund.** It is the only path that reverses money, and the only one
  where a timeout leaves a live signing link.
