# Reference material

Screenshots and artefacts of systems this repo replaces or integrates with.
Kept because a description of a design is not a design, and the difference cost
a rebuild once already.

| File | What it is |
| ---- | ---------- |
| `tenant-site-signin-2026-08-19.png` | The sign-in of the **existing** tenant platform at `tenant.opndoor.co`, which this repo replaces. Captured 19 August 2026. |

## What the tenant sign-in screenshot establishes

Three things that could not be inferred from the integration documents:

1. **Three audiences, not two.** The sign-in carries a segmented control reading
   **Tenant / Agent / Operator**, and the left panel offers the same three as
   cards: "Tenant or student", "Letting agency", "BTR / PBSA operator". This
   repo currently models staff, partners and tenants. It has no concept of an
   operator, and "BTR / PBSA" (build-to-rent and purpose-built student
   accommodation) is an institutional landlord, which is a different party from
   both a letting agency and a partner.
2. **The audience is a query parameter**, `?tab=tenant`, so it is a shareable
   link rather than internal state.
3. **The existing tenant site is separately branded**: a marketing header with
   "For agents / For operators / For tenants / Partners", a navy hero, a
   "Book a demo" call to action.

**Point 3 is deliberately NOT carried into this repo.** The instruction is that
the tenant side uses the portal's own look, so the tenant sign-in reuses
`src/pages/auth/auth.css`, the same stylesheet the portal's own sign-in uses.
Two design systems for one product is how they drift, and a tenant who is later
shown a deed and a receipt should not feel handed between two companies.
