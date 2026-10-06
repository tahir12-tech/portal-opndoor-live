import { useEffect } from 'react';

/** Sets the document title (used by the pre-auth pages that sit outside AppShell).
 *
 *  The suffix is a parameter because the tenant pages are not the referral
 *  portal. A page branded "guarantor application" reading "Guarantee Referral
 *  Portal" in the tab tells an applicant they are in the wrong place. */
export function useDocumentTitle(title: string, suffix = 'Guarantee Referral Portal'): void {
  useEffect(() => {
    document.title = `${title} | ${suffix}`;
  }, [title, suffix]);
}

/** The tenant side. Same hook, different product. */
export function useTenantDocumentTitle(title: string): void {
  useDocumentTitle(title, 'opndoor guarantor application');
}
