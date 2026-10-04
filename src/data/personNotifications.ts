/* =====================================================================
   ONE PERSON'S NOTIFICATIONS.

   Walk fixes 9, 10 and 12, after Matt's ruling of 2026-09-30 that these are
   "genuinely per person, for agency and supplier users as well as Opndoor
   staff".

   THE WHOLE PANEL COMES FROM THE SERVER, INCLUDING WHAT MAY BE CHANGED.
   `person_notification_panel` returns the events, the two Director-only
   toggles, and a flag PER SECTION saying whether this caller may change
   that section.

   The client does not re-derive any of it, and that is the point. The three
   settings have three different rules -- events are self or a Director at
   or above or an admin; statements and copied-on-referrals are
   Director-only and explicitly NOT self -- and a screen that worked them
   out for itself would eventually disagree with the server. That failure
   presents as a control which looks live, accepts a click and throws.

   WHAT WENT AWAY. This file used to assemble the panel from two different
   matrices and carried a `partyWide` flag, because the agency side was
   stored per recipient CLASS and was shared by everybody at the agency. It
   is per person now, so there is nothing to warn about and the flag is
   gone with its warning.
   ===================================================================== */
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';

export type PartyKind = 'opndoor' | 'agency' | 'supplier';

export interface EventRow {
  type: string;
  label: string;
  enabled: boolean;
  /** The sentence to print beside a locked row, or null when it is simply
   *  off. Never a bare boolean: item 9's complaint was that boxes could not
   *  be unticked and "nothing says why", so a lock arrives with its reason
   *  or the panel could render one without it. */
  lockReason: string | null;
}

export interface PersonPanel {
  userId: string;
  name: string;
  partyKind: PartyKind;
  events: EventRow[];
  mayEditEvents: boolean;
  /** Copied on colleagues' referrals within their position. Not an idea the
   *  supplier rail has, because it has no positions (B3). */
  copiedApplies: boolean;
  copiedOn: boolean;
  mayEditCopied: boolean;
  /** Shown only where the person's LEVEL can receive a statement. Separate
   *  from mayEdit: the level is what somebody IS, not a permission, so a
   *  Negotiator sees no section rather than a disabled one. */
  statementsApply: boolean;
  statementsOn: boolean;
  mayEditStatements: boolean;
  /** OPNDOOR'S OWN ALERTS, and empty for everybody else. Matt,
   *  2026-09-30: "for an Opndoor staff member it shows only Opndoor's
   *  internal alerts ... grouped Critical, Operations, Commercial,
   *  Information". Grouped by the server, which owns the catalogue. */
  internal: InternalRow[];
  mayEditInternal: boolean;
}

/** One internal alert, for one Opndoor person. */
export interface InternalRow {
  type: string;
  label: string;
  /** Critical | Operations | Commercial | Information, from the catalogue. */
  group: string;
  critical: boolean;
  enabled: boolean;
  /** Set when this box cannot be unticked, and says WHY. The floor rule:
   *  a critical alert can never be left with nobody, so the last
   *  recipient is locked and told so. */
  lockReason: string | null;
}

export const EMPTY_PANEL: PersonPanel = {
  userId: '', name: '', partyKind: 'agency', events: [],
  mayEditEvents: false,
  copiedApplies: false, copiedOn: false, mayEditCopied: false,
  statementsApply: false, statementsOn: false, mayEditStatements: false,
  internal: [], mayEditInternal: false,
};

/** Shapes the RPC's jsonb. Exported so a test can drive it without a
 *  database, which is the only reason it is separate from the fetch. */
