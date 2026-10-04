/* =====================================================================
   WHAT A SIGNED-IN USER'S OWN PARTY CAN DO.

   Distinct from roles, which say what a person is allowed to do, and from
   scope, which says what they can see. A capability says what their PARTY has
   been set up for, and the answer is the same for everybody in it.

   One rule per capability, read by the nav and by the route guard, so a screen
   is never hidden without also being closed. Hiding a door that still opens
   when you type its address costs usability and buys no safety; that was the
   mistake the Dev Centre item's own history records in constants/nav.ts.
   ===================================================================== */
import type { PartnerScope, Role } from './types';
import { ALL_PARTNERS } from './types';
import { getPartner } from './partnersService';
import { isDirectRail, isHousePartner } from './channel';

/**
 * Is this a CUSTOMER of ours on the agent rail — one of our agencies' own
 * people — rather than Opndoor staff or a supplier's?
 *
 * The estate again, read off the partner in scope. It decides which shape of
 * the org screens a user gets: an agency's staff see Team, one page of their
 * own people under their own structure; Opndoor staff and a supplier's staff
 * see the Agencies section, which is a book of agencies and presumes you are
 * looking at somebody else's.
 *
 * Deliberately false for 'developer'. A developer is integration staff at a
 * supplier; there is no such thing as a developer at one of our agencies today,
 * and if there were, Team is not the screen they came for.
 */
/**
 * WHICH PORTAL THE READER IS IN, for the wordmark.
 *
 * WALK FIX 3. This was a ternary in Sidebar.tsx: agency, else supplier. An
 * Opndoor admin is not an agency user, so they fell through to the other
 * side of a two-way choice that had no branch for the people who run the
 * place, and the one person who can see every supplier was told they were
 * inside one.
 *
 * Opndoor staff stay "Admin" under View as. The wordmark is chrome: it says
 * who YOU are, and the scope picker beside it already says who you are
 * looking at. Changing it would make an admin think they had signed in as
 * somebody else.
 */
export function portalLabel(role: Role, scope: PartnerScope): 'Admin' | 'Agency' | 'Supplier' {
  if (role === 'superadmin' || role === 'opndoor_manager') return 'Admin';
  return isAgencyUser(role, scope) ? 'Agency' : 'Supplier';
}

export function isAgencyUser(role: Role, scope: PartnerScope): boolean {
  if (role !== 'management' && role !== 'referrer') return false;
  return partyIsAgency(scope);
}

/**
 * Is this PARTY one of our agencies? Asks nothing about who is reading.
 *
 * `isAgencyUser` above is the reader question and is built on this one. They
 * were the same function, which was fine while the only caller was "what do I
 * draw for the person signed in". Under View as they come apart: an Opndoor
 * admin reading Regent's Reporting is not an agency user, but the PARTY is an
 * agency and the page has to be the agency's page. Conflating the two is what
 * made Reporting draw Opndoor's own money-ops block while viewing as somebody
 * else.
 */
export function partyIsAgency(scope: PartnerScope): boolean {
  if (scope === ALL_PARTNERS) return false;
  /* THE PARTNER'S OWN SETTING, since 2026-10-02. This read
     `referencingMode === 'opndoor_referenced'`, which made identity a
     function of the journey: a supplier switched to "opndoor referenced"
     left the Suppliers list, folded into "Agency referral", lost its
     via-labels, dropped off Reconciliation and vanished from the
     supplier settlement -- while SQL went on billing it. Measured on
     dev before the column existed; see the migration.

     `opndoor-agents` is kind `agency`, so the agency rail still answers
     true here. It is also a house partner, which is a different axis
     and is still asked separately by `isHousePartner`. */
  return getPartner(scope)?.kind === 'agency';
}

