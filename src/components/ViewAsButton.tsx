/* =====================================================================
   VIEW AS — on the party's own page, where the party is.

   Matt, 2026-09-30, verbatim: "NM-M: keep View as, moved to a 'View as'
   button on each agency and supplier page; delete the Reporting scope
   picker."

   THE CONTROL IS THE SAME ONE IT ALWAYS WAS. It writes `scopeSel`, the one
   selection Reporting and Applications share (Matt, 2026-09-29), and
   `viewingAs` derives from it in SessionContext. Nothing about the rule
   changes; what changes is where you reach it. You no longer pick a party
   off a list of every party to read their page: you are already on their
   page, and the button says "show me this".

   WHY IT IS ONE COMPONENT AND NOT TWO BUTTONS. An agency and a supplier
   encode their selection differently -- `agency:<name>` across partners,
   `partner:<slug>` for a supplier -- and the gate, the copy and the
   navigation are the same on both. Two copies would be two places for the
   gate to drift.

   WHY THE GATE IS `superadmin` AND NOT `isOpndoorStaff`. The agency page's
   Reporting tab admits both Opndoor roles, and it would look consistent to
   admit both here. It would also be a dead control: `viewingAs` derives in
   SessionContext only for `superadmin`, so an opndoor_manager pressing this
   would narrow their Applications list and see Reporting unchanged, with
   nothing on screen saying why. A button that appears to do nothing is
   worse than an absent one. Opndoor's ops staff already have the better
   surface for the same question -- the per-customer Reporting tab on this
   very page. If view-as is ever wanted for them, widen SessionContext
   first and this gate second, in that order.
   ===================================================================== */
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useSession } from '@/session/SessionContext';
import { rememberScope } from '@/data/scopeRecents';
import type { OriginScope } from '@/data/origin';

interface Props {
  /** The selection this party is, already encoded: `agency:<name>` or `partner:<slug>`. */
  scope: OriginScope;
}

export function ViewAsButton({ scope }: Props) {
  const { role, setScopeSel } = useSession();
  const navigate = useNavigate();
  if (role !== 'superadmin') return null;
  return (
    <Button
      variant="quiet"
      size="sm"
      title="Read Reporting as this customer's own management sees it"
      onClick={() => {
        setScopeSel(scope);
        /* The recents list was the picker's memory and it outlives the
           picker: Applications still offers it, and a party you have just
           read is exactly the one you reach for again. */
        rememberScope(scope);
        /* The button's whole point is the page it takes you to. Setting the
           selection and leaving the reader on the agency page would make
           this a preference control, which is the thing Matt found
           confusing about the picker. */
        navigate('/dashboard');
      }}
    >
      <Icon name="eye" /> View as
    </Button>
  );
}
