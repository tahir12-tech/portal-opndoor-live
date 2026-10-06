-- ===========================================================================
-- Three things the agent referral form needs that the schema cannot hold, and a
-- writer for the attachment table that had none.
--
-- MIDDLE NAME. applications has tenant_first_name and tenant_last_name and no
-- middle. A referencing check runs against a legal name, and dropping a middle
-- name silently is the kind of mismatch that comes back as a failed identity
-- check nobody can explain.
--
-- SHARE. The share columns exist on applications already (20260812190000) for
-- joint tenancies. Nothing is added here; the form derives one from the other
-- and stores both, and this migration only records why both are stored: the
-- percentage is the commercial fact and the amount is what the eligibility
-- check is assessed against, so recomputing either later against a corrected
-- rent would silently restate a decision.
--
-- USER_AGENCY_ATTACHMENTS HAD NO WRITER. I added the table, its RLS policy and
-- the trigger that maintains partner_agency_relationships.user_attached, and no
-- way to create a row. The bootstrap the whole reachability design rests on
-- could not happen. That is fixed here.
-- ===========================================================================

alter table public.applications
  add column if not exists tenant_middle_name text;

grant select (tenant_middle_name) on public.applications to authenticated;

comment on column public.applications.tenant_middle_name is
  'Optional. Carried because the eligibility check runs against a legal name, and a dropped middle name surfaces later as an identity mismatch nobody can trace.';

comment on column public.applications.share_percent is
  'The applicant''s assigned share of the rent. The COMMERCIAL fact; share_amount is what eligibility is assessed against. Both are stored rather than one derived, because recomputing either against a later-corrected rent would silently restate a decision already made.';

-- ---------------------------------------------------------------------------
-- Attaching a person to the agency they work at.
--
-- This is the bootstrap for cross-route reach: it is what lets an agent refer
-- against an agency another partner introduced. The trigger on the table keeps
-- partner_agency_relationships.user_attached in step, so the relationship
-- follows from the attachment rather than being maintained separately.
-- ---------------------------------------------------------------------------
create or replace function public.attach_user_to_agency(p_user uuid, p_agency uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_target public.users; v_agency public.agencies;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into v_target from public.users where id = p_user;
  if not found then raise exception 'User not found' using errcode = '22023'; end if;
  select * into v_agency from public.agencies where id = p_agency;
  if not found then raise exception 'Agency not found' using errcode = '22023'; end if;

  -- Who may attach: an opndoor admin, or a manager acting within their own
  -- partner. A branch manager cannot: attaching somebody to an agency is a
  -- statement about the whole brand, which is above their position.
  if not (
    public.is_admin()
    or (
      public.app_role() = 'management'
      and v_target.partner_id = public.app_partner()
      and (
        not public.app_has_scope()
        or exists (select 1 from public.user_scopes s
                    where s.user_id = auth.uid() and s.kind in ('group','agency'))
      )
    )
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  insert into public.user_agency_attachments (user_id, agency_id, created_by)
  values (p_user, p_agency, auth.uid())
  on conflict (user_id, agency_id) do nothing;
end $function$;

create or replace function public.detach_user_from_agency(p_user uuid, p_agency uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_target public.users;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into v_target from public.users where id = p_user;
  if not found then raise exception 'User not found' using errcode = '22023'; end if;

  if not (public.is_admin()
          or (public.app_role() = 'management' and v_target.partner_id = public.app_partner())) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- The trigger recomputes user_attached for the pair and deletes the
  -- relationship row when nothing else holds it up.
  delete from public.user_agency_attachments where user_id = p_user and agency_id = p_agency;
end $function$;

revoke all on function public.attach_user_to_agency(uuid, uuid) from public, anon;
revoke all on function public.detach_user_from_agency(uuid, uuid) from public, anon;
grant execute on function public.attach_user_to_agency(uuid, uuid) to authenticated;
grant execute on function public.detach_user_from_agency(uuid, uuid) to authenticated;

comment on function public.attach_user_to_agency(uuid, uuid) is
  'Records that somebody works at an agency, which is the bootstrap for cross-route reach: it is what lets an agent refer against an agency another partner introduced. The table had no writer until this existed.';

-- ---------------------------------------------------------------------------
-- Setting a position.
-- ---------------------------------------------------------------------------
create or replace function public.set_user_scope(
  p_user uuid, p_kind text, p_target uuid
) returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_target public.users;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_kind not in ('group','agency','branch') then
    raise exception 'Scope must be group, agency or branch. A negotiator simply has none.' using errcode = '22023';
  end if;

  select * into v_target from public.users where id = p_user;
  if not found then raise exception 'User not found' using errcode = '22023'; end if;

  -- Only a group or agency position can grant positions, and only within the
  -- partner. A branch manager granting positions would be a way out of the
  -- branch they were given.
  if not (
    public.is_admin()
    or (
      public.app_role() = 'management'
      and v_target.partner_id = public.app_partner()
      and (
        not public.app_has_scope()
        or exists (select 1 from public.user_scopes s
                    where s.user_id = auth.uid() and s.kind in ('group','agency'))
      )
    )
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  insert into public.user_scopes (user_id, kind, group_id, agency_id, branch_id, created_by)
  values (
    p_user, p_kind,
    case when p_kind = 'group'  then p_target end,
    case when p_kind = 'agency' then p_target end,
    case when p_kind = 'branch' then p_target end,
    auth.uid()
  )
  on conflict do nothing;
end $function$;

revoke all on function public.set_user_scope(uuid, text, uuid) from public, anon;
grant execute on function public.set_user_scope(uuid, text, uuid) to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='applications'
                    and column_name='tenant_middle_name') then
    raise exception 'tenant_middle_name was not added';
  end if;
  if not has_column_privilege('authenticated','public.applications','tenant_middle_name','SELECT') then
    raise exception 'tenant_middle_name has no grant, so the client cannot read it';
  end if;
end $$;
