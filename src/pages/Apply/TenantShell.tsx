/* =====================================================================
   The tenant's shell: the PORTAL's own chrome, with tenant furniture in it.

   WHAT WAS WRONG BEFORE. The signed-in tenant area was a centred column with
   its own header and its own tab strip. Even after the colours were swapped for
   portal tokens it still did not look like the portal, because the LAYOUT was
   different: no sidebar, no topbar, no page head. Restyling a different shape
   does not make it the same product.

   So this is `.app` / `.sb` / `.main` / `.topbar` / `.content` from portal.css,
   the same classes AppShell uses, with a tenant sidebar instead of the staff
   one. Not a copy of the markup: the same stylesheet, so the two cannot drift.

   WHY NOT REUSE AppShell ITSELF. It renders Sidebar and Topbar, and both read
   useSession, which resolves a public.users row. A tenant has none by
   construction, so mounting them would put the staff session machinery behind
   every tenant screen to render a nav a tenant must not see. Same chrome,
   different contents, no shared state.
   ===================================================================== */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useOnClickOutside } from '@/hooks/useOnClickOutside';
import { signOut } from '@/tenant/tenantAuth';
import type { IconName } from '@/components/ui/Icon';

export interface TenantNavItem {
  id: string;
  label: string;
  icon: IconName;
  done?: boolean;
  locked?: boolean;
}

export function TenantShell({
  nav, active, onNavigate, name, email, title, crumbs, actions, children,
}: {
  nav: { group: string; items: TenantNavItem[] }[];
  active: string;
  onNavigate: (id: string) => void;
  name: string;
  email: string;
  title: string;
  crumbs: string[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const footRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(footRef, () => setMenuOpen(false), menuOpen);

  useEffect(() => {
    document.body.classList.toggle('sb-open', drawerOpen);
    return () => document.body.classList.remove('sb-open');
  }, [drawerOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const initials = (name || email || '?')
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

  return (
    <>
      <div className="app">
        <aside className="sb">
          <div className="sb__brand">
            <span className="wordmark">opndoor</span>
            {/* Where the staff sidebar says "Partner portal". A tenant is not a
                partner and should not be told they are looking at one. */}
            <span className="sb__cobrand">Your<br />application</span>
          </div>
          <div className="sb__product">
            <div className="sb__product-tag">Guarantee</div>
            <div className="sb__product-name">Tenant application</div>
          </div>

          <nav className="sb__nav">
            {nav.map((grp) => (
              <div className="sb__group" key={grp.group}>
                <div className="sb__group-label">{grp.group}</div>
                {grp.items.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    className={`sb__link tsb__link${it.id === active ? ' is-active' : ''}${it.locked ? ' is-locked' : ''}`}
                    onClick={() => { onNavigate(it.id); setDrawerOpen(false); }}
                  >
                    <Icon name={it.locked ? 'lock' : it.icon} />
                    <span>{it.label}</span>
                    {/* A tick where the staff sidebar carries a count. Progress
                        is the thing a tenant wants from a nav item, not volume. */}
                    {it.done && <span className="tsb__tick" aria-label="done"><Icon name="check" /></span>}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="sb__foot" ref={footRef}>
            {menuOpen && (
              <div className="sb__usermenu" role="menu">
                <div className="sb__usermenu-head">
                  <div className="sb__user-name">{name || 'Your account'}</div>
                  <div className="sb__user-role">{email}</div>
                </div>
                <button
                  type="button"
                  className="sb__usermenu-item sb__usermenu-item--danger"
                  role="menuitem"
                  onClick={async () => { setMenuOpen(false); await signOut(); window.location.href = '/login?tab=tenant'; }}
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
              <span className="sb__avatar">{initials}</span>
              <div className="sb__user-txt">
                <div className="sb__user-name">{name || 'Your account'}</div>
                <div className="sb__user-role">Tenant</div>
              </div>
              <span className="sb__user-caret"><Icon name="caretUp" /></span>
            </button>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <button className="topbar__menu" type="button" aria-label="Menu" onClick={() => setDrawerOpen((v) => !v)}>
              <Icon name="menu" />
            </button>
            <div className="topbar__crumbs">
              {crumbs.map((c, i) => (
                <span key={c}>{i > 0 && <span aria-hidden="true"> / </span>}{c}</span>
              ))}
            </div>
            <div className="topbar__title">{title}</div>
            <div className="topbar__actions">{actions}</div>
          </header>
          <main className="content">{children}</main>
        </div>
      </div>
      <div className="sb-scrim" onClick={() => setDrawerOpen(false)} />
    </>
  );
}
