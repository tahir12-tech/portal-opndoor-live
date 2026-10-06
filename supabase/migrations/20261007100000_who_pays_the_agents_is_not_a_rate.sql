/* =====================================================================
   WHO PAYS THE AGENTS IS NOT A RATE, SO THE CLIENT MAY READ IT.

   `partners.opndoor_pays_agents` arrived in 20261007060000 and no
   `authenticated` role can select it, because a column added to a table
   does NOT inherit that table's column grants. That is the discipline
   working rather than an oversight, and it is why this is a deliberate
   line rather than a table-wide grant.

   MEASURED, THEN DECIDED. Of the sixteen columns on `public.partners`,
   exactly two are withheld from `authenticated`: `partner_rate` and
   `agent_rate`. They came off in 20260811180000 because narrowing the
   client's SELECT string was never enforcement -- PostgREST answers
   whatever it is asked -- and they now reach the roles entitled to them
   through `my_partner_rates()`. Every other column, including the
   operational flags `portal_referrals_enabled`, `api_access_enabled`
   and `referrer_leaderboard_mode`, is readable.

   THIS ONE IS IN THAT SECOND CLASS. It carries no money. It says WHO
   Opndoor pays on a supplier's referrals, not how much, and the supplier
   Commission tab has to render it as a switch. A supplier reading its
   own is reading its own arrangement.

   NOT A TABLE-WIDE GRANT, deliberately: this names the column, so the
   next one added is withheld again by default and somebody has to think
   about it, exactly as this needed thinking about.
   ===================================================================== */
grant select (opndoor_pays_agents) on public.partners to authenticated;
