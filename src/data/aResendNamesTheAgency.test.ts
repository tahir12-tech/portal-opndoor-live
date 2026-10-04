/* AN AGENCY INVITE NAMES THE AGENCY, INCLUDING ON A RESEND.
 *
 * Matt (ab): 'Invite emails for agency users (including resends) should name
 * the agency, e.g. "...invited you to the opndoor Guarantee Referral Portal
 * for Regent's Lettings", as supplier invites already do.'
 *
 * "INCLUDING RESENDS" WAS THE WHOLE OF THE BUG, and it is why he named them.
 * The first invite already got this right: the request carries a scopeKind
 * and scopeTarget, and invite-user resolves the agency from them. `resendInvite`
 * posts NEITHER -- deliberately, because the person already holds a position
 * and re-granting one is round 5's H3 -- so `effectiveScopeKind` is null on
 * every resend, both lookups found nothing, and the clause disappeared.
 *
 * THE POSITION THEY ALREADY HOLD IS THE ANSWER. Their first invite named
 * their agency; nothing about them has changed; only the shape of the request
 * had. So the resend reads user_scopes rather than the request.
 *
 * MEASURED ON DEV before writing it: of the agency-rail users holding a
 * position, the branch-scoped and agency-scoped ones all resolve a name
 * (barb@barb.com and hello@example.com both to "Regent's Lettings"), and a
 * GROUP-scoped Director resolves none -- which is correct and is asserted
 * below rather than treated as a gap.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const INVITE = read('supabase/functions/invite-user/index.ts');

describe('the resend path can name the agency at all', () => {
  it('falls back to the position the invitee already holds', () => {
    expect(INVITE).toContain('if (!effectiveScopeKind && existing)');
    expect(INVITE).toContain('.from("user_scopes")');
    expect(INVITE).toContain('select("kind, agency_id, branch_id")');
  });

  /* A BRANCH POSITION NAMES THE AGENCY ONE JOIN AWAY, which most negotiators
     hold: barb@barb.com on dev is branch-scoped and must still read
     "Regent's Lettings". */
  it('and resolves a branch position to its agency, not to the branch', () => {
    const block = INVITE.slice(INVITE.indexOf('if (!effectiveScopeKind && existing)'));
    expect(block.slice(0, 900)).toContain('held?.branch_id');
    expect(block.slice(0, 900)).toContain('agency:agencies(name)');
  });
});

describe('and never leaks the house partner', () => {
  /* THE GROUP CASE, which has no single agency to name and must therefore
     name NOTHING rather than fall back. A Director scoped to a group holds
     several agencies; "the portal for Meridian Holdings" is the holding
     company a new starter has never heard of, which is the rule the tenant
     emails already keep. */
  it('namedParty returns the agency or nothing on the agency rail', () => {
    const np = read('supabase/functions/_shared/namedParty.ts');
    const house = np.slice(np.indexOf('HOUSE_SLUGS.includes(slug)'));
    expect(house.slice(0, 200)).toContain('return (p.agencyName ?? "").trim();');
    // Never partnerName inside the house branch: that is "Opndoor Agents".
    expect(house.slice(0, 200)).not.toContain('partnerName');
  });

  /* AND THE TEMPLATE DROPS THE CLAUSE RATHER THAN PRINTING "for ." */
  it('and the template omits the clause when there is no party to name', () => {
    const t = read('supabase/functions/_shared/emailTemplates.ts');
    const invite = t.slice(t.indexOf('export function staffInviteEmail'));
    expect(invite.slice(0, 1400)).toContain('${p.partnerName ? ` for ${p.partnerName}` : ""}');
  });
});
