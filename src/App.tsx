/* =====================================================================
   Route map. Pre-auth pages (login, forgot password) sit outside the shell;
   everything else renders inside AppShell (sidebar + topbar). opndoor-admin
   -only screens are behind RequireRole guards (see the brief). Nav visibility
   is also role-filtered in the sidebar.
   ===================================================================== */
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequireRole, RequireCapability } from '@/components/guards/RequireRole';
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
import { AgencyHome } from '@/pages/Agencies/AgencyHome';
import { PartnerManagement } from '@/pages/PartnerManagement/PartnerManagement';
import { PartnerHome } from '@/pages/PartnerManagement/PartnerHome';
import { UserManagement } from '@/pages/UserManagement/UserManagement';
import { Team } from '@/pages/Team/Team';
import { Reconciliation } from '@/pages/Reconciliation/Reconciliation';
import { Health } from '@/pages/Health/Health';
import { OpsNotifications } from '@/pages/OpsNotifications/OpsNotifications';
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

        {/* /home is the single post-auth landing target and the per-actor resolver:
            opndoor staff get the queues-first Home; Home itself sends a developer to
            the Dev Centre and every other role to their book (Reporting). */}
        <Route path="/home" element={<Home />} />

        {/* Dev Centre. Management is here only to revoke a leaked key; the page
            renders them the keys panel alone. The RPCs scope themselves, so this
            guard decides what renders, not what is permitted. */}
        {/* Capability-gated, by the SAME predicate the sidebar filters on: a
            party with no API has no Dev Centre, and typing the address does not
            get round that. superadmin is exempt inside mayUseDevCentre. */}
        <Route element={<RequireCapability roles={['developer', 'superadmin', 'management']} capability="devCentre" redirectTo="/help" />}>
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
        </Route>
        {/* The Agencies section is an admin's and a supplier's view of a book of
            agencies. One of our own agencies gets /team instead — the same
            people, under the structure it actually has, with no rate cards and
            nobody else's branches. Same predicate as the nav item. */}
        <Route element={<RequireCapability roles={['superadmin', 'opndoor_manager', 'management', 'referrer']} capability="orgSection" redirectTo="/team" />}>
          <Route path="/agencies" element={<OrgManagement />} />
          <Route path="/agencies/:key" element={<AgencyHome />} />
        </Route>
        {/* Team is an agency MANAGER's screen. A Negotiator sees their own
            referrals and no team, so they are off the roles here exactly as they
            are off the nav item.
            The redirect is the dashboard rather than /agencies, and it has to be:
            /agencies sends an agency user back to /team (orgSection is the inverse
            of agencyTeam), so pointing this at /agencies would bounce a Negotiator
            between the two for ever. RequireCapability uses one redirectTo for
            both a role failure and a capability failure, so it must be somewhere
            every refused reader can actually land. */}
        <Route element={<RequireCapability roles={['management']} capability="agencyTeam" redirectTo="/dashboard" />}>
          <Route path="/team" element={<Team />} />
        </Route>
        <Route element={<RequireRole roles={['superadmin', 'management', 'referrer']} redirectTo="/dev-centre" />}>
          <Route path="/new-application" element={<NewApplication />} />
        </Route>

        {/* Users: opndoor admin + a SUPPLIER's management. An agency manager's
            people live on /team, so /users redirects them there. */}
        <Route element={<RequireCapability roles={['superadmin', 'management']} capability="orgSection" redirectTo="/team" />}>
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
          <Route path="/partners/:key" element={<PartnerHome />} />
          <Route path="/health" element={<Health />} />
          {/* Where opndoor's own alerts go. opndoor_manager may view it; the
              page renders values without controls for them, and set_ops_route
              refuses them in SQL either way. */}
          <Route path="/internal-notifications" element={<OpsNotifications />} />
        </Route>
      </Route>
      </Route>

      {/* unknown → /home; a non-opndoor role bounces on to /dashboard. */}
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
