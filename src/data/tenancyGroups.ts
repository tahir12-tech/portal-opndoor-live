/* =====================================================================
   A JOINT TENANCY, AS A SCREEN HAS TO READ IT.

   Several applications share one tenancy: one property, one rent, and now one
   deed per tenant. Left alone, every admin surface draws them as unrelated rows
   — two tenants, two identical addresses, and the WHOLE tenancy rent stated
   twice, because monthly_rent is the tenancy's on every sibling. A three-person
   let reads as three £3,000 lets.

   Two facts make the presentation awkward enough to be worth one module rather
   than three copies:

   1. EACH TENANT SIGNS THEIR OWN DEED, and this note used to say the exact
      opposite, which is why it is worth spelling out. The old rule
      (20261002100000) made the tenancy the unit for everything after the money:
      ONE deed, generated once every tenant had paid, carried by the lead and
      naming everybody. Under it a sibling's own deed state was meaningless, so
      this module deliberately answered the LEAD's for the whole tenancy, and
      several screens still defer to that.

      It was wrong in the way that matters to a customer: a tenant who had paid
      their own share sat at "Paid" for ever with nothing to sign, holding a
      guarantee in somebody else's name. The ruling now (20261005110000) is one
      deed per tenant, generated as soon as THAT tenant has paid, covering THEIR
      share and naming all the tenants. So a sibling's deed state is its own and
      is the right thing to ask for, every applicant can reach 'deed', and any
      surface that still reports the lead's state as the tenancy's is stating a
      fact about one row over the top of another.

   2. PAYMENT IS PER APPLICANT. Each tenant pays their own share through their
      own link, so paid/unpaid is genuinely per person and must not be flattened
      into the tenancy.

   So both facts now live on the person, and the tenancy's own figures are
   COUNTS of them: how many have paid, how many deeds are executed. Everything
   here derives from fields already on the row — nothing new is fetched, and
   nothing is written.
   ===================================================================== */
import type { ApplicationSummary, Status } from './types';
import { countOf } from '@/lib/plural';

/**
 * One member's deed, reduced to what a row has to print.
 *
 * THERE IS NO 'signed' HERE, and that is the model rather than an oversight.
 * DeedState is awaiting_tenant | executed | declined | voided | error, and
 * PandaDoc's document.completed both signs and executes, because Opndoor's
 * signature is a static facsimile in the template rather than a second
 * recipient to wait on. Signed and executed are one event today, so inventing a
 * 'signed' rung would give a screen a state nothing can ever put it in.
 */
export type MemberDeed = 'none' | 'awaiting' | 'executed' | 'declined' | 'voided' | 'error';

/** What each deed state is called on screen. Plain words: nobody outside this
    file should have to know what awaiting_tenant is. */
export const MEMBER_DEED_LABEL: Record<MemberDeed, string> = {
  none: 'No deed yet',
  awaiting: 'Awaiting signature',
  executed: 'Deed executed',
  declined: 'Declined to sign',
  voided: 'Deed voided',
  error: 'Deed could not be issued',
};

/** How a deed state should read: not started, in flight, done, or wrong. Kept
    here so the colour and the label can never drift apart. */
export function memberDeedTone(d: MemberDeed): 'none' | 'progress' | 'done' | 'problem' {
  if (d === 'executed') return 'done';
  if (d === 'awaiting') return 'progress';
  if (d === 'none') return 'none';
  return 'problem';
}

/** One applicant's place in a tenancy, as a row needs to render it. */
export interface TenancyMember {
  ref: string;
  tenant: string;
  /** 1-based, the order the agent entered them. */
  position: number;
  sharePercent: number | null;
  /** What this applicant is charged: their share of the one tenancy fee. */
  fee: number | null;
  paid: boolean;
  /** First entered, and nothing more than that. It used to mean "carries the
      tenancy's deed"; under the ruling above every tenant carries their own.
      NOT FOR THE SCREEN. With the deed on the person there is nothing a reader
      can do with "lead", so no surface badges it any more: it is kept because
      the first-entered row is still where the tenancy's own facts (rent,
      property) are read off, and ordering needs a first. */
  isLead: boolean;
  /** This applicant's own status. Every member can now reach 'deed'. */
  status: Status;
  /** The raw deed_state as hydrated onto the summary row, for a caller that
      needs the model's own word rather than the screen's. */
  deedState: string | null;
  /** The same fact, reduced to what a row prints. */
  deed: MemberDeed;
}

