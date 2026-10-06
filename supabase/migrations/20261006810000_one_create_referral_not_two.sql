-- ONE create_referral, NOT TWO.
--
-- 20261006800000 added `p_route uuid default null`. A defaulted parameter
-- does not REPLACE a function, it OVERLOADS it: dev then carried both the
-- 14-argument form and the 15-argument one, and a caller naming the first
-- fourteen arguments binds to the old body -- the one with no route guard in
-- it at all.
--
-- Nothing was exploitable, because the old body cannot take a route and so
-- cannot misroute anything. What it could do is quietly become the live
-- definition again: two bodies for one door is how a fix stops applying,
-- and this codebase has already paid for that lesson twice today (the last
-- definition of a function is the one that counts, and `create or replace`
-- hides which that is).
--
-- Dropped here rather than by editing 20261006800000, which is applied.
--
-- Every caller keeps working. PostgREST binds by the argument NAMES supplied,
-- and a call naming only the original fourteen now binds to the surviving
-- form with p_route defaulting to null -- which resolves the route exactly as
-- it always did.

drop function if exists public.create_referral(
  uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date);
