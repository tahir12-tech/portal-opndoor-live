-- Rate limit state, so the API can tell a partner where they stand.
--
-- WHY A SECOND FUNCTION RATHER THAN CHANGING bump_rate_limit. It returns a
-- boolean and has four other call sites in payment-confirmation, which is a
-- public tokenised endpoint. Changing its return type would mean editing all of
-- them in a change about partner API headers, and a mistake there breaks the
-- tenant payment path. This one is additive: bump_rate_limit is untouched and
-- keeps working exactly as it does.
--
-- The counting is identical, deliberately reproduced rather than refactored into
-- a shared helper. Two functions doing the same arithmetic is a smaller risk than
-- one function whose signature both a payment page and a partner API depend on.

create or replace function public.bump_rate_limit_state(
  p_key text, p_limit int, p_window_secs int
)
returns table (allowed boolean, limit_count int, remaining int, reset_at timestamptz)
language plpgsql security definer set search_path to ''
as $function$
declare v_hits int; v_start timestamptz;
begin
  insert into public.rate_limit (key, hits, window_start)
    values (p_key, 1, now())
  on conflict (key) do update set
    hits = case when public.rate_limit.window_start < now() - make_interval(secs => p_window_secs)
                then 1 else public.rate_limit.hits + 1 end,
    window_start = case when public.rate_limit.window_start < now() - make_interval(secs => p_window_secs)
                        then now() else public.rate_limit.window_start end
  returning hits, window_start into v_hits, v_start;

  return query select
    v_hits <= p_limit,
    p_limit,
    -- Never negative. A caller hammering a limit they have already exceeded
    -- keeps incrementing hits, and "remaining: -47" is noise rather than
    -- information.
    greatest(p_limit - v_hits, 0),
    v_start + make_interval(secs => p_window_secs);
end $function$;

revoke all on function public.bump_rate_limit_state(text, int, int) from public, anon, authenticated;
grant execute on function public.bump_rate_limit_state(text, int, int) to service_role;

comment on function public.bump_rate_limit_state(text, int, int) is
  'Like bump_rate_limit, but returns the window state so an API can emit X-RateLimit headers. bump_rate_limit is unchanged and still used by payment-confirmation.';