/** A tenancy, and the applications that make it up. */
export interface TenancyGroup {
  tenancyId: string;
  /** Every member, in entry order. Length is always 2 or more: a sole applicant
      is not a group and is never wrapped in one. */
  members: TenancyMember[];
  /** The whole property rent, which every sibling carries. */
  rent: number;
  prop: string;
  /* NO `status` HERE ANY MORE. It was `lead.status`, on the old rule that the
     deed was the tenancy's and the lead carried it. With a deed per tenant
     there is no single status that is true of the tenancy, and the one caller
     printed the lead's as "the deed is issued" on a sibling's page that said,
     three lines above, that the sibling had no deed. The honest tenancy-level
     figures are the counts below; a member's state is the member's. */
  /** True once every applicant has paid their share. No longer what any deed
      waits for (each tenant's deed follows that tenant's own payment), but it
      is still the answer to "is this tenancy settled". */
  fullyPaid: boolean;
  unpaidCount: number;
  /** How many members HAVE paid. The complement of unpaidCount, kept beside it
      because the two tallies a heading prints are "2 of 2 paid" and "1 of 2
      deeds": deriving the first as members.length - unpaidCount at each call
      site is how one surface ends up counting differently from another. */
  paidCount: number;
  /** How many members hold an executed deed. Counted once here so the tenancy
      card, the list heading and any later surface agree. */
  deedsExecuted: number;
}

/** Entry order, falling back to the reference for a row with no position. */
function byPosition(a: ApplicationSummary, b: ApplicationSummary): number {
  const pa = a.tenancyPosition ?? Number.MAX_SAFE_INTEGER;
  const pb = b.tenancyPosition ?? Number.MAX_SAFE_INTEGER;
  return pa - pb || a.ref.localeCompare(b.ref);
}

/**
 * Index the rows by tenancy.
 *
 * ONLY GENUINE GROUPS. A tenancy with one visible row is not a group: it either
 * is a sole applicant, or it is a joint tenancy whose siblings this viewer
 * cannot see, and in both cases drawing a group header around a single row
 * states something that is not on the screen.
 */
export function groupTenancies(rows: ApplicationSummary[]): Map<string, TenancyGroup> {
  const byTenancy = new Map<string, ApplicationSummary[]>();
  for (const r of rows) {
    if (!r.tenancyId) continue;
    const list = byTenancy.get(r.tenancyId) ?? [];
    list.push(r);
    byTenancy.set(r.tenancyId, list);
  }

  const out = new Map<string, TenancyGroup>();
  for (const [tenancyId, list] of byTenancy) {
    if (list.length < 2) continue;
    const ordered = [...list].sort(byPosition);
    const lead = ordered[0];
    const members: TenancyMember[] = ordered.map((r, i) => ({
      ref: r.ref,
      tenant: r.tenant,
      position: r.tenancyPosition ?? i + 1,
      sharePercent: r.sharePercent ?? null,
      fee: r.fee ?? null,
      paid: isPaid(r),
      isLead: r.ref === lead.ref,
      status: r.status,
      deedState: r.deedState ?? null,
      deed: deedOf(r),
    }));
    out.set(tenancyId, {
      tenancyId,
      members,
      // Rent and property really are the tenancy's, and are the same on every
      // sibling, so the lead is just the cheapest row to read them off.
      rent: lead.rent,
      prop: lead.prop,
      fullyPaid: members.every((m) => m.paid),
      unpaidCount: members.filter((m) => !m.paid).length,
      paidCount: members.filter((m) => m.paid).length,
      deedsExecuted: members.filter((m) => m.deed === 'executed').length,
    });
  }
  return out;
}

/**
 * This applicant's own deed, as a row prints it.
 *
 * status 'deed' IS executed, and is checked first: apply_deed_executed sets the
 * status and deed_state together, and a row that reached 'deed' before
 * deed_state was hydrated onto the summary would otherwise read "no deed yet"
 * on a page whose own header says Deed Issued.
 *
 * Anything unrecognised is 'none' rather than a guess. A deed state we do not
 * know about is not evidence of a deed.
 */
function deedOf(r: ApplicationSummary): MemberDeed {
  if (r.status === 'deed') return 'executed';
  switch (r.deedState) {
    case 'executed': return 'executed';
    case 'awaiting_tenant': return 'awaiting';
    case 'declined': return 'declined';
    case 'voided': return 'voided';
    case 'error': return 'error';
    default: return 'none';
  }
}

/**
 * Has this applicant paid their own share?
 *
 * paidAtTs is the fact when it is there. It is absent on mock rows and on any
 * summary built before the column was selected, so the status is the fallback:
 * everything from 'paid' onwards has been through the payment.
 */
function isPaid(r: ApplicationSummary): boolean {
  // A REFUND undoes it. The question this answers is "has this tenant's share
  // been settled", which is what the tenancy's deed waits on, and a refunded
  // share has not been — reading it as paid would report "All 3 tenants have
  // paid" over a tenancy that is short one.
  if (r.refunded) return false;
  if (r.paidAtTs != null) return true;
  return r.status === 'paid' || r.status === 'deed';
}

