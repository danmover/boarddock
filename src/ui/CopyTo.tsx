// "Copy to…": this board's holder options, plug options and marked ports onto other boards. Boards of the same kind are
// ticked to start with; tick others to pick which. One undo step.
import { useEffect, useState } from 'react';
import { activeModule, edit, toast, useApp } from '../state';
import { copySettings, copyTargets, copyText, type CopyWhat } from '../model/copyto';
import type { Module } from '../model/types';
import { shortName } from '../model/links';
import { Check } from './controls';
import { Icon, I } from './icons';

export function CopyTo({ start }: { start?: Partial<CopyWhat> }) {
  const p = useApp((s) => s.project)!;
  const me = activeModule(p);
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState<CopyWhat>({ holder: true, plugs: true, marks: true, ...start });
  const { same, others } = copyTargets(p, me.id);
  const [pick, setPick] = useState<string[]>(() => same.map((m) => m.id));
  // another board picked to edit: its own kind is ticked again
  useEffect(() => { setPick(copyTargets(p, me.id).same.map((m) => m.id)); }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (p.modules.length < 2) return null;
  const on = pick.filter((id) => p.modules.some((m) => m.id === id && m.id !== me.id));
  const tick = (id: string, v: boolean) => setPick((xs) => (v ? [...xs.filter((x) => x !== id), id] : xs.filter((x) => x !== id)));
  const go = () => {
    let text = '';
    edit((q) => { text = copyText(me.board.name, copySettings(q, me.id, on, what), what); });
    toast(text);
    setOpen(false);
  };
  const row = (m: Module) => <Check key={m.id} label={<span>{shortName(m.board.name)}</span>} value={on.includes(m.id)} onChange={(v) => tick(m.id, v)} />;
  return (
    <div className="copyto">
      <button className={`btn small ghost ${open ? 'on' : ''}`} aria-expanded={open} onClick={() => setOpen((x) => !x)} title="Copy this board's settings to other boards, and pick which"><Icon d={I.copy} /> Copy to…</button>
      {open && (
        <div className="copyto-body">
          <div className="field"><span>Copy from {shortName(me.board.name)}</span></div>
          <Check label="Holder options (style, sizes, features, material, colour, release button)" value={what.holder} onChange={(v) => setWhat({ ...what, holder: v })} />
          <Check label="Plug options (cradles, caps, guards, tie anchors)" value={what.plugs} onChange={(v) => setWhat({ ...what, plugs: v })} />
          <Check label="Marked ports (a plug will be in it, or it stays empty)" value={what.marks} onChange={(v) => setWhat({ ...what, marks: v })} />
          <div className="field" style={{ marginTop: 6 }}><span>To</span></div>
          {same.length > 0 ? same.map(row) : <p className="hint" style={{ margin: 0 }}>No other {shortName(me.board.name)} on the rack: pick boards below (ports are matched by name and type).</p>}
          {others.length > 0 && <details><summary>Other boards ({others.length})</summary>{others.map(row)}</details>}
          <div className="btns" style={{ marginTop: 8 }}>
            <button className="btn small" disabled={!on.length || !(what.holder || what.plugs || what.marks)} onClick={go}>Copy to {on.length} board{on.length === 1 ? '' : 's'}</button>
            <button className="btn small ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
