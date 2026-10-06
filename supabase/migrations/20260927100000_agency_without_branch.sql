-- An agency may be created with NO branch yet.
--
-- Group onboarding is often a skeleton: the group and its agencies are set up by
-- Opndoor, and the director or each agency manager adds their own branches on
-- first login, because they are the ones who know them. admin_create_agency_and_branch
-- refused that -- "A first branch name is required." -- so the only way to stand a
-- group up was to invent branch names on the operator's behalf and let somebody
-- rename them later.
--
-- p_branch_name is now optional. Everything else is unchanged, including the
-- admin + AAL2 guard and the returned shape, so the existing single-branch call
-- keeps behaving exactly as it did; branch_id simply comes back null when no
-- branch was asked for.
--
-- A branchless agency is SAFE on both paths that could care:
--   * create_referral takes a branch id, so there is nothing to refer against
--     until one exists -- it cannot be reached, rather than failing oddly.
--   * org_deed_readiness emits the agency row from its own people, and no branch
--     rows, so it reports readiness without inventing a branch warning.
-- The previous 6-argument signature must GO, not merely be superseded: every
-- argument after the first has a default, so leaving both in place makes a
-- named-argument call from PostgREST ambiguous ("function is not unique") and
-- would break the Add agency flow outright.
drop function if exists public.admin_create_agency_and_branch(text, text, text, numeric, numeric, text);

create or replace function public.admin_create_agency_and_branch(
  p_agency_name  text,
  p_branch_name  text default null,
  p_branch_area  text default null,
  p_partner_rate numeric default null,
  p_agent_rate   numeric default null,
  p_partner_slug text default 'opndoor-agents',
  p_group_id     uuid default null
)
returns table (agency_id uuid, branch_id uuid)
language plpgsql security definer set search_path to '' as $function$
declare v_partner uuid; v_agency uuid; v_branch uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if coalesce(btrim(p_agency_name), '') = '' then raise exception 'An agency name is required.' using errcode = '22023'; end if;

  select id into v_partner from public.partners where slug = coalesce(nullif(btrim(p_partner_slug), ''), 'opndoor-agents');
  if v_partner is null then raise exception 'Partner not found.' using errcode = '22023'; end if;

  if p_group_id is not null and not exists (
    select 1 from public.agency_groups g where g.id = p_group_id and g.partner_id = v_partner
  ) then
    raise exception 'That group is not under this partner.' using errcode = '22023';
  end if;

  insert into public.agencies (partner_id, name, review_state, partner_rate, agent_rate, group_id)
  values (v_partner, btrim(p_agency_name), 'confirmed', p_partner_rate, p_agent_rate, p_group_id)
  returning id into v_agency;

  -- Optional: a skeleton agency waits for its manager to add branches.
  if coalesce(btrim(p_branch_name), '') <> '' then
    insert into public.branches (agency_id, partner_id, name, area, review_state)
    values (v_agency, v_partner, btrim(p_branch_name), nullif(btrim(coalesce(p_branch_area, '')), ''), 'confirmed')
    returning id into v_branch;
  end if;

  return query select v_agency, v_branch;
end $function$;

comment on function public.admin_create_agency_and_branch(text, text, text, numeric, numeric, text, uuid) is
  'Admin agency onboarding. The first branch is OPTIONAL: a group may be stood up as a skeleton and its managers add their own branches later. An optional group_id parents the agency at creation, which is the same result as creating it independent and re-parenting.';

revoke all on function public.admin_create_agency_and_branch(text, text, text, numeric, numeric, text, uuid) from public, anon;
grant execute on function public.admin_create_agency_and_branch(text, text, text, numeric, numeric, text, uuid) to authenticated;