/* =====================================================================
   AN ESTATE OPNDOOR ITSELF RUNS, which is a wider question than
   "is this party one of our agencies" and is the one the MONEY asks.

   The exact mirror of `is_our_estate_partner` in SQL: an agency-kind
   partner, or the direct rail, whose applications are Opndoor's own.

   WHY THE DIRECT RAIL IS IN IT. There is no supplier on a direct
   application, so `applications.partner_rate` -- which resolve_rates
   fills on every row regardless -- is not a payable there either. The
   three commission accumulators zero the rate on this answer, and
   before the kind column existed they got it from the direct rail's
   referencing mode happening to be `opndoor_referenced`. Reading the
   kind alone would have made `partner_kind = 'house'` turn that guard
   off and invent a partner share on every direct signup. So the
   predicate names the rail, exactly as the SQL one does, and the two
   cannot drift.

   NOT THE SAME AS `partyIsAgency`. That one is the AGENCY question --
   whose page to draw, who is an agency user -- and the direct rail is
   not an agency. These were one predicate while the only fact to hand
   answered both, which is how they came to disagree with origin.ts.
   ===================================================================== */
export function partyIsOurEstate(scope: PartnerScope): boolean {
  if (scope === ALL_PARTNERS) return false;
  return getPartner(scope)?.kind === 'agency' || isDirectRail(scope);
}

/**
 * Is this PARTY a supplier? The third answer to a question that only ever had
 * two, and the reason Reporting handed a supplier Opndoor's own money.
 *
 * THE DEFECT IT IS NAMED FOR. Matt, 2026-10-01: "Reporting under View as
 * Kestrel Lettings shows the 'Every customer' table (other agencies'
 * referrals, fees and commission), the Agencies/Suppliers commission split
 * and Settlements, none of which a supplier may see."
 *
 * Every gate on those three surfaces was written as a pair: agency, or not
 * an agency. "Not an agency" was taken to mean Opndoor, because when the
 * gates were written the only non-agency reader WAS Opndoor. A supplier
 * reading its own page is the third case, and it fell on Opndoor's side of
 * every one of them -- so a supplier's Reporting drew the payable split
 * ("Agencies £X / Suppliers £Y", which is Opndoor's book) and the Settlements
 * blocks (Opndoor's settlement run). A supplier gets a STATEMENT; it does not
 * get the settlement.
 *
 * ASKS ABOUT THE PARTY, NOT THE READER, exactly as `partyIsAgency` does and
 * for the same reason: it has to give the same answer for the supplier's own
 * director and for an admin under View as, or the preview goes on lying.
 *
 * The house partners are not suppliers. `opndoor-agents`, `opndoor-direct`
 * and `referencing-partner` are our own plumbing, and a reader scoped to one
 * of them is Opndoor looking at its own rail.
 */
export function partyIsSupplier(scope: PartnerScope): boolean {
  if (scope === ALL_PARTNERS) return false;
  if (isHousePartner(scope)) return false;
  /* THE PARTNER'S OWN SETTING, and not `!partyIsAgency` any more.
     "Not an agency" was the best available answer while the only fact
     to hand was the referencing mode, and it carried that fact's fault:
     a supplier set to "opndoor referenced" stopped being one. It also
     made every partner whose kind we cannot resolve a supplier by
     default, which is how an unhydrated row got onto the Suppliers
     list. Unknown now reads as unknown. */
  return getPartner(scope)?.kind === 'supplier';
}

/**
 * May this user reach the Dev Centre?
 *
 * THE SCREEN BELONGS TO A PARTY WITH AN API. It shows API keys, webhook
 * endpoints and delivery history, and it names the party it is showing them
 * for. An agency has none of those things:
 *
 *   * There is no agency-level API access. An agency's `partner_id` points at
 *     opndoor-agents, the house partner that exists so an application's NOT
 *     NULL partner FK resolves. Reading ITS capability to answer a question
 *     about an agency would be reading the wrong party's record.
 *   * And it would name it. The Dev Centre's "API access is off for X" banner
 *     prints the partner's name, so an agency manager was shown a sentence
 *     about Opndoor Agents — plumbing that must never appear on a customer's
 *     screen (see HOUSE_PARTNER_SLUGS in channel.ts).
 *
 * So the agent rail answers false outright rather than deferring to a flag. A
 * supplier answers on its own record: API access on, the Dev Centre is theirs;
 * off, there is nothing there for them yet.
 *
 * SUPERADMIN IS NOT EXEMPT ANY MORE. See the third ruling in the block
 * inside the function; the exemption that used to be described here was
 * for a need the supplier's Integration tab now covers.
 *
 * === true, not a truthy test. Undefined means the partner record did not load,
 * and the safe answer to "may they" when we do not know is no.
 */
