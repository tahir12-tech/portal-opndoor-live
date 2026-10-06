-- ===========================================================================
-- Does this partner refer into its OWN stock?
--
-- THE DISTINCTION. An AGENT refers tenants into properties it owns or manages:
-- the tenant moves into their property. A SUPPLIER refers on behalf of letting
-- agencies it does not own. That is a fact about the commercial relationship,
-- and it is the only thing this column is allowed to mean. It is NOT a
-- permission, NOT a capability, and NOT a count of levels in the org tree.
--
-- WHY OWNERSHIP AND NOT DEPTH. The obvious rule, "an agent has one agency, a
-- supplier has many", is wrong. A national group owns several brands, each with
-- branches, and still refers into its own stock. Depth is derived from the data
-- that exists; ownership has to be recorded because nothing else implies it.
--
-- NAMED FOR THE FACT, NOT THE AUDIENCE. The word "supplier" already means the
-- CRM and the mail provider in this repo's banned-list rule. Reusing it in the
-- schema would overload it a second time. The UI says Agent and Supplier; the
-- column says what is actually true.
--
-- ADDITIVE, AND DEFAULTED TO TODAY'S BEHAVIOUR. false is the existing shape:
-- partner -> many agencies -> branches, which is what the schema has always
-- been and what Rightmove uses. Every partner that exists keeps behaving
-- exactly as it does now, because false is what they all get.
--
-- The precedent is partners.is_house_route, added the same way with the same
-- discipline: a fact, defaulted so nothing moves, with a countable number of
-- readers.
-- ===========================================================================

alter table public.partners
  add column if not exists refers_own_stock boolean not null default false;

comment on column public.partners.refers_own_stock is
  'True when this partner refers tenants into stock it owns or manages (an agent). False when it refers on behalf of agencies it does not own (a supplier), which is the default and the original shape. Ownership only. Never a permission.';

-- The fixture agency group is the one partner that owns its stock.
update public.partners set refers_own_stock = true where slug = 'meridian-group';

-- ---------------------------------------------------------------------------
-- Prove this changed nothing for anybody already referring.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  -- Every partner that was here before is a supplier by default, so no existing
  -- referral path can have changed shape.
  select count(*) into n
    from public.partners
   where refers_own_stock and slug <> 'meridian-group';
  if n > 0 then
    raise exception 'a pre-existing partner was reclassified as an agent; this migration must not do that';
  end if;

  -- Both create paths read partners with an EXPLICIT column list. That is what
  -- makes a new column arrive invisible rather than arriving broken, so assert
  -- it rather than trusting it.
  if position('select p.partner_rate' in
        (select prosrc from pg_proc where proname = 'create_referral'
          and pronamespace = 'public'::regnamespace limit 1)) = 0 then
    raise exception 'create_referral no longer selects explicit partner columns; a new column may now reach it';
  end if;

  if exists (
    select 1 from pg_proc
     where proname in ('create_referral', 'create_referral_api')
       and pronamespace = 'public'::regnamespace
       and prosrc ilike '%from public.partners p%select *%'
  ) then
    raise exception 'a create path selects * from partners';
  end if;
end $$;
