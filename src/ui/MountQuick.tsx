// Mounting, right where a board is picked in the 3D view: on a rack, whether it stands up or lies flat in its dock,
// which edge goes in, the dock turned or its two boards swapped; with loose holders, the DIN clip (on or off, which
// way the rail runs, which way the release tab points). Each change is one undo step; changing a rack laid out
// automatically keeps the rest where it is.
import type { EdgeName } from '../model/types';
import { edit, useApp, type SelItem } from '../state';
import { setSlot, swapSlots, turnMounts } from './panelOps';
import { Seg } from './controls';

type Edge = EdgeName | 'auto';
const EDGES: [Edge, string][] = [['auto', 'best edge'], ['bottom', 'bottom edge'], ['top', 'top edge'], ['left', 'left edge'], ['right', 'right edge']];

export function MountQuick({ item }: { item: SelItem }) {
  const p = useApp((s) => s.project)!;
  const rep = useApp((s) => s.result?.report.panel);
  if (item.kind !== 'module' && item.kind !== 'mount') return null;
  const m = item.kind === 'module' ? p.modules.find((x) => x.id === item.id) : null;
  if (m && m.board.kind === 'box' && p.layout !== 'panel') return null;

  if (p.layout === 'loose') {
    const M = p.mount, din = M.kind === 'din';
    const set = (fn: (q: typeof M) => void) => edit((q) => { fn(q.mount); q.mount.picked = true; });
    return (
      <div className="mountq">
        <span className="mq-lbl">DIN clip</span>
        <Seg value={din ? 'din' : 'none'} options={[['din', 'On a rail'], ['none', 'No clip']]} onChange={(v) => set((q) => { q.kind = v as 'din' | 'none'; })} />
        {din && <Seg value={M.mode} options={[['flat', 'Flat on the rail'], ['rack', 'Across it'], ['inline', 'Along it']]} onChange={(v) => set((q) => { q.mode = v; })} />}
        {din && M.mode === 'flat' && <button className="btn small ghost" onClick={() => set((q) => { q.rotation = (((q.rotation + 90) % 360) as typeof q.rotation); })} title="Turn the clip (the rail's direction under the board)">Turn clip ⟳</button>}
        {din && M.mode !== 'flat' && <select value={M.edge} onChange={(e) => set((q) => { q.edge = e.target.value as EdgeName; })} aria-label="Holder edge on the rail">{EDGES.slice(1).map(([k, n]) => <option key={k} value={k}>{n} on the rail</option>)}</select>}
        {din && <Seg value={M.tabSide} options={[['down', 'Tab down'], ['up', 'Tab up']]} onChange={(v) => set((q) => { q.tabSide = v; })} />}
      </div>
    );
  }

  // a rack: the dock this board is in (or the dock picked)
  const mounts = rep?.mounts ?? p.panel.mounts;
  const mt = item.kind === 'mount' ? mounts.find((x) => x.id === item.id) : mounts.find((x) => x.slots.some((s) => s.module === item.id));
  if (!mt) return m ? <div className="mountq"><span className="mq-lbl">Not on a rail yet</span><span className="hint" style={{ margin: 0 }}>drag it onto one in Rails</span></div> : null;
  const si = m ? mt.slots.findIndex((s) => s.module === m.id) : -1, slot = si >= 0 ? mt.slots[si] : null;
  const dock = mt.kind === 'dock';
  return (
    <div className="mountq">
      {slot && dock && (
        <>
          <Seg value={slot.lie ?? 'up'} options={[['up', 'Stands up'], ['flat', 'Lies flat']]} onChange={(v) => setSlot(mt.id, si, (x) => { if (v === 'flat') x.lie = 'flat'; else delete x.lie; x.edge = 'auto'; })} />
          <select value={slot.edge} onChange={(e) => setSlot(mt.id, si, (x) => { x.edge = e.target.value as Edge; })} aria-label={slot.lie ? 'Board edge with the tab that plugs into the dock' : 'Board edge that plugs into the dock'} title={slot.lie ? 'The edge with the tab that plugs into the dock' : 'The edge that plugs into the dock'}>
            {EDGES.map(([k, n]) => <option key={k} value={k}>{slot.lie ? `tab on its ${n}` : `${n} in the dock`}</option>)}
          </select>
        </>
      )}
      <button className="btn small ghost" onClick={() => turnMounts([mt.id], -90)} title="Turn the dock (Shift+R in Rails)">⟲</button>
      <button className="btn small ghost" onClick={() => turnMounts([mt.id], 90)} title="Turn the dock (R in Rails)">⟳ Turn dock</button>
      {dock && mt.slots.some((s) => s.module) && <button className="btn small ghost" onClick={() => swapSlots([mt.id])} title="Front board to the back and back to the front (F in Rails)">Swap front / back</button>}
    </div>
  );
}
