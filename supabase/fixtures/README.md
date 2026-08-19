# Dev fixtures

Disposable data for a disposable project. Never run any of this against a real
database: the names are invented so they cannot be mistaken for a real partner,
and `agency-group.sql` prints a staff password in plain text.

| File | What it builds |
|---|---|
| `second-partner.sql` | A second partner, for proving cross-partner isolation |
| `agency-group.sql` | A letting-agency group: two brands on different rates, three branches, three people at three levels of visibility |

## Why `agency-group.sql` had to exist

The agent referral path forks inside `create-referral` on `referencing_mode`:

- `opndoor_referenced` sends the tenant an **invite** into the applicant journey
- `pre_referenced_open` / `pre_referenced_screened` send a **payment link**

Every partner on the project with `portal_referrals_enabled = true` was
pre-referenced, and the two `opndoor_referenced` partners are house routes with
portal referrals off. So no combination of existing data could reach the invite
branch, and the agent path could not be seen at all.

The fork is server side, in the Edge Function. **Mock mode cannot show it.**

## Walking the agent referral path

Run `agency-group.sql` first, then:

1. Sign in at `/login` on the **Agent** tab as `director@meridian.invalid`,
   password `MeridianDev!2026`. First sign-in enrols two-factor, so have an
   authenticator app ready. This is real product behaviour, not fixture friction.
2. **New application.** Pick a Meridian branch. Northgate resolves to a 0.30
   partner rate from the agency override, Southbank to 0.25 inherited from the
   partner, which is the case the rate moved down to the agency for.
3. Submit. Because the partner is `opndoor_referenced`, the application lands at
   `draft`, not `sent`, and **no payment link is created**. `sent` means a
   payment link is out, so using it here would have been a lie about state.
4. The tenant is emailed an invite. **On dev no mail provider is configured**
   (HANDOVER item 3), so the email is not sent and the activity log says so.
   Read the link out of the database instead:

   ```sql
   select 'http://localhost:5173/apply/invite?token=' || i.token as link
     from public.tenant_invites i
     join public.applications a on a.id = i.application_id
    where i.claimed_at is null
    order by i.created_at desc limit 1;
   ```

5. Open that link. The tenant claims the invite, sets up their own account and
   continues into the applicant journey: basics, the £20 eligibility fee, then
   the rest of the form.

## Seeing the hierarchy rather than the referral

Sign in as the director and open **User management**. Position is set there, and
it is a position, not a role:

| Who | Role | Position | Sees |
|---|---|---|---|
| Dara Whitfield | management | group | Both brands, all three branches |
| Ines Barros | management | branch × 2 | Northgate Central and West only |
| Tom Reddy | referrer | none | Their own referrals only |

Tom having no position is deliberate. No position means own referrals, which is
the correct default for a negotiator, and it is what the branch-manager and
group rows have to be measured against to mean anything.
