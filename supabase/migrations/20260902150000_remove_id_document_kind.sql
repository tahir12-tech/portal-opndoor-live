-- ===========================================================================
-- Remove the id_document kind. ID check is scan-only now: a photo of a passport
-- uploaded as a file is not an identity check, so there is no upload and nothing
-- writes id_document. It was added in 20260902100000 and nothing else uses it;
-- bank_connection, added in the same migration, stays.
--
-- Any stray id_document row (none expected, the upload was only just added) is
-- re-kinded to other_upload before the check tightens, so validating the new
-- constraint cannot fail. Both live in the applicant-docs bucket, so
-- document_bucket_matches_kind still holds after the move.
-- ===========================================================================

update public.application_documents set kind = 'other_upload' where kind = 'id_document';

alter table public.application_documents drop constraint application_documents_kind_check;
alter table public.application_documents add constraint application_documents_kind_check
  check (kind in (
    -- uploaded by the applicant
    'bank_statement','proof_of_address','p60_or_pension_award','tax_return','other_upload',
    'bank_connection',
    -- produced by the referencing provider and delivered to us
    'reference_report','summary_report','review_summary_report','provider_signature'));

alter table public.application_documents drop constraint document_bucket_matches_kind;
alter table public.application_documents add constraint document_bucket_matches_kind check (
  (bucket = 'applicant-docs'
     and kind in ('bank_statement','proof_of_address','p60_or_pension_award','tax_return','other_upload','bank_connection'))
  or
  (bucket = 'reference-reports'
     and kind in ('reference_report','summary_report','review_summary_report','provider_signature'))
);
