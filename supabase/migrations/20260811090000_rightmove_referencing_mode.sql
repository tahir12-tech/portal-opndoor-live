-- Turn the partner API on for Rightmove.
--
-- WHY THIS IS FIRST AND ON ITS OWN.
--
-- partners.referencing_mode defaults to 'pre_referenced_screened'. No migration
-- has ever set any partner to anything else, and the create path refuses every
-- mode except 'pre_referenced_open':
--
--     if (mode !== "pre_referenced_open") -> 501 not_implemented
--
-- So POST /v1/applications currently returns 501 for every partner in the
-- database. The key authenticates, the scopes pass, the payload validates, and
-- then it refuses, which reads like a broken API rather than configuration that
-- has never been done.
--
-- This migration is therefore the thing that turns the API on, and it is kept
-- separate from the capability columns and the create-partner work so it can be
-- applied, verified and reasoned about by itself.
--
-- WHY IT IS NOT A COLUMN DEFAULT. 'pre_referenced_open' means no Opndoor
-- criteria are applied at all. That is a commercial position granted to
-- Rightmove specifically, not a property a partner should inherit by existing.
-- Every other partner stays on 'pre_referenced_screened' and continues to get
-- 501 until that mode is built, which is the correct and safe refusal: accepting
-- them would approve every applicant with no criteria, look exactly like working
-- software, and surface as a commercial problem months later.
--
-- WHY THE MATCH IS BY NAME AND NOT BY A HARDCODED ID. No migration has ever
-- inserted a partner: the rows were created by hand, so this tree does not know
-- Rightmove's id or slug. Matching on slug or name covers the plausible spellings
-- and the DO block reports exactly what it matched, so a run that hits nothing
-- says so instead of appearing to succeed.

do $$
declare r record; n int := 0;
begin
  for r in
    select id, slug, name, referencing_mode
    from public.partners
    where slug = 'rightmove'
       or slug like 'rightmove%'
       or lower(name) like '%rightmove%'
  loop
    n := n + 1;

    if r.referencing_mode = 'pre_referenced_open' then
      raise notice 'Rightmove partner "%" (slug %) is already pre_referenced_open. No change.', r.name, r.slug;
      continue;
    end if;

    update public.partners
      set referencing_mode = 'pre_referenced_open'
      where id = r.id;

    -- Recorded in the same trail as a rate or status change, so this shows up on
    -- the partner's audit history rather than being an invisible act of a
    -- migration. actor names the migration because there is no auth.uid() here.
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (r.id, 'referencing_mode', r.referencing_mode, 'pre_referenced_open',
            'system (migration 20260811090000)');

    raise notice 'Rightmove partner "%" (slug %): referencing_mode % -> pre_referenced_open. The partner API is now live for them.',
      r.name, r.slug, r.referencing_mode;
  end loop;

  if n = 0 then
    -- A warning, not an exception. On a disposable dev project there may
    -- genuinely be no Rightmove row, and failing the migration there would block
    -- every later one for no reason. On production this is the line that matters:
    -- if it appears, the API is still returning 501 to everyone.
    raise warning
      E'\n\n  NO RIGHTMOVE PARTNER MATCHED.\n\n  referencing_mode is unchanged, so POST /v1/applications still returns 501\n  for every partner. If this is production, find the partner and set it by hand:\n\n    update public.partners set referencing_mode = ''pre_referenced_open''\n     where slug = ''<their-slug>'';\n\n  and record it in partner_audit. Verify with the query in HANDOVER.md.\n';
  elsif n > 1 then
    raise warning 'Matched % partners on the Rightmove name. Check that is intended.', n;
  end if;
end $$;