/**
 * Does this PARTY have API access switched on?
 *
 * THE PARTY HALF OF mayUseDevCentre, split out because two different questions
 * were reading one predicate. "May this reader open the Dev Centre" is about a
 * person and is `developer` plus the switch. "Is Developer a level worth
 * offering here" is about the COMPANY: a Developer at a supplier with the API
 * off would sign in to a Dev Centre that is not there, which is the reason
 * SUPPLIER_LEVELS marks that level `needsApi` at all.
 *
 * ASKING mayUseDevCentre for the second question gives the wrong answer for a
 * reason that is easy to miss: its first line is `role !== 'developer'`, so an
 * inviting MANAGER reads false and Developer would vanish from every dialog.
 */
export function partyHasApi(scope: PartnerScope): boolean {
  if (!scope || scope === ALL_PARTNERS) return false;
  const p = getPartner(scope);
  if (!p) return false;
  // An agency of ours is not a party with an API, whoever references its
  // tenants: the same reasoning mayUseDevCentre spells out below.
  if (p.kind === 'agency') return false;
  return p.apiAccessEnabled === true;
}

export function mayUseDevCentre(role: Role, scope: PartnerScope): boolean {
  /* =====================================================================
     DEVELOPERS ONLY, WHICH IS A ROLE TEST THIS NEVER MADE.

     Matt, 2026-10-01: "Dev Centre is for developers only: hide it from
     supplier Management and Referrer users entirely. Opndoor admin keeps
     the ability to revoke keys from the supplier's Integration tab."

     IT ASKED ABOUT THE PARTY AND NOT THE PERSON. After the superadmin
     line it checked only whether the PARTNER had an API, so every role
     at an API-enabled supplier passed -- Management by deliberate
     exception ("here only to revoke a leaked key", says the route), and
     Referrer by nobody having asked. A referrer saw the nav item and was
     bounced to /help by the route guard, which is a hidden door with a
     sign on it.

     OPNDOOR ADMIN KEEPS IT. Matt, correcting me the same day: "Admin
     keeps the Dev Centre route; the instruction only covered supplier
     Management and Referrer users. Restore it for Opndoor admin,
     keeping the existing rule that admin never sees or creates full
     keys."

     I had read "for developers only" plus "Opndoor admin keeps the
     ability to revoke keys from the supplier's Integration tab" as
     admin losing the route. The second sentence is reassurance about
     the Integration tab, not a replacement. The instruction named two
     roles and I removed four.

     WHAT ADMIN SEES IN HERE IS UNCHANGED and is not governed by this
     predicate: the keys panel shows a prefix and a Revoke, never a full
     key and never a Create. That rule lives in Configuration.tsx and in
     the RPCs, which is where it belongs -- this function answers who
     may open the door, not what is behind it.

     opndoor_manager is NOT admitted, and was not before: the route's
     own list never carried it.

     AND THE THIRD RULING, 2026-10-02, which reverses the second. Matt:
     "Change of decision: Opndoor admin does not need the Dev Centre in
     the sidebar; the supplier's Integration tab covers it. Leave it off
     for admin, and update the test and QUEUE.md so it isn't restored."

     THE WHOLE HISTORY, IN ORDER, BECAUSE IT HAS TURNED THREE TIMES:

       1  "for developers only"        -> superadmin and developer kept,
                                         supplier Management and Referrer
                                         removed
       2  "Admin keeps the Dev Centre
           route"                      -> I had removed four roles when
                                         the instruction named two; admin
                                         restored
       3  "does not need it ... the
           supplier's Integration tab
           covers it"                  -> admin removed again, this time
                                         because the NEED went away rather
                                         than because the instruction was
                                         misread

     The reason matters and is why this is not turn 2 happening again.
     Ruling 2 restored admin because revoking a leaked key had nowhere
     else to happen. It has somewhere now: the supplier's Integration
     tab lists each active key with a Revoke beside it. A second door to
     the same act is a second place for the rule to drift.

     SO IT IS DEVELOPERS ONLY. The nav and the route guard read this one
     predicate, so the item leaves the sidebar and the address stops
     opening together -- a hidden door that still opens when you type it
     is the mistake nav.ts's own history records.
     ===================================================================== */
  if (role !== 'developer') return false;
  if (scope === ALL_PARTNERS) return false;
  const p = getPartner(scope);
  if (!p) return false;
  // The estate. An agency of ours is not a party with an API, whoever
  // references its tenants -- which is now said with the fact that means
  // it rather than with the mode that used to stand in for it.
  if (p.kind === 'agency') return false;
  return p.apiAccessEnabled === true;
}

