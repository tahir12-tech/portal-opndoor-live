-- ===========================================================================
-- COMPLETENESS IS ASSERTED WHEN AN APPLICATION MOVES FORWARD, NOT WHEN IT
-- STOPS.
--
-- Found building the thirty-day close (20261007490000). The sweep could not
-- close three of dev's eight unfinished applications:
--
--   ERROR: Application is missing: title
--   CONTEXT: PL/pgSQL function public.assert_application_complete()
--
-- WHY. `assert_application_complete` fires BEFORE UPDATE OF status and says
-- "Drafts are exempt, and only drafts." That is the right rule for the
-- transition it was written for -- a half-filled application must not reach
-- referencing, sent, paid or deed -- but it reads the status as "is this
-- still a draft" rather than "is this application being submitted", so it
-- also guards the transitions that END one.
--
-- The result is that the emptier an application is, the harder it is to
-- close: GR-20612, which has nothing in it but an email address and has sat
-- untouched since 21 August, was the one row the system refused to tidy
-- away. It is also already reachable without the new sweep -- a tenant
-- withdrawing a half-filled application would have been refused with
-- "Application is missing: title", which is a true sentence and a useless
-- one, since they are not trying to submit it.
--
-- THE FIX IS THE RULE THE GUARD MEANT. The three terminal states are stops:
-- nothing is issued, nobody is charged, no deed is drawn. What must stay
-- impossible is reaching referencing, sent, paid or deed without the seven
-- fields, and that is untouched -- as is every validity check below it,
-- which only runs for a status that is none of these.
--
-- 'declined' is in the list for consistency rather than need: an
-- application can only be declined from referencing, which it could not
-- have reached incomplete.
-- ===========================================================================
create or replace function public.assert_application_complete()
returns trigger language plpgsql as $$
declare v_missing text := '';
begin
  -- Drafts are exempt, and so is every state that ENDS an application
  -- rather than advancing it. See the header: the guard is about
  -- submission, and an application being closed is not being submitted.
  if new.status in ('draft', 'expired', 'withdrawn', 'declined') then return new; end if;

  if coalesce(btrim(new.tenant_title), '') = '' then v_missing := v_missing || 'title, '; end if;
  if new.tenant_dob is null                     then v_missing := v_missing || 'date of birth, '; end if;
  if coalesce(btrim(new.tenant_phone), '') = '' then v_missing := v_missing || 'phone, '; end if;

  if coalesce(btrim(new.prop_addr1), '')    = '' then v_missing := v_missing || 'property address, '; end if;
  if coalesce(btrim(new.prop_city), '')     = '' then v_missing := v_missing || 'town or city, '; end if;
  if coalesce(btrim(new.prop_postcode), '') = '' then v_missing := v_missing || 'postcode, '; end if;
  if coalesce(new.monthly_rent, 0) <= 0         then v_missing := v_missing || 'monthly rent, '; end if;

  if v_missing <> '' then
    raise exception 'Application is missing: %', left(v_missing, length(v_missing) - 2)
      using errcode = '23502';
  end if;

  -- Present, but is it real? These mirror the two draft-exempt CHECKs so
  -- submission gives a readable line, not the raw constraint violation.
  if new.tenant_phone !~ '[0-9]' then
    raise exception 'Your mobile number needs to be a real phone number.' using errcode = '23514';
  end if;
  if new.prop_postcode !~* '^[a-z]{1,2}[0-9][a-z0-9]? ?[0-9][a-z]{2}$' then
    raise exception 'That property postcode is not a valid UK postcode.' using errcode = '23514';
  end if;

  return new;
end $$;
