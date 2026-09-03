// =====================================================================
// application-document-url (verify_jwt = true)
//
// Returns a short-lived signed URL for one applicant document, so staff can open
// a bank statement or proof of address that the tenant uploaded. The tenant no
// longer has a Documents page; this is the staff-side view of the same files.
//
// The applicant-docs bucket is private with no object policies, exactly like
// deeds: only the service role can mint a URL. Authorisation is the user-scoped
// read first. application_documents RLS returns the row only on an application
// the caller may already see, so if the row comes back null we never sign. This
// mirrors deed-download precisely rather than inventing a second pattern.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ ok: false, error: "Not authenticated." }, 401);

    const { docId } = await req.json();
    if (!docId) return json({ ok: false, error: "Missing document id." }, 400);

    // The user-scoped read IS the authorisation. RLS returns this row only on an
    // application the caller can see; a caller who cannot gets null, not bytes.
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: doc, error } = await userClient
      .from("application_documents")
      .select("bucket, path")
      .eq("id", docId)
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 400);
    if (!doc) return json({ ok: false, error: "Document not found, or you do not have access to it." }, 404);

    const service = createClient(SUPABASE_URL, SERVICE);
    const { data: signed, error: sErr } = await service.storage.from(doc.bucket).createSignedUrl(doc.path, 300);
    if (sErr || !signed) return json({ ok: false, error: "Could not generate the download link." }, 500);
    return json({ ok: true, url: signed.signedUrl });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
