/* =====================================================================
   Route map. Pre-auth pages (login, forgot password) sit outside the shell;
   everything else renders inside AppShell (sidebar + topbar). opndoor-admin
   -only screens are behind RequireRole guards (see the brief). Nav visibility
   is also role-filtered in the sidebar.
   ===================================================================== */
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequireRole } from '@/components/guards/RequireRole';
import { Apply } from '@/pages/Apply/Apply';
import {
  InviteLanding, Register,
  ResetPassword as TenantResetPassword, Verify as TenantVerify,
} from '@/pages/Apply/FrontDoor';
import { RequireAuth } from '@/components/guards/RequireAuth';
import { Login } from '@/pages/Login/Login';
import { ForgotPassword } from '@/pages/ForgotPassword/ForgotPassword';
import { ResetPassword } from '@/pages/auth/ResetPassword';
import { PaymentConfirmed } from '@/pages/Pay/PaymentConfirmed';
import { PaymentRetry } from '@/pages/Pay/PaymentRetry';
import { PayLanding } from '@/pages/Pay/PayLanding';
import { TenancyCorrection } from '@/pages/TenancyCorrection/TenancyCorrection';
import { Home } from '@/pages/Home/Home';
import { Dashboard } from '@/pages/Dashboard/Dashboard';
import { League } from '@/pages/League/League';
import { Activity } from '@/pages/Activity/Activity';
import { Applications } from '@/pages/Applications/Applications';
import { ApplicationDetail } from '@/pages/ApplicationDetail/ApplicationDetail';
import { NewApplication } from '@/pages/NewApplication/NewApplication';
import { OrgManagement } from '@/pages/OrgManagement/OrgManagement';
import { PartnerManagement } from '@/pages/PartnerManagement/PartnerManagement';
import { UserManagement } from '@/pages/UserManagement/UserManagement';
import { Reconciliation } from '@/pages/Reconciliation/Reconciliation';
import { Health } from '@/pages/Health/Health';
import { Help } from '@/pages/Help/Help';
import { DevCentre } from '@/pages/DevCentre/DevCentre';

/** /apply/signin moved to /login?tab=tenant. Carries the query string, because
    an invite token in it is the difference between claiming the application an
    agent built and opening an empty one. */
function LegacySignInRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('tab', 'tenant');
  return <Navigate to={`/login?${params.toString()}`} replace />;
}

