-- A read-only mode for the rate limiter.
--
-- The partner API needs to ask "is this origin already over its failure budget"
-- BEFORE spending a SHA-256 and a database lookup on an unauthenticated request.
-- Asking with the existing bump would consume budget just by asking, so a
-- legitimate partner's traffic would count against the failure limiter and
-- reintroduce exactly the cap this is meant to remove.
--
-- p_peek defaults false, so every existing call site behaves identically. That
-- is the one case where a defaulted parameter is right rather than dangerous:
-- the default reproduces the old behaviour exactly, so an un-updated caller is
-- correct rather than silently wrong.

drop function if exists public.bump_rate_limit_state(text, int, int);

create function public.bump_rate_limit_state(
  p_key text, p_limit int, p_window_secs int, p_peek boolean default false
)
returns table (allowed boolean, limit_count int, remaining int, reset_at timestamptz)
language plpgsql security definer set search_path to ''
as $function$
declare v_hits int; v_start timestamptz;
begin
  if p_peek then
    -- Read the current window without touching it. A key that has never been
    -- seen, or whose window has expired, is allowed with a full allowance.
    select r.hits, r.window_start into v_hits, v_start
    from public.rate_limit r
    where r.key = p_key
      and r.window_start >= now() - make_interval(secs => p_window_secs);

    if not found then
      return query select true, p_limit, p_limit, now() + make_interval(secs => p_window_secs);
      return;
    end if;
  else
    insert into public.rate_limit (key, hits, window_start)
      values (p_key, 1, now())
    on conflict (key) do update set
      hits = case when public.rate_limit.window_start < now() - make_interval(secs => p_window_secs)
                  then 1 else public.rate_limit.hits + 1 end,
      window_start = case when public.rate_limit.window_start < now() - make_interval(secs => p_window_secs)
                          then now() else public.rate_limit.window_start end
    returning hits, window_start into v_hits, v_start;
  end if;

  return query select
    v_hits <= p_limit,
    p_limit,
    greatest(p_limit - v_hits, 0),
    v_start + make_interval(secs => p_window_secs);
end $function$;

revoke all on function public.bump_rate_limit_state(text, int, int, boolean) from public, anon, authenticated;
grant execute on function public.bump_rate_limit_state(text, int, int, boolean) to service_role;