/* =====================================================================
   DOES THE TOP OF THIS PARTY'S RAIL SEE COMMISSION?

   Matt, 2026-10-03: "fix View as to read the viewed person's access, not the
   admin's."

   View as looks at a PARTY, not a person, so there is no one person's access
   to read. What there is is the party's RAIL, and each rail has a top level:
   a supplier's is Management, one of our agencies' is Director, and since the
   same day both are shown commission. So this answers true for every party we
   carry -- which is the point. It is true by construction rather than by the
   admin's own level happening to be generous, and a rail whose management did
   not see commission would be reflected rather than overridden.

   THE DIRECT RAIL IS NOBODY'S PARTY. `opndoor-direct` is Opndoor's own
   business and has no customer management to stand in for, so it answers
   false: there is no reader there to be truthful to.
   ===================================================================== */
export function topLevelSeesCommission(scope: PartnerScope): boolean {
  if (!scope || scope === ALL_PARTNERS) return true;
  if (isDirectRail(scope)) return false;
  // Both rails' top level sees commission. Asked of the party so that the
  // answer follows the rail rather than the reader.
  return partyIsSupplier(scope) || partyIsAgency(scope);
}

/* =====================================================================
   MAY THIS READER ADD AN AGENCY, OR AN OFFICE, TO THEIR OWN ESTATE?

   Matt, 2026-10-03: "Supplier users who can refer (Management and Referrers)
   can add an agency or office for their own supplier while sending a referral
   ... Supplier Management can also add and edit agencies and offices from
   their Agencies page ... Opndoor's own agencies are unchanged: their users
   can't add agencies or offices."

   THE CLIENT TWIN OF 20261007840000, and it has to be, because the reason the
   Agencies page drew "Add agency" for an admin alone was written down on the
   button: "admin_create_agency_and_branch refuses anyone but an admin, so
   drawing this for an agency manager offered a button that could only fail."
   That reason was true and is now only half true -- the function admits a
   supplier's own people -- so the gate moves with it rather than being
   widened to everybody.

   WHY OUR OWN ESTATE IS STILL REFUSED, which is the half that did not change:
   `opndoor-agents` is ONE partner shared by every agency we onboard, so a
   Regent director adding an agency there is not adding to their own book, they
   are creating a sibling beside it. agencies_insert and
   create_referral_target both refuse it in SQL, so the button would still be
   one that could only fail.

   TWO FUNCTIONS, ONE PREDICATE, and deliberately: `canAdd` here is asked of
   the ESTATE, and whether this particular reader may is the level question
   below it. A supplier's referrer may add while referring (the New application
   form) and not from the Agencies page, which is Matt's split and is about
   where the control is, not about which rail the row lands in.
   ===================================================================== */

/** Is this party's estate one its own people may add agencies to at all? */
export function ownEstateTakesAdditions(scope: PartnerScope): boolean {
  if (!scope || scope === ALL_PARTNERS) return false;
  return partyIsSupplier(scope);
}

/**
 * May this reader add an agency from the Agencies page?
 *
 * MANAGEMENT, NOT REFERRERS, on this screen. Matt gives the referrer the
 * control on the referral form, where they have met a new office and the
 * alternative is an abandoned referral; the Agencies page is housekeeping, and
 * he named Management for it. The SERVER admits both (a referrer reaching this
 * RPC is not a breach, it is the referral path), so this is a screen decision
 * and is written as one.
 */
export function mayAddOwnEstateAgency(role: Role, scope: PartnerScope): boolean {
  if (role === 'superadmin') return true;
  return role === 'management' && ownEstateTakesAdditions(scope);
}