export function App() {
  return (
    <Routes>
      {/* index → login (mirrors index.html) */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      {/* Public: the recovery link lands here to set a new password. */}
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* Public: the team-invite link lands here to set a password, then TOTP. */}
      <Route path="/accept-invite" element={<ResetPassword mode="invite" />} />

      {/* Public, unauthenticated tenant payment pages. */}
      {/* #1 The tokenised confirmation page the payment email + reminders link to. */}
      <Route path="/pay" element={<PayLanding />} />
      <Route path="/pay/confirmed" element={<PaymentConfirmed />} />
      <Route path="/pay/retry" element={<PaymentRetry />} />
      {/* Public: agent-reported tenancy-start correction, from the deed email (#81). */}
      <Route path="/tenancy-correction" element={<TenancyCorrection />} />
      {/* The tenant journey. PUBLIC in the routing sense: a tenant is not a
          staff principal and never passes RequireAuth, which reads public.users.
          Its own data access is authenticated inside tenantApi. */}
      <Route path="/apply/start" element={<Navigate to="/apply/register" replace />} />
      <Route path="/apply/register" element={<Register />} />
      {/* There is ONE sign-in page and it is /login. This redirect exists only
          because invite and reset emails already delivered carry the old path,
          and a 404 would strand somebody holding one. Nothing links here. It
          keeps the query string, so an ?invite= token still reaches the tab
          that claims it. */}
      <Route path="/apply/signin" element={<LegacySignInRedirect />} />
      {/* Tenant reset moved onto /forgot-password's Tenant tab. Redirects
          rather than 404s: reset links and older emails carry this path. */}
      <Route path="/apply/forgot" element={<Navigate to="/forgot-password?tab=tenant" replace />} />
      <Route path="/apply/reset" element={<TenantResetPassword />} />
      <Route path="/apply/verify" element={<TenantVerify />} />
      <Route path="/apply/invite" element={<InviteLanding />} />
      <Route path="/apply" element={<Apply />} />

      {/* authenticated shell (RequireAuth is a passthrough in mock/test mode) */}
      <Route element={<RequireAuth />}>
      <Route element={<AppShell />}>
        {/* Help is the only screen every role reaches. Its own ROLE_RANK gates
            which resources are listed. */}
        <Route path="/help" element={<Help />} />

        {/* The Opndoor-staff home (queues first). Every post-auth redirect targets
            /home; a non-opndoor role bounces to /dashboard via redirectTo, so this
            doubles as the per-actor landing: admins land here, partners on their book. */}
        <Route element={<RequireRole roles={['superadmin', 'opndoor_manager']} redirectTo="/dashboard" />}>
          <Route path="/home" element={<Home />} />
        </Route>

        {/* Dev Centre. Management is here only to revoke a leaked key; the page
            renders them the keys panel alone. The RPCs scope themselves, so this
            guard decides what renders, not what is permitted. */}
        <Route element={<RequireRole roles={['developer', 'superadmin', 'management']} redirectTo="/help" />}>
          <Route path="/dev-centre" element={<DevCentre />} />
        </Route>

        {/* The commercial portal. These eight routes previously sat inside the
            shell with NO guard, so an empty sidebar hid nothing that typing a
            URL could not reveal: /league renders partner and agent commission
            columns, /applications the whole partner book, /new-application
            creates live fee-bearing referrals.

            Guarded positively, so a role added later is excluded by default and
            has to be named here to get in. The server is the real boundary and
            was fixed first in 20260810210000; this is the front-end half. */}
        {/* redirectTo must be a route the REDIRECTED role can actually reach, or
            the guard bounces into itself. */}
        {/* A developer reads these four, partner-scoped. The server is the
            boundary: applications_select, agencies_select, branches_select and
            partners_select each gained a developer arm (20260811190000), and the
            commission columns are off the table grant entirely so no route can
            surface them. */}
        {/* opndoor_manager is Opndoor ops staff: it reads the whole book like an
            admin (its RLS read arms mirror superadmin) but cannot create referrals
            or reach the sensitive-settings routes below. */}
        <Route element={<RequireRole roles={['superadmin', 'opndoor_manager', 'management', 'referrer', 'developer']} redirectTo="/dev-centre" />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/league" element={<League />} />
          <Route path="/applications" element={<Applications />} />
          <Route path="/applications/:ref" element={<ApplicationDetail />} />
        </Route>

        {/* Staff tools for people who work the book. opndoor_manager works the
            org here; it is NOT on /new-application, which create_referral refuses
            for it in SQL (only is_admin or a partner's own management/referrer). */}
        <Route element={<RequireRole roles={['superadmin', 'opndoor_manager', 'management', 'referrer']} redirectTo="/dev-centre" />}>
          <Route path="/activity" element={<Activity />} />
          <Route path="/agencies" element={<OrgManagement />} />
        </Route>
        <Route element={<RequireRole roles={['superadmin', 'management', 'referrer']} redirectTo="/dev-centre" />}>
          <Route path="/new-application" element={<NewApplication />} />
        </Route>

        {/* Users: opndoor admin + Management (partner staff) */}
        <Route element={<RequireRole roles={['superadmin', 'management']} />}>
          <Route path="/users" element={<UserManagement />} />
        </Route>

        {/* The opndoor team, its own route rather than a ?team= fork on /users. */}
        <Route element={<RequireRole roles={['superadmin']} redirectTo="/home" />}>
          <Route path="/opndoor-team" element={<UserManagement team />} />
        </Route>

        {/* The reconciliation + direct-match queues: opndoor ops staff work these. */}
        <Route element={<RequireRole roles={['superadmin', 'opndoor_manager']} redirectTo="/dashboard" />}>
          <Route path="/reconciliation" element={<Reconciliation />} />
        </Route>

        {/* opndoor admin only: the sensitive-settings surfaces. */}
        <Route element={<RequireRole roles={['superadmin']} />}>
          <Route path="/partners" element={<PartnerManagement />} />
          <Route path="/health" element={<Health />} />
        </Route>
      </Route>
      </Route>

      {/* unknown → /home; a non-opndoor role bounces on to /dashboard. */}
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
