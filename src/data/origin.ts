/* =====================================================================
   WHERE DID THIS APPLICATION COME FROM?

   The list answered that in two columns and two filters: a Route pill (Direct /
   Agency referral / Supplier referral / Provider hand-over) and a Partner name
   beside it. Neither is the answer on its own.

     "Agency referral" does not say whose.
     The Partner column names the partner record, and the agency rail is carried
     by a HOUSE partner (opndoor-agents) for every agency that has no partner
     record of its own. Those rows read "Agency referral | Opndoor Agents",
     naming a party that does not exist outside our own plumbing, which
     channel.ts exists to stop happening.

   So one question, one answer. The ORIGIN is the party the referral came from,
   named as the reader knows it: the agency for the agency rail, the supplier for
   the supplier rail, "Direct" for a tenant who came to us. The KIND travels with
   the name, because "Regent's Lettings" and "Homeppl" are both just names until
   something says which rail each is on.

   THE SAME ANSWER FEEDS THE FILTER. One selector over the same four kinds, so
   the control and the column cannot disagree about what an origin is.
   ===================================================================== */
import { channelOf, houseRouteLabel, isHousePartner, ROUTE_LABEL } from './channel';
import { getPartner, partnerName } from './partnersService';
import { findAgency, getAgencies, getGroup } from './orgService';
import { ALL_PARTNERS, type PartnerScope } from './types';

/** Which rail a party sits on. The column shows it beneath the name and the
    filter groups by it. */
export type OriginKind = 'direct' | 'agency' | 'supplier' | 'provider';

export interface Origin {
  kind: OriginKind;
  /** The party, named as the reader knows it. Never a house partner. */
  name: string;
}

/** What the kind is called on screen, under the name. */
export const ORIGIN_KIND_LABEL: Record<OriginKind, string> = {
  direct: 'Direct signup',
  agency: 'Agency',
  supplier: 'Supplier',
  provider: 'Provider',
};

/** The fields an origin is read from. Deliberately structural rather than
    ApplicationSummary, so the reporting rail and the tests can ask the same
    question of a row shape that is not the list's. */
export interface OriginRow {
  partner: string | null | undefined;
  agency?: string | null;
}

/**
 * The party this application came from.
 *
 * Reads the rail through channelOf, which is the one place that rule lives, and
 * then names the party the rail points at.
 */
export function originOf(row: OriginRow): Origin {
  const slug = row.partner || '';
  /* THE HOUSE PARTNERS ARE READ BY SLUG, ahead of anything else, because their
     rail is a fact about the slug and channelOf reads the partner's MODE to tell
     opndoor-agents from a supplier. That is right where the partner record is
     hydrated and wrong where it is not: a row carried by opndoor-agents with no
     record to read comes back "Partner referral", which would file the whole
     agency rail under Suppliers. The slug is always there; the record is not. */
  if (isHousePartner(slug)) {
    const route = houseRouteLabel(slug);
    if (route === 'Direct') return { kind: 'direct', name: 'Direct' };
    if (route === 'Provider hand-over') return { kind: 'provider', name: route };
    // opndoor-agents: the agency rail, where the AGENCY is the origin. The route
    // label stands in only where the row does not name one.
    return { kind: 'agency', name: row.agency || route };
  }

  const channel = channelOf({ partnerSlug: slug, partnerMode: getPartner(slug)?.referencingMode });
  if (channel === 'Agent referral') {
    /* An agency-rail partner of our own (Regent, Northwind). The agency is still
       the origin; the partner names it only where the row does not. */
    return { kind: 'agency', name: row.agency || partnerName(slug) };
  }
  return { kind: 'supplier', name: partnerName(slug) };
}

/* ---------------------------------------------------------------------------
   THE SELECTION. Encoded as one string because it is one control: '' is
   everything, and the rest carry their kind so a supplier and an agency of the
   same name can never collide.
   --------------------------------------------------------------------------- */
export const ORIGIN_ALL = '';

/**
 * ONE SELECTION VALUE, shared by Reporting and Applications.
 *
 * Matt, 2026-09-29: "Reporting and Applications share one remembered scope
 * choice." So this is not a per-page preference; it is the party the reader
 * is currently looking at, and it lives on the session.
 *
 * The closed set:
 *
 *   ''                 Everything
 *   'rail:agency'      every agency of ours, whichever route
 *   'rail:supplier'    every supplier
 *   'direct'           the direct rail
 *   'provider'         provider hand-over
 *   'partner:<slug>'   one supplier, by slug
 *   'agency:<name>'    one agency, BY NAME across partners -- Matt's ruling of
 *                      2026-08-17, that an agency exists once and is never
 *                      duplicated per supplier, is already encoded here
 *   'group:<id>'       one group of agencies
 */
