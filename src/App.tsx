/* =====================================================================
   Route map. Pre-auth pages (login, forgot password) sit outside the shell;
   everything else renders inside AppShell (sidebar + topbar). opndoor-admin
   -only screens are behind RequireRole guards (see the brief). Nav visibility
   is also role-filtered in the sidebar.
   ===================================================================== */
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequireRole } from '@/components/guards/RequireRole';
import { RequireAuth } from '@/components/guards/RequireAuth';
import { Login } from '@/pages/Login/Login';
import { ForgotPassword } from '@/pages/ForgotPassword/ForgotPassword';
import { ResetPassword } from '@/pages/auth/ResetPassword';
import { PaymentConfirmed } from '@/pages/Pay/PaymentConfirmed';
import { PaymentRetry } from '@/pages/Pay/PaymentRetry';
import { PayLanding } from '@/pages/Pay/PayLanding';
import { TenancyCorrection } from '@/pages/TenancyCorrection/TenancyCorrection';
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

      {/* authenticated shell (RequireAuth is a passthrough in mock/test mode) */}
      <Route element={<RequireAuth />}>
      <Route element={<AppShell />}>
        {/* Help is the only screen every role reaches. Its own ROLE_RANK gates
            which resources are listed. */}
        <Route path="/help" element={<Help />} />

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
            the guard bounces into itself. Only a developer is turned away here,
            and /dev-centre is exactly where they belong. */}
        <Route element={<RequireRole roles={['superadmin', 'management', 'referrer']} redirectTo="/dev-centre" />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/league" element={<League />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/applications" element={<Applications />} />
          <Route path="/applications/:ref" element={<ApplicationDetail />} />
          <Route path="/new-application" element={<NewApplication />} />
          <Route path="/agencies" element={<OrgManagement />} />
        </Route>

        {/* Users: opndoor admin + Management */}
        <Route element={<RequireRole roles={['superadmin', 'management']} />}>
          <Route path="/users" element={<UserManagement />} />
        </Route>

        {/* opndoor admin only */}
        <Route element={<RequireRole roles={['superadmin']} />}>
          <Route path="/partners" element={<PartnerManagement />} />
          <Route path="/reconciliation" element={<Reconciliation />} />
          <Route path="/health" element={<Health />} />
        </Route>
      </Route>
      </Route>

      {/* unknown → dashboard */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
