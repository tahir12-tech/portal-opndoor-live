-- AN EMAIL IS STORED LOWERCASE.
--
-- Backlog B4. `resolveReferrer` in _shared/partnerApplications.ts looked a
-- referrer up with `.ilike("email", email)` where `email` is the request body
-- verbatim. `.ilike` takes a SQL LIKE PATTERN, so `%` and `_` reach the
-- database: a supplier could send `a%@rightmove.co.uk` and the refusal that
-- follows -- "this email address is not available as a referrer" -- answers
-- yes or no about it. A cross-partner existence oracle for other suppliers'
-- staff addresses, binary-searchable at the API's own rate limit, creating
-- nothing. The function's own comment says the refusal exists so the API
-- "cannot leak that the address is known".
--
-- The lookup wants EQUALITY, case-insensitively. Changing it to `.eq()` on a
-- lowercased key is the fix, and it is only CORRECT if the stored value is
-- lowercase too. Today every one of the 14 rows is, and nothing enforces it:
-- the column is plain text. So the equality would be incidentally right
-- rather than provably right, and would start silently missing people the
-- first time a mixed-case address was written.
--
-- A TRIGGER, NOT A CHECK. A check constraint would refuse the write and break
-- whatever path sent mixed case; normalising accepts it and makes the
-- invariant true. The identity guard already governs WHO may change an email;
-- this only governs its shape.

create or replace function public.users_email_is_lowercase()
returns trigger language plpgsql set search_path to '' as $function$
begin
  new.email := lower(btrim(new.email));
  return new;
end $function$;

drop trigger if exists users_email_is_lowercase on public.users;
create trigger users_email_is_lowercase
  before insert or update of email on public.users
  for each row execute function public.users_email_is_lowercase();

-- Existing rows already comply; stated as a write so a clean apply from zero
-- reaches the same place whatever order the seed ran in.
update public.users set email = lower(btrim(email)) where email <> lower(btrim(email));

revoke all on function public.users_email_is_lowercase() from public, anon, authenticated;