export type OriginScope = string;

/** Every agency of ours, whichever route the referral came down. */
export const RAIL_AGENCY = 'rail:agency';
/** Every supplier. */
export const RAIL_SUPPLIER = 'rail:supplier';

export interface OriginOption {
  value: string;
  label: string;
  /** The optgroup this sits under, or null for a quick choice at the top. */
  group: string | null;
}

/** The selection value that stands for one row's origin. */
export function originValue(row: OriginRow): string {
  const o = originOf(row);
  if (o.kind === 'direct') return 'direct';
  if (o.kind === 'provider') return 'provider';
  if (o.kind === 'supplier') return `partner:${row.partner}`;
  return `agency:${o.name}`;
}

/**
 * DOES THIS ROW BELONG TO THE SELECTION? The one predicate, asked by the list
 * and by the analytics layer alike.
 *
 * It answers only "is this row in the selected party". It says nothing about
 * whether the reader may SEE the row, and it must never be asked first: the
 * isolation filters run before it, so a selection can only ever narrow what
 * the reader was already allowed. Written down because a predicate that looks
 * like a scope test is exactly the thing somebody reaches for later in place
 * of one.
 */
export function originMatches(row: OriginRow, sel: OriginScope): boolean {
  if (!sel) return true;
  const o = originOf(row);
  if (sel === RAIL_AGENCY) return o.kind === 'agency';
  if (sel === RAIL_SUPPLIER) return o.kind === 'supplier';
  if (sel === 'direct') return o.kind === 'direct';
  if (sel === 'provider') return o.kind === 'provider';
  if (sel.startsWith('partner:')) return (row.partner || '') === sel.slice('partner:'.length);
  if (sel.startsWith('agency:')) return o.kind === 'agency' && o.name === sel.slice('agency:'.length);
  if (sel.startsWith('group:')) {
    const id = sel.slice('group:'.length);
    return o.kind === 'agency'
      && getAgencies(ALL_PARTNERS).some((a) => a.groupId === id && a.name === o.name);
  }
  return true;
}

/**
 * DOES THIS SELECTION NAME ONE PARTY?
 *
 * Everything and the two rails do not: they are a view across parties, and an
 * admin looking at "all suppliers" is not viewing as anybody. One supplier,
 * one agency or one group is.
 */
export function isOneParty(sel: OriginScope): boolean {
  return sel.startsWith('partner:') || sel.startsWith('agency:') || sel.startsWith('group:');
}

/* NO PRODUCTION CALLER, ON PURPOSE AND TEMPORARILY. `viewingAs` asked this
   until 2026-09-30 and now asks `figuresFollow` below, which is narrower.
   This is still the correct question and gets its caller back when every
   Reporting figure follows the selection. Kept rather than deleted so that
   fix restores a definition instead of re-deriving one. */

/**
 * DO THE FIGURES ACTUALLY FOLLOW THIS SELECTION?
 *
 * A NARROWER QUESTION THAN `isOneParty`, and the two must not be confused.
 * `isOneParty` asks what the selection MEANS. This asks what the product
 * currently DOES about it, which today is less.
 *
 * WHY IT EXISTS. Every figure on Reporting is keyed on `partnerScope`, and
 * `partnerFor` turns a selection into a partner scope: a real slug for
 * `partner:<slug>`, and ALL_PARTNERS for `agency:` and `group:`, because on
 * the agency rail the partner is a ROUTE and not a company and a partner
 * scope is the wrong shape to carry an agency. The narrowing for those two
 * is supposed to happen afterwards, in `scopeFull`'s fourth `sel` argument
 * -- and no production call site passes it. Nineteen of them stop at three
 * arguments. So an `agency:` or `group:` selection changes the page's
 * wording and its gates and not one of its numbers.
 *
 * MATT'S STOPGAP, 2026-09-30: "make sure no banner can claim a party the
 * figures don't reflect." This is that test. A banner, an eyebrow or a gate
 * that names a party may only be drawn where this answers true, so the
 * screen cannot assert something the figures contradict.
 *
 * HIDING THE BUTTON WOULD NOT HAVE BEEN ENOUGH, which is why the test lives
 * here rather than on the button. `scopeSel` is ONE selection shared with
 * Applications, whose own Origin picker still writes `agency:` and `group:`
 * values; it is restored from localStorage on every page load; and the
 * recents list offers it back. The selection arrives by several doors and
 * only one of them was the button.
 *
 * WHEN THE PROPER FIX LANDS -- every Reporting figure following the
 * selection, recorded in QUEUE.md as the first item after shipping -- this
 * function becomes `isOneParty` and should be deleted, not quietly widened.
 * Two names for one question is how the distinction gets lost again.
 */
