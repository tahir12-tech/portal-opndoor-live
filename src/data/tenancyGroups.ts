/* =====================================================================
   A JOINT TENANCY, AS A SCREEN HAS TO READ IT.

   Several applications share one tenancy: one property, one guarantee, one
   deed. Left alone, every admin surface draws them as unrelated rows — two
   tenants, two identical addresses, and the WHOLE tenancy rent stated twice,
   because monthly_rent is the tenancy's on every sibling. A three-person let
   reads as three £3,000 lets.

   Two facts make the presentation awkward enough to be worth one module rather
   than three copies:

   1. ONLY THE LEAD HAS A DEED. apply_deed_executed keys on the PandaDoc
      document, and only the lead applicant ever has one, so the lead moves to
      "Deed Issued" while the siblings sit at "Paid" for good. Asking a sibling
      row for the deed state gives the wrong answer; the tenancy's deed state is
      the LEAD's, and every row has to say the same thing about it.

   2. PAYMENT IS PER APPLICANT. Each tenant pays their own share through their
      own link, so paid/unpaid is genuinely per person and must not be flattened
      into the tenancy.

   So: deed at the tenancy, payment at the person. Everything here derives from
   fields already on the row — nothing new is fetched, and nothing is written.
   ===================================================================== */
import type { ApplicationSummary, Status } from './types';

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
  isLead: boolean;
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
  /** The tenancy's status, which is the LEAD's: the deed is the tenancy's, not
      each applicant's, and the siblings never leave 'paid'. */
  status: Status;
  /** True once every applicant has paid their share — what the deed waits for. */
  fullyPaid: boolean;
  unpaidCount: number;
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
    }));
    out.set(tenancyId, {
      tenancyId,
      members,
      rent: lead.rent,
      prop: lead.prop,
      // The LEAD's status is the tenancy's. See the header note.
      status: lead.status,
      fullyPaid: members.every((m) => m.paid),
      unpaidCount: members.filter((m) => !m.paid).length,
    });
  }
  return out;
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

/** "Tenant 2 of 3". */
export function memberLabel(g: TenancyGroup, ref: string): string {
  const m = g.members.find((x) => x.ref === ref);
  return m ? `Tenant ${m.position} of ${g.members.length}` : '';
}

/** A one-line summary of where the tenancy has got to, for a group heading. */
export function tenancyProgress(g: TenancyGroup): string {
  const n = g.members.length;
  if (g.fullyPaid) return `All ${n} tenants have paid`;
  const paid = n - g.unpaidCount;
  if (paid === 0) return `No tenant has paid yet`;
  return `${paid} of ${n} tenants have paid`;
}