export function shapePanel(raw: Record<string, unknown>): PersonPanel {
  const events = Array.isArray(raw.events) ? raw.events : [];
  return {
    userId: String(raw.user_id ?? ''),
    name: String(raw.name ?? ''),
    partyKind: (String(raw.party_kind ?? 'agency') as PartyKind),
    events: events.map((e) => {
      const r = e as Record<string, unknown>;
      return {
        type: String(r.type),
        label: String(r.label),
        enabled: r.enabled === true,
        lockReason: r.locked === true ? String(r.lock_reason ?? '') || null : null,
      };
    }),
    mayEditEvents: raw.may_edit_events === true,
    copiedApplies: raw.copied_applies === true,
    copiedOn: raw.copied_on === true,
    mayEditCopied: raw.may_edit_copied === true,
    statementsApply: raw.statements_apply === true,
    statementsOn: raw.statements_on === true,
    mayEditStatements: raw.may_edit_statements === true,
    internal: (Array.isArray(raw.internal) ? raw.internal : []).map((e) => {
      const r = e as Record<string, unknown>;
      return {
        type: String(r.type),
        label: String(r.label),
        group: String(r.group ?? ''),
        critical: r.critical === true,
        enabled: r.enabled === true,
        lockReason: r.locked === true ? String(r.lock_reason ?? '') || null : null,
      };
    }),
    mayEditInternal: raw.may_edit_internal === true,
  };
}

export async function getPersonPanel(userId: string): Promise<PersonPanel> {
  if (!SUPABASE_ENABLED) return { ...EMPTY_PANEL, userId };
  const { data, error } = await sb().rpc('person_notification_panel', { p_user: userId });
  if (error) throw new Error(error.message);
  return shapePanel((data ?? {}) as Record<string, unknown>);
}

/* ONE INTERNAL ALERT, FOR ONE PERSON. `set_ops_route` is admin-only and
   enforces that itself; the floor trigger refuses to leave a critical
   alert with nobody, and its message is already plain English, so a
   refusal here surfaces as the caller's toast unchanged. */
export async function setPersonInternal(userId: string, type: string, enabled: boolean): Promise<void> {
  if (!SUPABASE_ENABLED) return;
  const { error } = await sb().rpc('set_ops_route',
    { p_type: type, p_kind: 'user', p_recipient: userId, p_enabled: enabled });
  if (error) throw new Error(error.message);
}

export async function setPersonEvent(userId: string, type: string, enabled: boolean): Promise<void> {
  if (!SUPABASE_ENABLED) return;
  const { error } = await sb().rpc('set_notification_for',
    { p_user: userId, p_type: type, p_enabled: enabled });
  if (error) throw new Error(error.message);
}

/* WHO DECIDES A SETTING THE READER CANNOT CHANGE, in their estate's words.
 *
 * Matt, 2026-10-04 (qq): 'on supplier people, "A Director, or Opndoor,
 * decides this" should say "Management, or opndoor, decides this".'
 *
 * THE FIFTH SITE TODAY with the agency ladder in supplier copy, after the
 * Commission tab, the FAQs, the Reporting note and the Team page. Same cause
 * every time: a sentence written for the agency rail, correct when it was
 * written, then shown to a supplier whose estate has no Director in it.
 *
 * AND THE SAME FIX AS whoSeesEverything in capabilities.ts, which is its
 * sibling: name the rung, do not translate the word. An agency has a
 * Director above a Manager; a supplier's top rung is Management. "opndoor"
 * is lowercase here as it is everywhere else in this product's copy, which
 * the old string got wrong too.
 */
export function whoDecidesThis(kind: PartyKind): string {
  if (kind === 'supplier') return 'Management, or opndoor, decides this.';
  // opndoor's own staff see this panel for their colleagues; there is no
  // customer ladder above them, so opndoor is the only answer.
  if (kind === 'opndoor') return 'opndoor decides this.';
  return 'A Director, or opndoor, decides this.';
}

/** The same question about who is copied in. One sentence per estate. */
export function whoDecidesCopies(kind: PartyKind): string {
  if (kind === 'supplier') return 'Management decides who is copied in.';
  if (kind === 'opndoor') return 'opndoor decides who is copied in.';
  return 'A Director decides who is copied in.';
}
