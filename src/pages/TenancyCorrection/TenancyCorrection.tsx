/* =====================================================================
   Public tenancy-start correction page (#81). Reached from the tokenised link
   in the executed-deed email. The agent enters the correct tenancy start and
   submitting APPLIES it: the deed is voided and a corrected one is sent to the
   tenant to sign again. There is no opndoor review step.

   Public route (outside RequireAuth). The token is exchanged with the
   tenancy-correction Edge Function (verify_jwt off), which validates it and does
   the correction with the service role. No portal access or sign-in is required.
   ===================================================================== */
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import './TenancyCorrection.css';

type Phase = 'checking' | 'form' | 'done' | 'invalid' | 'already';

interface LoadInfo { guaranteeRef: string; currentStart: string; property: string }

export function TenancyCorrection() {
  useDocumentTitle('Tenancy start correction');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [phase, setPhase] = useState<Phase>('checking');
  const [info, setInfo] = useState<LoadInfo | null>(null);
  const [proposed, setProposed] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ newStart: string; reissued: boolean } | null>(null);

  async function call(action: 'load' | 'submit', body: Record<string, unknown> = {}) {
    const { data, error: err } = await sb().functions.invoke('tenancy-correction', { body: { action, token, ...body } });
    if (err) throw new Error('Something went wrong. Please try again.');
    return data as Record<string, unknown>;
  }

  useEffect(() => {
    if (!SUPABASE_ENABLED) {
      // Mock/demo mode: show the form with placeholder context so the page renders.
      setInfo({ guaranteeRef: 'GR-DEMO', currentStart: '01/09/2026', property: 'The property on the deed' });
      setPhase('form');
      return;
    }
    if (!token) { setPhase('invalid'); return; }
    let alive = true;
    call('load')
      .then((d) => {
        if (!alive) return;
        if (!d.ok) { setPhase(d.expired ? 'invalid' : 'invalid'); return; }
        if (d.alreadySubmitted) { setInfo({ guaranteeRef: String(d.guaranteeRef), currentStart: String(d.currentStart), property: String(d.property) }); setPhase('already'); return; }
        setInfo({ guaranteeRef: String(d.guaranteeRef), currentStart: String(d.currentStart), property: String(d.property) });
        setPhase('form');
      })
      .catch(() => { if (alive) setPhase('invalid'); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!proposed) { setError('Choose the correct tenancy start date.'); return; }
    if (busy) return;
    setBusy(true);
    try {
      if (SUPABASE_ENABLED) {
        const d = await call('submit', { proposedStart: proposed, note });
        if (!d.ok) { setError(String(d.error ?? 'Could not submit. Please try again.')); return; }
        setResult({ newStart: String(d.newStart ?? ''), reissued: !!d.reissued });
      }
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tcx">
      <div className="tcx__card">
        <div className="tcx__brand"><span className="wordmark">opndoor</span><span className="tcx__sub">Guarantee Referral Portal</span></div>

        {phase === 'checking' && <p className="tcx__muted">Checking your link…</p>}

        {phase === 'invalid' && (
          <>
            <h1 className="tcx__title">This link is not valid</h1>
            <p className="tcx__muted">The correction link may have expired or already been used. If the tenancy start date on your deed is wrong, reply to the deed email and we will help.</p>
          </>
        )}

        {phase === 'already' && info && (
          <>
            <h1 className="tcx__title">Already corrected</h1>
            <p className="tcx__muted">The tenancy start for <b>{info.guaranteeRef}</b> has already been corrected here. The reissued deed is with the tenant to sign again.</p>
          </>
        )}

        {phase === 'done' && (
          <>
            <h1 className="tcx__title">Tenancy start corrected</h1>
            {result && !result.reissued ? (
              <p className="tcx__muted">The tenancy start{result.newStart ? <> is now <b>{result.newStart}</b></> : null} has been updated.</p>
            ) : (
              <p className="tcx__muted">{result?.newStart ? <>The deed now shows a tenancy start of <b>{result.newStart}</b>. </> : null}The tenant has been sent a corrected deed to sign again. Once they sign, the corrected signed deed will be emailed to you.</p>
            )}
          </>
        )}

        {phase === 'form' && info && (
          <>
            <h1 className="tcx__title">Correct the tenancy start date</h1>
            <p className="tcx__muted">
              Deed <b>{info.guaranteeRef}</b>{info.property ? <> for {info.property}</> : null} shows a tenancy start of <b>{info.currentStart}</b>. If that is wrong, enter the correct date below. We will void the current deed and send the tenant a corrected one to sign straight away.
            </p>
            <form className="tcx__form" onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor="tcx-date">Correct tenancy start date</label>
                <input id="tcx-date" type="date" value={proposed} onChange={(e) => setProposed(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="tcx-note">Anything else we should know? <span className="hint">(optional)</span></label>
                <textarea id="tcx-note" rows={3} maxLength={500} placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              {error && <p className="tcx__error" role="alert">{error}</p>}
              <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? 'Correcting…' : 'Correct and reissue the deed'}</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
