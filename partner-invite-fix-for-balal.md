# Fix: "Select a valid partner for this user" after creating a new partner

## The bug

`addPartner` (src/data/partnersService.ts) is synchronous and client-only: it mints
a slug, pushes the partner into the in-memory list and localStorage, and returns —
it never writes to the database, because there is no `create_partner` RPC to call.
So the new partner appears in the dropdown but does not exist in `public.partners`,
and the invite edge function's `select id from partners where slug = ...` finds
nothing and returns "Select a valid partner for this user."

(Note: a hard reload does not help. It re-hydrates the partner list from the DB and
replaces the in-memory list, so the never-saved partner disappears from the dropdown
entirely. The only stopgap before this ships is to insert the partner into the DB by
hand; after the fix, creating it through the screen works.)

The fix has three parts: an SQL function, and a diff in two files. The partner must
be created on the server, and the create call must be awaited.

## 1. SQL — add the `create_partner` RPC

The `partners` table has slug/name/status/live_from/partner_rate/agent_rate, so this
inserts exactly those. The slug is derived server-side, atomic with the insert, so
two partners cannot race for the same slug. superadmin + AAL2 only.

```sql
create or replace function public.create_partner(
  p_name         text,
  p_status       text    default 'onboarding',
  p_live_from    date    default null,
  p_partner_rate numeric default 0.25,
  p_agent_rate   numeric default 0.10
) returns public.partners
language plpgsql security definer set search_path to ''
as $function$
declare base text; v_slug text; n int := 2; res public.partners; who text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Partner name is required' using errcode = '22023'; end if;
  if p_partner_rate is null or p_partner_rate < 0 or p_partner_rate > 1 then raise exception 'Partner commission must be between 0 and 100%%' using errcode = '22023'; end if;
  if p_agent_rate is null or p_agent_rate < 0 or p_agent_rate > 1 then raise exception 'Agent commission must be between 0 and 100%%' using errcode = '22023'; end if;
  if coalesce(p_status,'') not in ('active','onboarding','paused') then raise exception 'Invalid status' using errcode = '22023'; end if;

  -- partners_slug_valid restricts the slug to ^[a-z0-9-]+$
  base := regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g');
  base := btrim(base, '-');
  base := left(nullif(base, ''), 40);
  if base is null then base := 'partner'; end if;
  v_slug := base;
  while exists (select 1 from public.partners where slug = v_slug) loop
    v_slug := base || '-' || n::text; n := n + 1;
  end loop;

  insert into public.partners(slug, name, status, live_from, partner_rate, agent_rate)
  values (v_slug, btrim(p_name), p_status, p_live_from, p_partner_rate, p_agent_rate)
  returning * into res;

  -- Creation row so the audit trail starts at the beginning (partner_audit already
  -- exists; update_partner_settings writes it). Drop these three lines to skip it.
  who := coalesce((select full_name from public.users where id = auth.uid()), 'opndoor admin');
  insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
  values (res.id, 'created', null, format('%s (%s), %s', res.name, res.slug, res.status), who);

  return res;
end $function$;

revoke all on function public.create_partner(text, text, date, numeric, numeric) from public, anon;
grant execute on function public.create_partner(text, text, date, numeric, numeric) to authenticated;
```

## 2. src/data/partnersService.ts — make `addPartner` call the RPC (async)

Replace the whole synchronous `addPartner` function with:

```ts
export async function addPartner(input: AddPartnerInput): Promise<Partner> {
  if (SUPABASE_ENABLED) {
    const { data, error } = await sb().rpc('create_partner', {
      p_name: input.name,
      p_status: input.status ?? 'onboarding',
      p_live_from: input.since ? `${input.since}-01` : null,
      p_partner_rate: input.partnerRate ?? DEFAULT_PARTNER_RATE,
      p_agent_rate: input.agentRate ?? DEFAULT_AGENT_RATE,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('The partner was not created.');
    const rec: Partner = {
      id: row.slug,                       // Partner.id IS the slug, from the server
      name: row.name,
      status: row.status,
      since: row.live_from ? String(row.live_from).slice(0, 7) : '',
      weight: 0.08,
      users: 0,
      apps: 0,
      partnerRate: Number(row.partner_rate),
      agentRate: Number(row.agent_rate),
    };
    PARTNERS.push(rec);
    persist();
    return rec;
  }
  // Mock/demo: the previous synchronous body, unchanged.
  const base = (input.name || 'partner').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'partner';
  let id = base;
  let n = 2;
  while (getPartner(id)) { id = base + n; n++; }
  const rec: Partner = {
    id, name: input.name,
    weight: input.weight != null ? input.weight : 0.08,
    status: input.status || 'active',
    users: 0, apps: 0,
    since: input.since || new Date().toISOString().slice(0, 7),
    partnerRate: input.partnerRate != null ? input.partnerRate : DEFAULT_PARTNER_RATE,
    agentRate: input.agentRate != null ? input.agentRate : DEFAULT_AGENT_RATE,
  };
  PARTNERS.push(rec);
  persist();
  return rec;
}
```

`sb`, `SUPABASE_ENABLED`, `DEFAULT_PARTNER_RATE`, `DEFAULT_AGENT_RATE` are already
imported at the top of this file, so no new imports are needed.

## 3. src/pages/PartnerManagement/PartnerManagement.tsx — await it

The create branch now calls an async function, so await it and only toast success
once the server has created the row. Replace:

```ts
      const rec = addPartner({ name: name.trim(), since: since || undefined, status, partnerRate: pr, agentRate: ar });
      toast(`Partner "${rec.name}" created at ${Math.round(pr * 100)}% partner / ${Math.round(ar * 100)}% agent. Add users, agencies and branches under it next.`);
      setOpen(false);
      refresh();
```

with:

```ts
      addPartner({ name: name.trim(), since: since || undefined, status, partnerRate: pr, agentRate: ar })
        .then((rec) => {
          toast(`Partner "${rec.name}" created at ${Math.round(pr * 100)}% partner / ${Math.round(ar * 100)}% agent. Add users, agencies and branches under it next.`);
          setOpen(false);
          refresh();
        })
        .catch((e) => toast(e instanceof Error ? e.message : 'Could not create the partner.'));
```

(If `toast` takes a severity argument, use `toast(msg, 'error')` in the catch.)

After this, create a partner then invite a user to it and it works, and the success
toast only appears when the partner is really in the database.
