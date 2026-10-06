-- View-as audit: every time an Opndoor staffer narrows to a partner's/agency's
-- view, it is logged (who, as whom, when). Viewing narrows an admin's already-full
-- access, so it is not an escalation; the audit is for support accountability.
create table if not exists public.view_as_audit (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.users(id) on delete set null,
  actor_name   text,
  target_kind  text not null,        -- 'partner' | 'agency'
  target_label text not null,        -- the org's display name, as the staffer saw it
  at           timestamptz not null default now()
);
alter table public.view_as_audit enable row level security;
-- Read: Opndoor staff only (support/audit). Writes go only through log_view_as.
create policy view_as_audit_read on public.view_as_audit for select using (public.is_opndoor_staff());

-- Record a view-as entry. Opndoor staff only; the actor is the caller.
create or replace function public.log_view_as(p_kind text, p_label text)
returns void language plpgsql security definer set search_path to '' as $function$
declare me uuid := auth.uid();
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_opndoor_staff() then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_kind not in ('partner', 'agency') then raise exception 'invalid target kind' using errcode = '22023'; end if;
  insert into public.view_as_audit(actor_id, actor_name, target_kind, target_label)
  values (me, coalesce((select full_name from public.users where id = me), 'an administrator'),
          p_kind, coalesce(nullif(btrim(p_label), ''), '(unnamed)'));
end $function$;

revoke all on function public.log_view_as(text, text) from public, anon;
grant execute on function public.log_view_as(text, text) to authenticated;
