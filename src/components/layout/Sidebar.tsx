/* =====================================================================
   Sidebar — brand, product label, role-filtered navigation, and the
   signed-in user footer. Ported from portal.js buildSidebar. The
   reconciliation badge count comes from the queue.
   ===================================================================== */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { reconciliationPendingCount, awaitingDecisionCount, loadAgencyMatchQueue } from '@/data';
import { useSession } from '@/session/SessionContext';
import { NAV } from '@/constants/nav';
import { useOnClickOutside } from '@/hooks/useOnClickOutside';
import { usePageMetaValue } from './pageMeta';
import { Icon } from '@/components/ui/Icon';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  // useSession() re-renders on dataVersion bumps (re-hydration), so the badge
  // reflects the current pending-review count after a confirm or a new referral.
  const { role, user, signOut, dataVersion } = useSession();

  // The sidebar filters on ROLE ONLY. A capability gate used to live here and
  // hid the Dev Centre from every developer; see the note on the Dev Centre item
  // in constants/nav.ts for why that was wrong and why it is not coming back.
  const navigate = useNavigate();
  const { active } = usePageMetaValue();
  // The direct-signup agency-match backlog is a separate, async queue (superadmin
  // RPC); it lived on the Reconciliation page with no badge, so it could silently
  // back up. Fold its needs-action count into the Reconciliation badge, refreshing
  // on dataVersion so a match resolved on a record clears it here too.
  const [matchCount, setMatchCount] = useState(0);
  useEffect(() => {
    if (role !== 'superadmin') { setMatchCount(0); return; }
    let cancelled = false;
    void loadAgencyMatchQueue()
      .then((rows) => { if (!cancelled) setMatchCount(rows.filter((r) => r.state === 'needs_review').length); })
      .catch(() => { if (!cancelled) setMatchCount(0); });
    return () => { cancelled = true; };
  }, [role, dataVersion]);
  const reconcileBadge = reconciliationPendingCount() + matchCount;
  const decisionsBadge = awaitingDecisionCount();
  const [menuOpen, setMenuOpen] = useState(false);
  const footRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(footRef, () => setMenuOpen(false), menuOpen);

  return (
    <>
      <div className="sb__brand">
        <span className="wordmark">opndoor</span>
        <span className="sb__cobrand">
          Partner<br />portal
        </span>
      </div>
      <div className="sb__product">
        <div className="sb__product-tag">Guarantee</div>
        <div className="sb__product-name">Referral Portal</div>
      </div>

      <nav className="sb__nav">
        {NAV.map((grp) => {
          const items = grp.items.filter((it) => it.roles.includes(role));
          if (!items.length) return null;
          return (
            <div className="sb__group" key={grp.group}>
              <div className="sb__group-label">{grp.group}</div>
              {items.map((it) => {
                const badge = it.badge === 'reconcile' ? reconcileBadge : it.badge === 'decisions' ? decisionsBadge : undefined;
                return (
                  <Link key={it.id} className={`sb__link${active === it.id ? ' is-active' : ''}`} to={it.to} onClick={onNavigate}>
                    <Icon name={it.icon} />
                    <span>{it.label}</span>
                    {badge ? <span className="sb__link-badge">{badge}</span> : null}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="sb__foot" ref={footRef}>
        {menuOpen && (
          <div className="sb__usermenu" role="menu">
            <div className="sb__usermenu-head">
              <div className="sb__user-name">{user.name}</div>
              <div className="sb__user-role">{user.label}</div>
            </div>
            <button
              type="button"
              className="sb__usermenu-item sb__usermenu-item--danger"
              role="menuitem"
              onClick={async () => { setMenuOpen(false); await signOut(); navigate('/login'); }}
            >
              <Icon name="arrowLeft" /> Sign out
            </button>
          </div>
        )}
        <button
          type="button"
          className={`sb__user${menuOpen ? ' is-open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className="sb__avatar">{user.initials}</span>
          <div className="sb__user-txt">
            <div className="sb__user-name">{user.name}</div>
            <div className="sb__user-role">{user.label}</div>
          </div>
          <span className="sb__user-caret"><Icon name="caretUp" /></span>
        </button>
      </div>
    </>
  );
}
