/* =====================================================================
   Topbar — breadcrumbs, page title, a (decorative) global search, the demo
   role switcher and the help + notifications popovers. Ported from
   portal.js buildTopbar. The hamburger toggles the mobile nav drawer.
   ===================================================================== */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMetaValue } from './pageMeta';
import { RoleSwitch } from './RoleSwitch';
import { GlobalSearch } from './GlobalSearch';
import { HelpMenu, NotificationsMenu, type Pop } from './TopbarMenus';
import { Icon } from '@/components/ui/Icon';
import { useOnClickOutside } from '@/hooks/useOnClickOutside';
import { getNotifications, markNotificationsRead, notificationsUnread, type NotificationItem } from '@/data';
import { ORIGIN_ALL, originLabelFor } from '@/data/origin';
import { useSession } from '@/session/SessionContext';

/* THE PAGES WHOSE FIGURES ACTUALLY FOLLOW THE SELECTION, by the identity
   each already gives pageMeta for the sidebar. Reporting and Applications
   share one remembered scope and narrow every figure on them to it; every
   other page is Opndoor's own view of the estate, whatever the selection
   happens to be. A page added later shows no pill until it is named here,
   which is the safe direction: a missing banner is a smaller fault than
   one claiming a party the page is not about. */
const PARTY_VIEW_PAGES = new Set(['dashboard', 'applications']);

// Breadcrumb segments that map to a real landing route become links (#63).
// Group headers ('Home' aside) like 'Administration'/'opndoor' have no page and
// stay plain text, as does the last (current-page) segment.
const CRUMB_ROUTES: Record<string, string> = {
  Home: '/dashboard',
  Dashboard: '/dashboard',
  Applications: '/applications',
  'League tables': '/league',
  Activity: '/activity',
  Agencies: '/agencies',
  'Agencies & branches': '/agencies',
  Suppliers: '/partners',
  Partners: '/partners',
  Users: '/users',
  Reconciliation: '/reconciliation',
  'Help & resources': '/help',
  New: '/new-application',
};

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { title, crumbs, active } = usePageMetaValue();
  const { currentUserId, viewingAs: viewingScope, setScopeSel, dataVersion } = useSession();

  /* =====================================================================
     THE PILL FOLLOWED YOU AROUND THE PRODUCT.

     Matt, 2026-10-01: "the 'Viewing as' tag must not show on any page
     that isn't showing that party's view; it's appearing on admin pages
     after View as was used."

     TWO FAULTS, AND THE FIRST IS THAT THIS DERIVED ITS OWN ANSWER. It
     read `role === 'superadmin' && selectedPartner !== ALL_PARTNERS`,
     which is a THIRD derivation of a question SessionContext already
     answers -- and answers more narrowly, because `viewingAs` there is
     gated on `figuresFollow`. Matt's own stopgap of 2026-09-30 was
     "make sure no banner can claim a party the figures don't reflect",
     and it was applied in SessionContext precisely so there would be
     one answer. This copy never got it.

     THE SECOND IS THAT THE TOPBAR IS ON EVERY PAGE. `selectedPartner`
     persists, so once View as had been used the pill sat on Suppliers,
     Agencies, Health and the Dev Centre -- none of which shows that
     party's view of anything. It claimed a party for pages that were
     Opndoor's own.

     So: the session's answer, and only on a page that IS that party's
     view. `active` is the page's own identity, already in pageMeta for
     the sidebar, so no page has to learn a new thing to say. */
  const viewingAs = PARTY_VIEW_PAGES.has(active) && viewingScope !== null
    ? originLabelFor(viewingScope)
    : null;
  const [pop, setPop] = useState<Pop>(null);
  const [notifs, setNotifs] = useState<NotificationItem[]>([]);
  // Read state persists per user (item #64), so reopening the panel does not
  // re-light everything. In mock mode there is no user, so we key on 'demo'.
  const userKey = currentUserId ?? 'demo';
  const [readTick, setReadTick] = useState(0);
  const actionsRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(actionsRef, () => setPop(null), pop !== null);

  /* Real, RLS-scoped notifications for the signed-in viewer (demo entries in
     mock mode). Refetched when the panel is opened so relative times stay
     honest.

     AND WHENEVER THE DATA UNDERNEATH MOVES, which is the second dependency.
     Matt, 2026-10-12: "After I deleted test application GR-20608, its 'New
     referral sent' notification stayed in my bell, linking to a referral that
     no longer exists."

     THE QUERY WAS ALREADY RIGHT, and that is worth saying because it is why
     this is two words and not a feature. getNotifications joins
     `applications!inner`, and activity_log.application_id is ON DELETE
     CASCADE, so a deleted application has no activity rows left to find and
     could not be returned even if it had. What survived was this component's
     React state: the list was fetched before the delete and held until the
     panel's open flag next changed. Nothing told it the book had moved.

     dataVersion is the session's "something was re-read" counter and every
     other derived view on the page already follows it, so the bell now does
     too: after any refresh the stale item is gone without a page reload. */
  useEffect(() => {
    let cancelled = false;
    getNotifications().then((n) => { if (!cancelled) setNotifs(n); }).catch(() => {});
    return () => { cancelled = true; };
  }, [pop === 'notif', dataVersion]);

  // readTick forces a recompute after "Mark all read" persists.
  void readTick;
  const notifRead = !notificationsUnread(userKey, notifs);
  const clearNotifs = () => { markNotificationsRead(userKey, notifs); setReadTick((t) => t + 1); };

  const toggle = (which: Exclude<Pop, null>) => setPop((cur) => (cur === which ? null : which));

  return (
    <>
      <button className="topbar__menu" aria-label="Open menu" onClick={onMenu}>
        <Icon name="menu" strokeWidth={2.2} />
      </button>

      <div className="stack">
        {crumbs.length > 0 && (
          <div className="topbar__crumbs">
            {crumbs.map((c, i) => {
              const isLast = i === crumbs.length - 1;
              const to = CRUMB_ROUTES[c];
              return (
                <span key={i} style={{ display: 'contents' }}>
                  {i > 0 && <span className="sep">/</span>}
                  {isLast ? <b>{c}</b> : to ? <Link to={to}>{c}</Link> : <span>{c}</span>}
                </span>
              );
            })}
          </div>
        )}
        <div className="topbar__title">{title}</div>
      </div>

      <GlobalSearch />

      <div className="topbar__actions" ref={actionsRef}>
        {viewingAs && (
          <button
            className="viewas-pill"
            /* THROUGH setScopeSel, which is what View as is set BY.
               Clearing `selectedPartner` alone left `scopeSel` behind,
               so the page's own banner stayed up after the pill said it
               had stopped -- the two controls disagreed about whether
               you were still viewing as anybody. */
            onClick={() => setScopeSel(ORIGIN_ALL)}
            title="Exit: back to all partners"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--heliotrope-deep)', background: 'var(--white-lilac)', border: '1px solid var(--line-strong)', borderRadius: 999, padding: '5px 11px' }}
          >
            Viewing as <b>{viewingAs}</b> <Icon name="x" size={12} />
          </button>
        )}
        <RoleSwitch />
        <HelpMenu open={pop === 'help'} onToggle={() => toggle('help')} />
        <NotificationsMenu open={pop === 'notif'} onToggle={() => toggle('notif')} read={notifRead} onClear={clearNotifs} items={notifs} />
      </div>
    </>
  );
}
