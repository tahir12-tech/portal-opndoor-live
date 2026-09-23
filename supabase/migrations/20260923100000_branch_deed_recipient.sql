-- Nominated deed recipient for a branch (agent-rail / platform agencies).
--
-- For an agent-rail org the deed is delivered to one of the org's own PEOPLE, in
-- order: a nominated recipient if set, else the branch manager, else the agency or
-- group manager above. This table holds the optional nomination — a user chosen to
-- receive deeds for a branch. Additive, its own table (like application_delivery_
-- contacts) so no existing grant is touched, and off the Rightmove referral path.
create table if not exists public.branch_deed_recipient (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  user_id   uuid not null references public.users(id) on delete cascade,
  set_by    uuid references public.users(id) on delete set null,
  set_at    timestamptz not null default now()
);
alter table public.branch_deed_recipient enable row level security;

-- Read: opndoor staff, or a partner's own people who can see that branch (mirrors
-- branches_select — partner-scoped, narrowed to a position when one is held).
create policy branch_deed_recipient_select on public.branch_deed_recipient for select using (
  public.is_opndoor_staff()
  or exists (
    select 1 from public.branches b
    where b.id = branch_id
      and b.partner_id = public.app_partner()
      and (not public.app_has_scope() or b.id in (select public.app_scope_branches()))
  )
);
-- Writes go only through the RPCs below (service-role / definer); no direct policy.

-- Nominate a user as the deed recipient for a branch. Admin, or a manager whose
-- position covers the branch; the nominee must be a user within the same partner.
create or replace function public.set_branch_deed_recipient(p_branch uuid, p_user uuid)
returns void language plpgsql security definer set search_path to '' as $function$
declare v_partner uuid; v_user_partner uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id into v_partner from public.branches where id = p_branch;
  if v_partner is null then raise exception 'Branch not found' using errcode = '22023'; end if;
  select partner_id into v_user_partner from public.users where id = p_user;
  if v_user_partner is null or v_user_partner <> v_partner then
    raise exception 'The nominated recipient must be a user in this organisation.' using errcode = '22023';
  end if;
  if not (
    public.is_admin()
    or (public.app_role() = 'management'
        and v_partner = public.app_partner()
        and (not public.app_has_scope() or p_branch in (select public.app_scope_branches())))
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  insert into public.branch_deed_recipient (branch_id, user_id, set_by)
  values (p_branch, p_user, auth.uid())
  on conflict (branch_id) do update set user_id = excluded.user_id, set_by = excluded.set_by, set_at = now();
end $function$;

create or replace function public.clear_branch_deed_recipient(p_branch uuid)
returns void language plpgsql security definer set search_path to '' as $function$
declare v_partner uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id into v_partner from public.branches where id = p_branch;
  if v_partner is null then raise exception 'Branch not found' using errcode = '22023'; end if;
  if not (
    public.is_admin()
    or (public.app_role() = 'management'
        and v_partner = public.app_partner()
        and (not public.app_has_scope() or p_branch in (select public.app_scope_branches())))
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  delete from public.branch_deed_recipient where branch_id = p_branch;
end $function$;

revoke all on function public.set_branch_deed_recipient(uuid, uuid) from public, anon;
revoke all on function public.clear_branch_deed_recipient(uuid) from public, anon;
grant execute on function public.set_branch_deed_recipient(uuid, uuid) to authenticated;
grant execute on function public.clear_branch_deed_recipient(uuid) to authenticated;