export function figuresFollow(sel: OriginScope): boolean {
  return sel.startsWith('partner:');
}

/**
 * IS THE PARTY IN THIS SELECTION ONE OF OUR AGENCIES?
 *
 * `partyIsAgency` in capabilities.ts answers this for a partner SLUG, which
 * is all that existed before the picker could hold an agency by name or a
 * group. This answers it for the richer thing.
 */
export function selectionIsAgency(sel: OriginScope): boolean {
  if (sel.startsWith('agency:') || sel.startsWith('group:')) return true;
  if (!sel.startsWith('partner:')) return false;
  const slug = sel.slice('partner:'.length);
  if (isHousePartner(slug)) return houseRouteLabel(slug) === 'Agent referral';
  return getPartner(slug)?.referencingMode === 'opndoor_referenced';
}

/**
 * THE PARTNER A SELECTION IMPLIES, for the isolation rule that still speaks in
 * partners.
 *
 * The picker holds a richer thing than `selectedPartner` can: a rail, an
 * agency by name, a group. But `partnerScope` mirrors the server's isolation
 * rule and every one of `isAgencyUser`, `agentRailScope` and `scopeFor` is
 * built on it, so it must keep holding a real partner slug or nothing at all.
 * Choosing one supplier narrows it; choosing anything else leaves it open and
 * lets `originMatches` do the narrowing afterwards, where it cannot be
 * mistaken for an authorisation test.
 */
export function partnerFor(sel: OriginScope): PartnerScope {
  return sel.startsWith('partner:') ? sel.slice('partner:'.length) : ALL_PARTNERS;
}

/**
 * The origin choices over a BOOK: the quick ones, then every supplier, then
 * every group and agency.
 *
 * DERIVED FROM THE ROWS, not from the partner and agency tables, for the reason
 * the Route and Agency columns collapse on this page: a control that offers a
 * choice matching nothing is a thing to read past. An admin's list should not
 * offer "Provider hand-over" because a house partner row exists in the
 * directory, and a group is only a distinction when two of its agencies are
 * actually in the book.
 *
 * `current` is included even when it is not one of the choices, because a
 * deep-link can select a party the book does not hold. A selector whose value is
 * not among its options shows the wrong thing and cannot be put back.
 */
export function originOptions(rows: OriginRow[], current?: string): OriginOption[] {
  const quick = new Map<string, string>();
  const suppliers = new Map<string, string>();
  const agencies = new Map<string, string>();
  for (const row of rows) {
    const o = originOf(row);
    const value = originValue(row);
    if (o.kind === 'direct' || o.kind === 'provider') quick.set(value, o.name);
    else if (o.kind === 'supplier') suppliers.set(value, o.name);
    // "Unattached" is the placeholder the house rails hang off, not a party.
    // Nothing should reach here holding one, and offering it as an origin if
    // something did would put an internal name in front of the reader.
    else if (!findAgency(o.name)?.isPlaceholder) agencies.set(value, o.name);
  }

  const opts: OriginOption[] = [{ value: ORIGIN_ALL, label: 'Everything', group: null }];
  // Direct before Provider, always in that order: one is a rail we sell and the
  // other is a hand-over, and an alphabetical list would put them either way
  // round depending on the wording of the day.
  if (quick.has('direct')) opts.push({ value: 'direct', label: 'Direct', group: null });
  if (quick.has('provider')) opts.push({ value: 'provider', label: quick.get('provider')!, group: null });

  for (const [value, label] of [...suppliers].sort((a, b) => a[1].localeCompare(b[1]))) {
    opts.push({ value, label, group: 'Suppliers' });
  }

  /* A GROUP EARNS ITS PLACE by covering more than one agency that is in the
     book. A group of one is the agency again under a second name. */
  const perGroup = new Map<string, number>();
  for (const label of agencies.values()) {
    const groupId = findAgency(label)?.groupId;
    if (groupId) perGroup.set(groupId, (perGroup.get(groupId) ?? 0) + 1);
  }
  const groupOpts: OriginOption[] = [];
  for (const [groupId, n] of perGroup) {
    if (n < 2) continue;
    const g = getGroup(groupId);
    if (g) groupOpts.push({ value: `group:${groupId}`, label: `${g.name} (group)`, group: 'Agencies' });
  }
  groupOpts.sort((a, b) => a.label.localeCompare(b.label));
  opts.push(...groupOpts);

  /* BY NAME, like the Agency filter this replaces and the query it drives. A
     name is unique inside a partner but not across the book, so two agencies of
     the same name under different partners select together. That is exactly
     what the Agency chip always did; the origin selector is not the place to
     change it. */
  for (const [value, label] of [...agencies].sort((a, b) => a[1].localeCompare(b[1]))) {
    opts.push({ value, label, group: 'Agencies' });
  }

  if (current && !opts.some((o) => o.value === current)) {
    opts.push({ value: current, label: originLabelFor(current), group: 'Selected' });
  }
  return opts;
}

