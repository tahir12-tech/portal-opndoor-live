/* =====================================================================
   StatusTimeline — the application-detail status timeline.

   Two shapes, one component:
   - No `groups` (the supplier rail): the classic horizontal Sent → Paid →
     Deed Issued strip. This path is unchanged.
   - With `groups` (the agent rail, nine stages): a phased vertical spine,
     the nine stages grouped into named bands (Onboarding / Application /
     Outcome). A separate `.jtl*` class tree, so the supplier strip above is
     never touched.

   The reached stage is "current"; earlier stages are "done"; later stages are
   "todo". A terminated (withdrawn / expired / declined) application stopped at
   `reached`: the NEXT stage renders 'terminated' (a ban glyph, never a tick).
   ===================================================================== */
import { useState } from 'react';
import { Icon } from './Icon';

export interface TimelineStep {
  label: string;
  date: string;
  note: string;
}

export interface TimelineGroup {
  label: string;
  count: number;
}

type StepState = 'done' | 'current' | 'todo' | 'terminated';

// The single source of stage state and tick logic, shared by both shapes.
function stateOf(n: number, reached: number, terminated?: boolean): StepState {
  return terminated
    ? (n <= reached ? 'done' : n === reached + 1 ? 'terminated' : 'todo')
    : (n < reached ? 'done' : n === reached ? 'current' : 'todo');
}
// A done stage always ticks. A current stage ticks too by default, UNLESS it is
// still in progress (a tenant phase that has not truly completed).
function ticksOf(state: StepState, currentInProgress?: boolean): boolean {
  return state === 'done' || (state === 'current' && !currentInProgress);
}

export function StatusTimeline({ steps, reached, terminated, currentInProgress, groups }: { steps: TimelineStep[]; reached: number; terminated?: boolean; currentInProgress?: boolean; groups?: TimelineGroup[] }) {
  if (groups && groups.length) {
    return <PhasedTimeline steps={steps} reached={reached} terminated={terminated} currentInProgress={currentInProgress} groups={groups} />;
  }
  // #105 A terminated (withdrawn / expired) application stopped after Sent without
  // paying: steps up to `reached` are done, the NEXT step renders as 'terminated'
  // (greyed, never a success tick), and later steps stay 'todo'. This makes a false
  // Paid/Deed check impossible for a pre-payment exit.
  return (
    <div className="timeline">
      {steps.map((s, i) => {
        const n = i + 1;
        const state = stateOf(n, reached, terminated);
        const showTick = ticksOf(state, currentInProgress);
        return (
          <div className={`tl-step tl-step--${state}`} key={s.label}>
            <div className="tl-step__node">
              {state === 'terminated' ? <Icon name="ban" strokeWidth={2.4} /> : showTick && <Icon name="check" strokeWidth={2.4} />}
            </div>
            <div className="tl-step__label">{s.label}</div>
            <div className="tl-step__date">{s.date}</div>
            <div className="tl-step__note">{s.note}</div>
          </div>
        );
      })}
    </div>
  );
}

// --- phased vertical spine (agent rail, nine stages) -------------------------

function chipFor(states: StepState[]): { cls: string; label: string } {
  if (states.includes('terminated')) return { cls: 'declined', label: 'Declined' };
  if (states.every((s) => s === 'done')) return { cls: 'done', label: 'Done' };
  if (states.includes('current') || states.includes('done')) return { cls: 'inprogress', label: 'In progress' };
  return { cls: 'notstarted', label: 'Not started' };
}

// The latest dated stage in a band — the date a completed band finished on.
function lastDate(rows: { step: TimelineStep }[]): string {
  let d = '';
  for (const r of rows) if (r.step.date) d = r.step.date;
  return d;
}

function PhasedTimeline({ steps, reached, terminated, currentInProgress, groups }: { steps: TimelineStep[]; reached: number; terminated?: boolean; currentInProgress?: boolean; groups: TimelineGroup[] }) {
  const total = steps.length;

  // Chunk the steps into bands by the group counts. Guard: the last band takes
  // every remaining step, so short/over counts can never drop or duplicate one.
  const bands: { label: string; rows: { step: TimelineStep; n: number; state: StepState }[] }[] = [];
  let idx = 0;
  groups.forEach((g, gi) => {
    const end = gi === groups.length - 1 ? total : Math.min(idx + g.count, total);
    const rows = [];
    for (let k = idx; k < end; k++) rows.push({ step: steps[k], n: k + 1, state: stateOf(k + 1, reached, terminated) });
    if (rows.length) bands.push({ label: g.label, rows });
    idx = end;
  });

  // Only the band holding the active stage (the current stage, or the declined
  // stop) is open; every other band collapses to a single line. The viewer can
  // expand any band on click.
  const activeN = terminated ? reached + 1 : reached;
  const defaultOpen = Math.max(0, bands.findIndex((b) => b.rows.some((r) => r.n === activeN)));
  const [open, setOpen] = useState<Set<number>>(() => new Set([defaultOpen]));
  const toggle = (i: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  return (
    <div className="jtl">
      {bands.map((band, bi) => {
        const chip = chipFor(band.rows.map((r) => r.state));
        const isOpen = open.has(bi);
        const doneDate = chip.cls === 'done' ? lastDate(band.rows) : '';
        return (
          <div className={`jtl-band jtl-band--${isOpen ? 'open' : 'closed'}`} key={band.label}>
            <button type="button" className="jtl-band__head" aria-expanded={isOpen} onClick={() => toggle(bi)}>
              <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={15} className="jtl-band__chev" />
              <span className="jtl-band__name">{band.label}</span>
              <span className={`jtl-chip jtl-chip--${chip.cls}`}>{chip.label}</span>
              {doneDate && <span className="jtl-band__date">{doneDate}</span>}
            </button>
            {isOpen && (
              <div className="jtl-band__rows">
                {band.rows.map((r, j) => {
                  const showTick = ticksOf(r.state, currentInProgress);
                  const last = j === band.rows.length - 1;
                  // A row keeps its note only when it needs the detail: the
                  // current (in-progress) stage or a declined stop.
                  const showNote = (r.state === 'current' || r.state === 'terminated') && !!r.step.note;
                  const cls = `jtl-row jtl-row--${r.state}${r.state === 'done' ? ' jtl-row--seg' : ''}${last ? ' jtl-row--last' : ''}`;
                  return (
                    <div className={cls} key={r.step.label}>
                      <div className="jtl-row__rail">
                        <div className={`jtl-node jtl-node--${r.state}`}>
                          {r.state === 'terminated' ? <Icon name="ban" strokeWidth={2.4} /> : showTick && <Icon name="check" strokeWidth={2.4} />}
                        </div>
                      </div>
                      <div className="jtl-cell">
                        <div className="jtl-top">
                          <span className="jtl-label">{r.step.label}</span>
                          {r.step.date && <span className="jtl-date">{r.step.date}</span>}
                        </div>
                        {showNote && <div className="jtl-note">{r.step.note}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
