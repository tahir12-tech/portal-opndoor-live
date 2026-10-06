/* =====================================================================
   THE INVOICE EMAIL HAS AN ADDRESS.

   Matt, 2026-10-01, verbatim: "Invoice email: default it to
   accounts@opndoor.co, as a setting Opndoor admin can change later. No
   warning needed while it's set. Tell me where the setting lives."

   The third message about one setting, and they converge rather than
   contradict. The first ended "Set it to [EMAIL]" with the placeholder
   still in it. The second said no default, refuse to send, warn in two
   places. This one gives the address.

   "NO WARNING NEEDED WHILE IT'S SET" KEEPS THE SECOND MESSAGE'S
   MACHINERY rather than undoing it. The run still refuses and Home and
   Health still say why if somebody ever clears this -- which is now an
   unlikely case rather than the starting state, and that is exactly the
   shape a guard should have. 20261007150000 is left standing.

   SEEDED, NOT HARDCODED. The value is a row an admin can change, not a
   constant in a function, which is the whole of "a setting Opndoor
   admin can change later". `on conflict do nothing` so re-running the
   files never overwrites an address somebody has since set.
   ===================================================================== */
insert into public.app_settings (key, text_value, updated_by_name)
values ('statement_invoice_email', 'accounts@opndoor.co', 'opndoor')
on conflict (key) do nothing;