/** A selection's own name, derived rather than looked up, for a value the book
    does not carry. */
/* EXPORTED so the picker's box can name a selection the BOOK does not
   contain. Filtering to an agency with nothing in the period is a real
   thing to do, and a control that answers "Everything" while the list is
   narrowed is the defect Matt reported: "the box always shows what is
   actually applied". */
export function originLabelFor(value: string): string {
  /* THE TWO RAILS, WHICH THIS DID NOT KNOW. They are not parties, so
     `originOptions` never produces them from the book and they were
     never in this function either -- and both fall through to the
     "Everything" at the bottom.

     That is the box lying, exactly as Matt reported. `originOptions`
     appends a synthetic entry for the CURRENT selection so the control
     can name it, labelled through here, so choosing Suppliers narrowed
     the list to suppliers and left the box reading "Everything". The
     list was right and the control was wrong about it, which is the
     worst way round. */
  if (value === RAIL_SUPPLIER) return 'Suppliers';
  if (value === RAIL_AGENCY) return 'Agencies';
  if (value === 'direct') return 'Direct';
  if (value === 'provider') return ROUTE_LABEL['Provider hand-over'];
  if (value.startsWith('partner:')) return partnerName(value.slice('partner:'.length));
  if (value.startsWith('agency:')) return value.slice('agency:'.length);
  /* A GROUP RESOLVES TO ITS AGENCIES, and a group holding none resolves to an
     empty list, which the filter reads as "no agency matches" rather than "no
     agency filter". The difference is the whole book under one brand's name. */
  if (value.startsWith('group:')) {
    const g = getGroup(value.slice('group:'.length));
    return g ? `${g.name} (group)` : 'Group';
  }
  return 'Everything';
}

/** The label for a selection, for the chip's own text. */
export function originLabel(value: string, rows: OriginRow[]): string {
  if (!value) return 'Everything';
  return originOptions(rows, value).find((o) => o.value === value)?.label ?? originLabelFor(value);
}

/**
 * The list filters a selection stands for.
 *
 * Returned as the query options the applications service already understands,
 * so the origin selector is a way of ASKING the existing question rather than a
 * second filtering rule that could drift from it. A group is the one selection
 * with no single-value equivalent, and resolves to its agencies by name.
 */
export function originToFilter(value: string, scope: PartnerScope): {
  channel?: 'Direct' | 'Provider hand-over';
  partner?: string;
  agencies?: string[];
} {
  if (!value) return {};
  if (value === 'direct') return { channel: 'Direct' };
  if (value === 'provider') return { channel: 'Provider hand-over' };
  if (value.startsWith('partner:')) return { partner: value.slice('partner:'.length) };
  /* AN AGENCY SELECTION GOES THROUGH `agencies`, NOT `agency`, so that it ANDs
     with the drill-through filter rather than overwriting it. Arriving from
     Agencies & branches sets ?agency=/?branch=, whose banner is still on screen
     with its own Clear; if the origin selector wrote the same field, one of the
     two controls would silently win. */
  if (value.startsWith('agency:')) return { agencies: [value.slice('agency:'.length)] };
  if (value.startsWith('group:')) {
    const id = value.slice('group:'.length);
    return { agencies: getAgencies(scope).filter((a) => a.groupId === id && !a.isPlaceholder).map((a) => a.name) };
  }
  return {};
}


/**
 * The origin a legacy deep-link means.
 *
 * ?route= and ?partner= are live links from other pages (Home's Direct tiles,
 * a supplier's "View applications" button), and predate this control. They are
 * translated rather than dropped, so an old link lands on the same rows with
 * the new selector showing what it selected.
 */
export function originFromParams(params: { route?: string | null; partner?: string | null; origin?: string | null }): string {
  if (params.origin) return params.origin;
  if (params.partner) {
    /* Validated against the real list, as the old ?partner= seeding was: an
       unknown or stale id must open the whole book rather than an empty list
       labelled with a party that does not exist. A house partner is never a
       selection, so it opens unfiltered too. */
    const p = getPartner(params.partner);
    if (!p || p.isHouse || isHousePartner(p.id)) return ORIGIN_ALL;
    return `partner:${p.id}`;
  }
  if (params.route === 'Direct') return 'direct';
  if (params.route === 'Provider hand-over') return 'provider';
  /* 'Agent referral' and 'Partner referral' named a RAIL, and an origin names a
     PARTY. There is no single party either means, so the link opens unfiltered
     rather than on an arbitrary one. */
  return ORIGIN_ALL;
}
