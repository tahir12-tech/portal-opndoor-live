// =====================================================================
// What to call the party who manages the property.
//
// A tenant reaches opndoor by three routes and the counterparty differs:
// a letting agent, a private landlord, or nobody yet. Copy that says
// "your letting agent" is wrong for the second and false for the third, and a
// tenant reads those sentences at the point of paying and at the end, which is
// exactly where being told about a party who does not exist undermines them.
//
// The answer is already collected. The application form asks "Who manages the
// property?" and stores letting_agent or private_landlord on
// application_delivery_contacts.kind, which is also the contact the deed is
// delivered to. This reads that, rather than any template guessing.
//
// The fallback is deliberately vague rather than picking one. "The contact on
// your tenancy" is true whoever it is, and true when we do not know.
// =====================================================================

export type ManagedBy = "letting_agent" | "private_landlord" | null;

/** "your letting agent", "your landlord", or a phrase that commits to neither. */
export function managedByLabel(kind: ManagedBy): string {
  if (kind === "letting_agent") return "your letting agent";
  if (kind === "private_landlord") return "your landlord";
  return "the contact on your tenancy";
}

/** Read it for an application. Never throws: unknown is a valid answer. */
export async function managedByFor(service: any, applicationId: string): Promise<ManagedBy> {
  try {
    const { data } = await service
      .from("application_delivery_contacts")
      .select("kind").eq("application_id", applicationId).maybeSingle();
    const k = data?.kind;
    return k === "letting_agent" || k === "private_landlord" ? k : null;
  } catch {
    return null;   // a copy decision must never fail a send
  }
}