/**
 * Reorder so a tenancy's applications sit together, without disturbing the sort
 * the user asked for.
 *
 * The tenancy takes the position of its FIRST member under that sort, and its
 * members then follow in entry order. So "newest first" still puts the newest
 * thing at the top, and a tenancy is one thing in the ordering rather than
 * several scattered down the page.
 */
export function collateTenancies(
  rows: ApplicationSummary[], groups: Map<string, TenancyGroup>,
): ApplicationSummary[] {
  const byRef = new Map(rows.map((r) => [r.ref, r]));
  const out: ApplicationSummary[] = [];
  const done = new Set<string>();
  for (const r of rows) {
    if (done.has(r.ref)) continue;
    const g = r.tenancyId ? groups.get(r.tenancyId) : undefined;
    if (!g) { out.push(r); done.add(r.ref); continue; }
    for (const m of g.members) {
      const row = byRef.get(m.ref);
      // A member the viewer cannot see is simply not drawn.
      if (!row || done.has(m.ref)) continue;
      out.push(row);
      done.add(m.ref);
    }
  }
  return out;
}

/**
 * Cut the collated rows into pages WITHOUT splitting a tenancy.
 *
 * A page boundary through the middle of a joint tenancy is the one thing that
 * would undo the grouping: two of three tenants at the bottom of page one and
 * the third at the top of page two reads as exactly the unrelated rows this
 * exists to prevent. So a tenancy moves to the next page whole, and a page may
 * therefore run a row or two over `size`.
 */
export function pageWithoutSplitting(
  rows: ApplicationSummary[], groups: Map<string, TenancyGroup>, size: number,
): ApplicationSummary[][] {
  const pages: ApplicationSummary[][] = [];
  let page: ApplicationSummary[] = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    const g = r.tenancyId ? groups.get(r.tenancyId) : undefined;
    // How many of THIS tenancy's rows start here, as collated.
    let run = 1;
    if (g) {
      run = 0;
      while (i + run < rows.length && rows[i + run].tenancyId === r.tenancyId) run += 1;
    }
    if (page.length > 0 && page.length + run > size) {
      pages.push(page);
      page = [];
    }
    for (let k = 0; k < run; k += 1) page.push(rows[i + k]);
    i += run;
  }
  if (page.length > 0 || pages.length === 0) pages.push(page);
  return pages;
}

/* NO memberLabel ("Tenant 2 of 3") ANY MORE. It numbered each row against the
   tenancy, which was worth saying while the tenants differed in kind (one lead
   holding the deed, the rest waiting on it). Every tenant now pays their own
   share and signs their own deed, so the number ranked people who are not
   ranked, on a row already sitting under a heading that says how many there
   are. `position` stays: it is the entry order the members are sorted by. */

/** A one-line summary of where the tenancy has got to, for a group heading. */
/** "both tenants" for two, "all 3 tenants" for three or more.

    Matt, 2026-10-01: 'Say "both tenants" for two, "all 3 tenants" for three
    or more.' "All 2 tenants" is what a counter says, not what a person
    says, and a tenancy of two is the common joint case. */
export function everyTenant(n: number): string {
  return n === 2 ? 'both tenants' : `all ${countOf(n, 'tenant')}`;
}

export function tenancyProgress(g: TenancyGroup): string {
  const n = g.members.length;
  if (g.fullyPaid) return `${everyTenant(n).charAt(0).toUpperCase()}${everyTenant(n).slice(1)} have paid`;
  const paid = n - g.unpaidCount;
  if (paid === 0) return `No tenant has paid yet`;
  return `${paid} of ${countOf(n, 'tenant')} have paid`;
}

/**
 * "1 of 2 deeds executed", the tenancy-level answer about deeds.
 *
 * A COUNT rather than a state, because there is no single deed to have a state
 * any more. Always says the total, including at 0 and at all of them, so the
 * reader can see how many deeds this tenancy has in it without counting rows.
 */
export function tenancyDeedProgress(g: TenancyGroup): string {
  return `${g.deedsExecuted} of ${g.members.length} deeds executed`;
}

/* THE SAME TWO FACTS, SHORT, for a list heading.
   The sentences above are written for a panel with a line to itself. A group
   heading on the list has one line shared with the property address and reads
   as a pair, "2 of 2 paid · 1 of 2 deeds", so the two tallies have to be the
   same shape and the same width: "All 2 tenants have paid" beside "1 of 2 deeds
   executed" is two sentences about different things rather than one progress
   reading. Both always state the total, at 0 and at all of them alike, so the
   size of the tenancy is on the heading without counting rows. */

/** "2 of 2 paid". */
export function tenancyPaidTally(g: TenancyGroup): string {
  return `${g.paidCount} of ${g.members.length} paid`;
}

/** "1 of 2 deeds". */
export function tenancyDeedTally(g: TenancyGroup): string {
  return `${g.deedsExecuted} of ${g.members.length} deeds`;
}
