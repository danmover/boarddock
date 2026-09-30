// The buy / print / tools checklist in one window: what to buy, what to print and the tools, each line tickable. It is
// worked out from the rack as it is now, so it follows the rack; ticks stay in the project, and a tick whose line has
// gone (a board taken off, a cable that is now another length) goes too.
import { useEffect, useMemo, useRef } from 'react';
import { setTicks as saveTicks, store, useApp } from '../state';
import { checklist, progress, pruneTicks, setTick, setTicks } from '../model/checklist';
import { Icon, I } from './icons';
import { useModalFocus } from './controls';

export function ChecklistSheet() {
  const open = useApp((s) => s.checklist);
  const p = useApp((s) => s.project);
  const res = useApp((s) => s.result);
  const building = useApp((s) => s.building);
  const sheet = useRef<HTMLDivElement>(null);
  const close = () => store.set({ checklist: false });
  useModalFocus(open, sheet, close);
  const sections = useMemo(() => (p && res && (open || p.ticks?.length) ? checklist(p, res) : null), [p, res, open]);
  // the rack changed: ticks for lines it no longer has go (not while the new build is still on its way)
  useEffect(() => {
    if (!p || !sections || building || !p.ticks?.length) return;
    const keep = pruneTicks(p.ticks, sections);
    if (keep.length !== p.ticks.length) saveTicks(keep);
  }, [p, sections, building]);
  if (!open || !p) return null;
  const ticks = p.ticks, sum = sections ? progress(sections, ticks) : null;
  return (
    <div className="sheet-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Checklist" tabIndex={-1} ref={sheet}>
        <div className="sheet-head">
          <div>
            <b>Checklist</b>
            <small>{sum ? `${sum.done} of ${sum.total} ticked. ` : ''}What to buy, what to print and the tools, for the rack as it is now. It changes as the rack does; your ticks are kept in the project.{p.built ? ' (The whole rack: Export lists only what is new.)' : ''}</small>
          </div>
          <span className="btns">
            {!!ticks?.length && <button className="btn small ghost" onClick={() => saveTicks([])}>Untick all</button>}
            <button className="iconbtn" title="Close (Esc)" onClick={close}><Icon d={I.x} /></button>
          </span>
        </div>
        <div className="sheet-body">
          {!sections && <p className="hint">{building ? 'Building the rack…' : 'The checklist is worked out once the rack is built.'}</p>}
          {sections?.map((s) => {
            const n = sum!.by[s.id];
            return (
              <div key={s.id} className="cl-section">
                <h4>{s.title} <span>{n.done} of {n.total}</span></h4>
                {s.groups.map((g) => {
                  const keys = g.lines.map((l) => l.key), all = keys.every((k) => ticks?.includes(k));
                  return (
                    <div key={g.head} className="cl-group">
                      {(s.id !== 'tools') && <label className="cl-head"><input type="checkbox" checked={all} onChange={(e) => saveTicks(setTicks(ticks, keys, e.target.checked))} aria-label={`Tick all of ${g.head}`} /><span>{g.head}</span></label>}
                      {g.lines.map((l) => {
                        const on = !!ticks?.includes(l.key);
                        return (
                          <label key={l.key} className={`cl-line ${on ? 'done' : ''}`}>
                            <input type="checkbox" checked={on} onChange={(e) => saveTicks(setTick(ticks, l.key, e.target.checked))} />
                            <span className="cl-qty">{l.qty > 1 ? `${l.qty} ×` : ''}</span>
                            <span className="cl-item">{l.item}{l.note && <small> {l.note}</small>}</span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A button that opens the checklist. */
export function ChecklistButton({ small = true }: { small?: boolean }) {
  const p = useApp((s) => s.project);
  const res = useApp((s) => s.result);
  const done = useMemo(() => (p?.ticks?.length && res ? progress(checklist(p, res), p.ticks) : null), [p, res]);
  return <button className={`btn ${small ? 'small' : ''}`} onClick={() => store.set({ checklist: true })} title="What to buy, what to print and the tools, with a tick for each: kept in the project"><Icon d={I.check} /> Checklist{done ? ` ${done.done}/${done.total}` : ''}</button>;
}
