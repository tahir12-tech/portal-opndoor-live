-- Before "nobody works here without a position": the agency-group fixture
-- creates negotiator@meridian.invalid with neither a position nor a home
-- branch, and that migration refuses to place them automatically. On dev this
-- was resolved by hand. Locally we place them the way a human would: at their
-- partner's first branch. A DATA fix, not a schema one, so the clean-apply
-- schema this cluster produces is still the real one.
do $$
declare u record; v_branch uuid;
begin
  for u in
    select x.id, x.partner_id from public.users x
     where x.status = 'active'
       and x.partner_id is not null
       and not exists (select 1 from public.user_scopes s where s.user_id = x.id)
  loop
    select b.id into v_branch
      from public.branches b join public.agencies a on a.id = b.agency_id
     where a.partner_id = u.partner_id
     order by b.name limit 1;
    if v_branch is not null then
      insert into public.user_scopes (user_id, kind, branch_id) values (u.id, 'branch', v_branch);
    end if;
  end loop;
end $$;
