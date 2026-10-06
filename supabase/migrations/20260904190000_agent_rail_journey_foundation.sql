-- Agent-rail journey foundation (referencing_mode = 'opndoor_referenced').
--
-- The staff journey view needs two things the schema did not record: the
-- referencing DECISION (and who made it), and how far a mid-way tenant has got
-- through the form. This adds both, plus the rule that a staff decision is
-- authoritative and is never overwritten by a later provider (Lettings) verdict,
-- so the not-yet-built verdict receiver inherits the rule rather than re-deciding
-- it.
--
-- All columns are additive and nullable; the supplier rail (pre_referenced_*) is
-- born at 'sent', never sits at 'referencing', and so never touches any of this.

alter table public.applications
  -- Progress only, never content: a step id from the Apply flow, or null. The
  -- CHECK keeps it a step id so nothing else can be smuggled into it.
  add column if not exists current_step text
    check (current_step is null or current_step in
           ('property','about','fee','address','income','nationality','declaration')),
  -- The referencing decision.
  add column if not exists decided_at timestamptz,
  add column if not exists decided_by_kind text check (decided_by_kind in ('staff','provider')),
  add column if not exists decline_reason text,
  -- What the Lettings provider's verdict said, recorded for the record even when a
  -- staff decision already stands and the status does not move.
  add column if not exists provider_verdict text check (provider_verdict in ('approved','declined')),
  add column if not exists provider_verdict_at timestamptz;

comment on column public.applications.current_step is
  'The agent-rail tenant''s current form step (progress only, never content): a step id from the Apply flow, or null once past the draft. Lets a scoped manager see how far a mid-way tenant has got.';
comment on column public.applications.decided_by_kind is
  'Who made the authoritative referencing decision: staff (an opndoor admin approve/decline) or provider (the Lettings verdict receiver). A staff decision is authoritative and is never overwritten by a later provider verdict.';
comment on column public.applications.provider_verdict is
  'What the Lettings provider''s verdict said, recorded for the record even when a staff decision already stands and the status does not change.';

-- ---------------------------------------------------------------------------
-- Staff Decline. The mirror of approve-application: the referencing decision is
-- opndoor''s (superadmin), not the agency''s, so is_admin only, exactly as the
-- approve path is. Only an application awaiting the decision can be declined.
-- ---------------------------------------------------------------------------
create or replace function public.decline_application(p_ref text, p_reason text default null)
returns public.applications
language plpgsql security definer set search_path to ''
as $function$
declare a public.applications; who text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not found then raise exception 'application not found'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if a.status <> 'referencing' then
    raise exception 'Only an application awaiting a decision can be declined.' using errcode = '42501';
  end if;

  update public.applications
    set status = 'declined', decided_at = now(), decided_by_kind = 'staff',
        decline_reason = nullif(btrim(coalesce(p_reason,'')), '')
    where id = a.id returning * into a;

  who := coalesce((select full_name from public.users where id = auth.uid()), 'an administrator');
  insert into public.activity_log(application_id, kind, message, actor, visibility)
  values (a.id, 'application_declined',
    'Application declined by ' || who
      || case when a.decline_reason is not null then ' (' || a.decline_reason || ')' else '' end || '.',
    who, 'business');
  return a;
end $function$;

revoke all on function public.decline_application(text, text) from public, anon;
grant execute on function public.decline_application(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The provider-verdict rule, built now so the Lettings receiver inherits it.
--
-- THE RULE: a staff decision is authoritative. A provider verdict is ALWAYS
-- recorded against the application for the record (provider_verdict + an internal
-- activity_log line), but if staff have already decided, the status stays exactly
-- as the person set it. Only when no staff decision exists does the verdict become
-- the decision, and only from the awaiting-decision state, so a late or duplicate
-- verdict can never move a live application backwards. Service-role only: this is
-- a system callback, not a user action.
-- ---------------------------------------------------------------------------
create or replace function public.record_provider_verdict(p_app uuid, p_verdict text, p_reason text default null)
returns public.applications
language plpgsql security definer set search_path to ''
as $function$
declare a public.applications;
begin
  if p_verdict not in ('approved','declined') then raise exception 'invalid verdict' using errcode = '22023'; end if;
  select * into a from public.applications where id = p_app;
  if not found then raise exception 'application not found'; end if;

  -- Always record what the provider said, whatever happens to the status.
  update public.applications
    set provider_verdict = p_verdict, provider_verdict_at = now()
    where id = a.id returning * into a;
  insert into public.activity_log(application_id, kind, message, actor, visibility)
  values (a.id, 'provider_verdict',
    'Lettings verdict received: ' || p_verdict
      || coalesce(' (' || nullif(btrim(coalesce(p_reason,'')),'') || ')', '') || '.',
    'Lettings', 'internal');

  -- Staff decided first: the verdict is on the record, the status stands.
  if a.decided_by_kind = 'staff' then
    return a;
  end if;

  -- No staff decision: the verdict becomes the decision, from awaiting only.
  if a.status = 'referencing' then
    if p_verdict = 'approved' then
      update public.applications
        set status = 'sent', decided_at = now(), decided_by_kind = 'provider'
        where id = a.id returning * into a;
    else
      update public.applications
        set status = 'declined', decided_at = now(), decided_by_kind = 'provider',
            decline_reason = nullif(btrim(coalesce(p_reason,'')), '')
        where id = a.id returning * into a;
    end if;
  end if;
  return a;
end $function$;

revoke all on function public.record_provider_verdict(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_provider_verdict(uuid, text, text) to service_role;
