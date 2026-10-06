/* =====================================================================
   NOT IN NETWORK: A DECISION IS A MOMENT, NOT A FLAG.

   Matt, 2026-09-30, verbatim: "Reconciliation, Not in network: give each
   agency two actions, each with a confirmation box: 'Added to HubSpot'
   (marks it done, records who and when, and removes it from the list)
   and 'Ignore' (removes it, recorded). If the same agency is named again
   later by another tenant, it reappears."

   THE LAST SENTENCE IS THE WHOLE DESIGN. "It reappears" is impossible
   with a dismissed flag on the agency name: once set, nothing turns it
   back on, and the obvious implementation -- a `handled boolean` --
   quietly loses every later tenant who names the same agency. Which is
   the case that matters: a second tenant naming Foxglove is new evidence
   that we should be working with them, and it is exactly what a "done"
   tick would hide.

   SO A DECISION IS STORED WITH ITS TIME, and the list shows any agency
   named since the last decision about it. `not_in_network_agencies`
   already computes `max(at)`, the moment a tenant last named them, so
   the comparison is one clause: named after the decision, or no decision
   at all.

   BOTH ACTIONS REMOVE THE ROW AND BOTH ARE RECORDED, which is Matt's
   sentence and also why they are one table with a `decision` column
   rather than two mechanisms. The difference between "added to HubSpot"
   and "ignored" is what somebody did next, not how the list behaves.

   NOTHING OF THE TENANT'S IS TOUCHED. The decision is about the AGENCY
   NAME, keyed on `typed_name_key`, the same key the list groups on.
   Item 24: "Only the agency and agent contact go across, never the
   tenant's details."
   ===================================================================== */

create table if not exists public.not_in_network_decisions (
  id          uuid primary key default gen_random_uuid(),
  /* The normalised name, the same key not_in_network_agencies groups on.
     Not an agency id: these are agencies we do NOT work with, so there is
     no row in public.agencies to point at, which is the point of them. */
  name_key    text not null,
  decision    text not null check (decision in ('added', 'ignored')),
  decided_by  uuid references public.users(id),
  decided_at  timestamptz not null default now(),
  /* The spelling in front of the person when they decided, kept so an
     audit row reads as a name rather than a slug. */
  typed_name  text
);

/* READ BY name_key, NEWEST FIRST, on every load of the list. */
create index if not exists not_in_network_decisions_key_idx
  on public.not_in_network_decisions (name_key, decided_at desc);

comment on table public.not_in_network_decisions is
  'What somebody did about an agency on the Not in network list, and when. A DECISION AT A MOMENT, not a done flag: the list shows any agency named by a tenant since the last decision about it, so a second tenant naming the same agency brings it back.';

alter table public.not_in_network_decisions enable row level security;

/* RLS ON, NO POLICY. Read only through the definer function below and
   written only by the definer RPC, both of which check is_opndoor_staff
   for themselves. Deny-by-default is the whole access rule, the shape 30
   other tables in this schema use. */
drop policy if exists require_aal2 on public.not_in_network_decisions;
create policy require_aal2 on public.not_in_network_decisions
  as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());

/* ---- the two actions ------------------------------------------------ */