/**
 * May this reader CORRECT an agency's or office's name, address or email?
 *
 * Matt: "Supplier Management (not Referrers) can edit their own agencies'
 * and offices' name, address and email ... Opndoor admins can edit them
 * too."
 *
 * THE SAME SHAPE AS ADDING, DELIBERATELY: whoever may put an agency into an
 * estate may correct one in it. It is a separate function rather than a
 * second caller of `mayAddOwnEstateAgency` because the two answer different
 * questions and will not always agree -- an estate could stop taking
 * additions while still needing its existing records corrected, and a
 * shared predicate would silently freeze them.
 *
 * "NOT REFERRERS" IS THE CLAUSE THAT NEEDS SAYING. A Referrer adds most of
 * these agencies, from the referral form, and creating one is not the right
 * to rename it afterwards. The server refuses them too (set_agency_details),
 * so this screen test and that guard agree rather than one covering for the
 * other.
 */
export function mayEditOwnEstateOrg(role: Role, scope: PartnerScope): boolean {
  if (role === 'superadmin') return true;
  return role === 'management' && partyIsSupplier(scope);
}

/**
 * May this reader add an agency or office WHILE REFERRING?
 *
 * Both levels that can refer, which is Matt's instruction in his own words:
 * "Supplier users who can refer (Management and Referrers)". A developer
 * cannot refer, so there is nothing to add one for.
 */
export function mayAddWhileReferring(role: Role, scope: PartnerScope): boolean {
  if (role === 'superadmin') return false; // An admin has the type-ahead's own create row.
  return (role === 'management' || role === 'referrer') && ownEstateTakesAdditions(scope);
}

/* WHO IS ABOVE A REFERRER, IN THEIR OWN ESTATE'S WORDS.
 *
 * Matt, 2026-10-04 (ss): 'Referrer Reporting note: for supplier referrers say
 * "You are viewing your own referrals only. Management sees all of
 * [supplier]'s referrals." (Directors and Managers is agency wording.)'
 *
 * THE FOURTH SITE TODAY where the agency ladder turned up in supplier copy,
 * after the Commission tab, the FAQs and the notifications dialog. Four
 * strings and one cause, so this is the shared answer rather than a fourth
 * correction: the ladders are genuinely different shapes, not different
 * words for one shape.
 *
 *   agency    Director > Manager > Negotiator. Two levels sit above a
 *             Negotiator and both are named, because an agency reader
 *             knows which of their colleagues is which.
 *   supplier  Management > Referrer. ONE level above, called Management,
 *             and there is no Director to appeal to.
 *
 * THE SUPPLIER IS NAMED because "Management" alone is ambiguous to somebody
 * who also deals with opndoor: it is Kestrel's management, not ours.
 */
export function whoSeesEverything(scope: PartnerScope): string {
  if (!partyIsSupplier(scope)) return 'Directors and Managers see the whole agency';
  const name = getPartner(scope)?.name;
  return name
    ? `Management sees all of ${name}'s referrals`
    // No resolved name is not a reason to say "Kestrel" or to say nothing:
    // the sentence still has to name a level the reader recognises.
    : 'Management sees all of your referrals';
}

/* IS THIS READER THE TOP OF THEIR OWN ESTATE?
 *
 * Matt (qq): when the subject of a locked setting is a peer the viewer
 * cannot change, naming Management as the decider is wrong, because the
 * viewer IS Management. Then it is opndoor alone.
 *
 * THE TWO LADDERS END DIFFERENTLY, which is the whole of it. A supplier's
 * Management is the top of its rail -- nothing above them but us. An agency
 * Manager has a Director above them; an agency Director does not, and
 * `sees_commission` is what separates those two, as it does everywhere else.
 *
 * OPNDOOR'S OWN STAFF ARE NOT ON A CUSTOMER LADDER and are handled by the
 * party kind at the call site, not here: this answers "top of their estate",
 * and opndoor's estate is not one of the two shapes above.
 */
export function readerIsTopOfEstate(
  role: Role, seesCommission: boolean, scope: PartnerScope,
): boolean {
  if (role !== 'management') return false;
  return partyIsSupplier(scope) || seesCommission === true;
}
