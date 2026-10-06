-- WHO RECEIVES A COMMISSION STATEMENT IS OPNDOOR'S RECORD.
--
-- 20261005140000 let an Opndoor admin set the tick for anyone, and a positioned
-- manager set it for people wholly inside their own position. The second arm is
-- withdrawn: the control is admin only, on the person's row in Agencies, and
-- agency users never see or set it.
--
-- WHY THIS IS A MIGRATION AND NOT JUST A SCREEN CHANGE. The control has come
-- off Team, which is the only place an agency user could reach it. That alone
-- would leave the ruling a convention: the RPC is granted to authenticated, so
-- a manager who found the call could still move their own agency's post.
-- "Never set it" is a statement about capability, and capability lives here.
--
-- EVERYTHING ELSE IS UNCHANGED, deliberately, including the two things that are
-- easy to lose in a rewrite and that I did lose in a first draft of this file:
-- the set_config guard around the UPDATE, without which the trigger that
-- refuses direct writes refuses the RPC's own, and commission_statement_party,
-- which is where the level and the org for the audit row come from.
--
-- commission_tick_target_within_caller is now unreachable from this entry
-- point and is deliberately not dropped: if the ruling is reversed, the rule to
-- restore is a line rather than an archaeology exercise.
--
-- READING IS UNCHANGED. A manager still sees who is ticked in their own party,
-- because the column is on users and users_select already scopes itself.
-- Hiding who receives an email nobody disputes would be secrecy for its own
-- sake; what is withheld is the ability to change it.

create or replace function public.set_receives_commission_statements(p_user uuid, p_on boolean)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare
  v_target public.users;
  v_actor  text;
  v_level  text;
  v_org    uuid;
  v_org_name text;
  v_on     boolean := coalesce(p_on, false);
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into v_target from public.users where id = p_user;
  if not found then raise exception 'User not found' using errcode = '22023'; end if;

  select c.level, c.org_id, c.org_name into v_level, v_org, v_org_name
  from public.commission_statement_party(p_user) c;
  if v_level is null then
    raise exception 'This person is not attached to a group, agency or branch, so there is no commission statement for them to receive.'
      using errcode = '22023';
  end if;

  -- OPNDOOR ONLY. Was: admin, OR a positioned manager over somebody wholly
  -- inside their own position. The second arm is withdrawn. The message says
  -- why rather than 'not permitted', because this is not a privilege somebody
  -- might have been expected to hold: it is a record Opndoor keeps.
  if not public.is_admin() then
    raise exception 'Who receives a commission statement is set by Opndoor, not by the agency.'
      using errcode = '42501';
  end if;

  select full_name into v_actor from public.users where id = auth.uid();

  perform set_config('app.setting_commission_tick', 'on', true);
  update public.users set receives_commission_statements = v_on where id = p_user;
  perform set_config('app.setting_commission_tick', 'off', true);

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values (
    v_level, v_org,
    case when v_on then 'commission_statements_on' else 'commission_statements_off' end,
    coalesce(nullif(btrim(v_target.full_name), ''), v_target.email)
      || case when v_on then ' now receives ' else ' no longer receives ' end
      || coalesce(v_org_name, 'this party') || '''s monthly commission statement',
    coalesce(v_actor, 'an administrator'), auth.uid()
  );

  return v_on;
end $function$;

comment on function public.set_receives_commission_statements(uuid, boolean) is
  'Turn one person''s monthly commission statement on or off. OPNDOOR ADMIN ONLY: who is posted a statement is Opndoor''s record, not a setting an agency adjusts about itself. The positioned-manager arm was withdrawn by 20261005160000 when the control came off Team. Audited against the party whose post moved.';

revoke all on function public.set_receives_commission_statements(uuid, boolean) from public, anon;
grant execute on function public.set_receives_commission_statements(uuid, boolean) to authenticated;
