-- ===========================================================================
-- Documents: what a tenant uploads, and what the referencing provider sends.
--
-- WHAT EXISTS TODAY
-- One private bucket, `deeds`, created by migration with public=false and NO
-- storage.objects policies at all (20260703075024:56-57), so only service_role
-- touches it and every read is a signed URL with an explicit lifetime. That is
-- the pattern, and this follows it exactly rather than inventing a second one.
--
-- WHY TWO NEW BUCKETS AND NOT ONE
-- They have different owners and different retention. Applicant uploads are the
-- tenant's own documents, given to us, and a bank statement is among the most
-- sensitive things in this system. Provider reports are generated ABOUT the
-- tenant by a third party and arrive base64 in a webhook. Mixing them means one
-- retention rule for two categories, and the stricter one wins by accident.
--
-- A ROW IS THE INDEX, NOT THE FILE. The bytes live in Storage; the table records
-- what exists, what kind it is and who put it there. Anything that needs a file
-- asks for a signed URL, which is how `deeds` already works.
-- ===========================================================================

insert into storage.buckets (id, name, public)
values ('applicant-docs', 'applicant-docs', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('reference-reports', 'reference-reports', false)
on conflict (id) do nothing;

-- No storage.objects policies for either, deliberately, matching `deeds`. There
-- is no tenant-readable or staff-readable path to these bytes except a signed
-- URL minted by a function that has already decided the caller may have it.

create table if not exists public.application_documents (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,

  kind text not null check (kind in (
    -- uploaded by the applicant
    'bank_statement','proof_of_address','p60_or_pension_award','tax_return','other_upload',
    -- produced by the referencing provider and delivered to us
    'reference_report','summary_report','review_summary_report','provider_signature')),

  bucket    text not null check (bucket in ('applicant-docs','reference-reports')),
  path      text not null,
  filename  text not null,
  content_type text,
  bytes     bigint check (bytes is null or bytes >= 0),

  -- Which row of the form this belongs to, when it belongs to one. An income
  -- row can carry a bank statement and a P60; an address row carries a proof of
  -- address. Nullable because provider reports belong to the application itself.
  income_id  uuid references public.application_incomes(id) on delete cascade,
  address_id uuid references public.application_addresses(id) on delete cascade,

  -- Who put it here. A tenant upload and a provider delivery are different
  -- provenance and a single "created_by uuid" cannot express the second,
  -- because the provider is not a user.
  source text not null check (source in ('applicant','provider','staff')),
  uploaded_by uuid references public.users(id) on delete set null,

  created_at timestamptz not null default now(),

  -- The bucket has to match the kind, or a provider report ends up under the
  -- applicant's retention rule and a bank statement under the provider's.
  constraint document_bucket_matches_kind check (
    (bucket = 'applicant-docs'
       and kind in ('bank_statement','proof_of_address','p60_or_pension_award','tax_return','other_upload'))
    or
    (bucket = 'reference-reports'
       and kind in ('reference_report','summary_report','review_summary_report','provider_signature'))
  ),
  constraint document_source_matches_bucket check (
    bucket <> 'reference-reports' or source = 'provider'
  ),

  -- One object, one row. A repeated webhook delivering the same report must not
  -- create a second index entry pointing at the same bytes.
  unique (bucket, path)
);

create index if not exists application_documents_app_idx on public.application_documents (application_id, kind);

alter table public.application_documents enable row level security;

-- Staff may see that a document EXISTS on an application they can already see.
-- They cannot read the bytes from here: that needs a signed URL, minted
-- elsewhere by something that has decided they may have it. Listing and reading
-- are separate permissions and this table only grants the first.
drop policy if exists application_documents_select on public.application_documents;
create policy application_documents_select on public.application_documents
  for select to authenticated
  using (exists (select 1 from public.applications a where a.id = application_id));

comment on table public.application_documents is
  'The index of files held against an application. Bytes live in Storage in one of two private buckets with no object policies; this row says what exists and who put it there. Staff can see that a document exists on an application they can already see, and cannot read it without a signed URL.';
comment on column public.application_documents.source is
  'applicant, provider or staff. Provenance, not authorship: a provider is not a user, so uploaded_by cannot express it.';

-- ---------------------------------------------------------------------------
-- Recording a document. Service role only: every writer is an Edge Function,
-- either handling a tenant upload or unpacking a provider payload.
-- ---------------------------------------------------------------------------
create or replace function public.record_application_document(
  p_application uuid, p_kind text, p_bucket text, p_path text,
  p_filename text, p_content_type text, p_bytes bigint,
  p_source text, p_income uuid default null, p_address uuid default null
) returns public.application_documents
language plpgsql security definer set search_path to ''
as $function$
declare r public.application_documents;
begin
  insert into public.application_documents
    (application_id, kind, bucket, path, filename, content_type, bytes, source, income_id, address_id)
  values (p_application, p_kind, p_bucket, p_path, p_filename, p_content_type, p_bytes, p_source, p_income, p_address)
  on conflict (bucket, path) do update
    set filename = excluded.filename, content_type = excluded.content_type, bytes = excluded.bytes
  returning * into r;
  return r;
end $function$;

revoke all on function public.record_application_document(uuid, text, text, text, text, text, bigint, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_application_document(uuid, text, text, text, text, text, bigint, text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Retention is a decision nobody has made, so it is recorded rather than
-- assumed. These buckets will hold bank statements and credit reports, which
-- have a data protection dimension that outlives any of them being useful.
-- HANDOVER carries this as an open item.
-- ---------------------------------------------------------------------------
comment on column public.application_documents.created_at is
  'No retention policy is enforced on either bucket yet. Bank statements and credit reports accumulate indefinitely until one is set. See HANDOVER open items.';
