-- Restore the home branch column expected by later user-management migrations.
-- The original migration is recorded as applied, but the column is absent
-- from the testing database schema.

alter table public.users
  add column if not exists home_branch_id uuid
  references public.branches(id)
  on delete set null;

comment on column public.users.home_branch_id is
  'The branch where the user is placed. Used for user placement and branch-scoped workflows.';