create or replace function public.decide_not_in_network(p_name_key text, p_decision text, p_typed_name text default null)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_who text;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  /* THE SAME GATE THE LIST HAS. `not_in_network_agencies` is
     is_opndoor_staff, so anybody who can read the list can act on it and
     nobody else can. An agency user has no business here at all: the
     rows are other agencies' names. */
  if not coalesce(public.is_opndoor_staff(), false) then
    raise exception 'Only Opndoor decides what happens to a not-in-network agency.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name_key), '') = '' then
    raise exception 'No agency named.' using errcode = '22023';
  end if;
  if coalesce(p_decision, '') not in ('added', 'ignored') then
    raise exception 'A decision is either added or ignored.' using errcode = '22023';
  end if;

  insert into public.not_in_network_decisions (name_key, decision, decided_by, typed_name)
  values (btrim(p_name_key), p_decision, auth.uid(), nullif(btrim(coalesce(p_typed_name, '')), ''));

  select coalesce(nullif(btrim(full_name), ''), email) into v_who
    from public.users where id = auth.uid();

  /* AUDITED AGAINST THE NAME, because there is no entity to audit
     against: that is what not-in-network means. `entity_type` carries
     'agency_name' rather than 'agency' so nobody joins it to a real one. */
  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency_name', null,
          case when p_decision = 'added' then 'not_in_network_added' else 'not_in_network_ignored' end,
          coalesce(nullif(btrim(coalesce(p_typed_name, '')), ''), btrim(p_name_key))
            || case when p_decision = 'added'
                    then ' was added to HubSpot by hand and taken off the not-in-network list'
                    else ' was ignored and taken off the not-in-network list' end,
          coalesce(v_who, 'opndoor admin'), auth.uid());
end $function$;

comment on function public.decide_not_in_network(text, text, text) is
  'Record what was done about a not-in-network agency: added to HubSpot by hand, or ignored. Both take it off the list until a tenant names it again.';

revoke all on function public.decide_not_in_network(text, text, text) from public, anon;
grant execute on function public.decide_not_in_network(text, text, text) to authenticated, service_role;

/* ---- and the list forgets it until somebody names it again ---------- */

/* Regenerated from 20261006990000's definition -- the last one, found
   with a case-insensitive grep -- with one clause added and nothing else
   touched. The return type is unchanged, so no drop is needed. */
CREATE OR REPLACE FUNCTION public.not_in_network_agencies()
 RETURNS TABLE(name_key text, typed_name text, tenants integer, last_named_at timestamp with time zone, contacts jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_opndoor_staff(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  return query
    with named as (
      select m.typed_name_key,
             m.typed_name,
             m.application_id,
             /* WHEN THE TENANT NAMED THEM. Was coalesce(m.resolved_at,
                m.created_at), which on this list is always resolved_at --
                the moment we pressed "Not in network". See the header. */
             m.created_at as at
        from public.application_agency_match m
        join public.applications a on a.id = m.application_id
       where m.state = 'dismissed'
         and a.livemode
         and coalesce(btrim(m.typed_name_key), '') <> ''
    ),
    /* THE LAST DECISION ABOUT EACH NAME, if there is one. */
    decided as (
      select d.name_key, max(d.decided_at) as at
        from public.not_in_network_decisions d
       group by d.name_key
    )
    select n.typed_name_key,
           /* The spelling the most recent tenant used, which is what goes
              into the CRM. Now genuinely the most recent TENANT rather
              than the most recently dismissed row. */
           (array_agg(n.typed_name order by n.at desc))[1],
           count(*)::integer,
           max(n.at),
           coalesce(
             (select jsonb_agg(distinct jsonb_build_object(
                       'agencyName', c.agency_name,
                       'title',      c.title,
                       'firstName',  c.first_name,
                       'lastName',   c.last_name,
                       'email',      c.email,
                       'phone',      c.phone))
                from public.application_delivery_contacts c
               where c.kind = 'letting_agent'
                 and c.application_id in (select n2.application_id from named n2
                                           where n2.typed_name_key = n.typed_name_key)),
             '[]'::jsonb)
      from named n
      left join decided dd on dd.name_key = n.typed_name_key
     group by n.typed_name_key, dd.at
     /* NAMED SINCE THE DECISION, OR NEVER DECIDED. Matt: "If the same
        agency is named again later by another tenant, it reappears."
        The comparison is against the last time a TENANT named them, not
        against the row count, so a second naming brings the agency back
        with its whole history rather than as a new one. */
    having dd.at is null or max(n.at) > dd.at
     order by max(n.at) desc;
end $function$;
