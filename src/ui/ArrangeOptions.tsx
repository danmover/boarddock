// "Auto-arrange options": one popover next to the Auto-arrange button. Every option is a weight or a constraint on the
// score the layout planner minimises (src/cad/autoplan.ts), remembered in the project (`panel.opts`). With an automatic
// layout a change lays the rack out again at once; with a layout of your own it applies at the next Auto-arrange.
import { useState } from 'react';
import type { ArrangeOpts, Project } from '../model/types';
import { stackCompanions } from '../model/probes';
import { edit, useApp } from '../state';
import { Check, Pick, Seg } from './controls';
import { packNewBoards } from './panelOps';

const GOALS: ['balanced' | 'compact' | 'cables' | 'reach', string][] = [['balanced', 'Balanced'], ['compact', 'Compact'], ['cables', 'Short cables'], ['reach', 'Easy to reach']];
const TIPS: Record<string, string> = {
  goal: 'Compact: shortest rails and smallest footprint. Short cables: least cable and fewest crossings. Easy to reach: parts you touch stay clear of neighbours.',
  probes: 'A J-Link or serial adapter docks in a column right next to the board it is cabled to, its ribbon or wires as short as they go.',
  stack: "A board's adapters and J-Links stand in one column, as many as its dock's tongue takes.",
  group: 'Alike boards (a Pi cluster) sit in a row, all turned the same way, their ports on the same side.',
  mains: 'The powerboard goes to one end or side, away from the low-voltage boards; chargers and supplies stay between it and the boards they feed.',
  hosts: 'A hub, a Pi Zero on USB and a probe stay close to their host, the more so the more cables hang off it.',
  spare: 'Keeps this many docks of free rail at the end of each rail, for boards you add later.',
  pairs: 'Two thin boards whose parts face apart share a dock back to back, when it does not lengthen the cables much.',
  stock: 'Prefers layouts where every cable fits a stock length, so none needs the next size up.',
  heat: 'Hot boards (a Pi 4, a Pi 5) are spread apart and go to the top of a standing rack.',
  fewParts: 'Fewer docks and rails when the cables cost about the same: less to print and buy.',
};

function Row({ tip, children }: { tip: string; children: React.ReactNode }) {
  return <div className="arr-row">{children}<p className="hint">{TIPS[tip]}</p></div>;
}

export function ArrangeOptions({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const unplaced = useApp((s) => s.result?.report.panel?.unplaced.length ?? 0);
  const o = project.panel.opts ?? {};
  const set = (fn: (n: ArrangeOpts, q: Project) => void) => edit((q) => { const n: ArrangeOpts = { ...(q.panel.opts ?? {}) }; fn(n, q); delete n.pick; q.panel.opts = n; });
  return (
    <span className="arropts">
      <button className={`btn small ghost ${open ? 'on' : ''}`} onClick={() => setOpen((x) => !x)} title="How Auto-arrange weighs cables, rails, reach, mains, heat and more">Options ▾</button>
      {open && (
        <div className="arr-pop floating" role="dialog" aria-label="Auto-arrange options">
          <Row tip="goal"><div className="field"><span>What matters most</span><Seg value={o.goal ?? 'balanced'} options={GOALS} onChange={(v) => set((n) => { n.goal = v; })} /></div></Row>
          <Row tip="probes"><Pick label="J-Links and adapters" value={o.probes ?? 'beside'} options={[['beside', 'Beside their board'], ['free', 'Wherever suits the cables']]} onChange={(v) => set((n) => { n.probes = v; })} /></Row>
          <Row tip="stack"><Check label="Stack the probes in one column" value={!!o.stack} onChange={(v) => set((n, q) => { n.stack = v; if (v) stackCompanions(q); })} /></Row>
          <Row tip="group"><Check label="Group like boards" value={!!o.group} onChange={(v) => set((n) => { n.group = v; })} /></Row>
          <Row tip="mains"><Pick label="Mains at" value={o.mains ?? 'auto'} options={[['auto', 'Whichever end suits'], ['left', 'The left'], ['right', 'The right'], ['bottom', 'The bottom'], ['off', 'Anywhere']]} onChange={(v) => set((n) => { n.mains = v; })} /></Row>
          <Row tip="hosts"><Check label="Hosts and their devices together" value={o.hosts !== false} onChange={(v) => set((n) => { n.hosts = v; })} /></Row>
          <Row tip="pairs"><Check label="Pair boards back to back" value={project.panel.pairs} onChange={(v) => edit((q) => { q.panel.pairs = v; delete q.panel.opts?.pick; })} /></Row>
          <Row tip="spare"><Pick label="Room to grow" value={o.spare ?? 0} options={[[0, 'None'], [1, '1 free slot per rail'], [2, '2 free slots per rail'], [3, '3 free slots per rail']]} onChange={(v) => set((n) => { n.spare = v; })} /></Row>
          <Row tip="stock"><Check label="Fit stock cable lengths" value={!!o.stock} onChange={(v) => set((n) => { n.stock = v; })} /></Row>
          <Row tip="heat"><Check label="Spread hot boards" value={!!o.heat} onChange={(v) => set((n) => { n.heat = v; })} /></Row>
          <Row tip="fewParts"><Check label="Fewest printed parts" value={!!o.fewParts} onChange={(v) => set((n) => { n.fewParts = v; })} /></Row>
          <div className="arr-foot">
            {!project.panel.auto && <button className="btn small" disabled={!unplaced} onClick={() => { packNewBoards(); setOpen(false); }} title="Place only the boards that are on no rail yet; every dock and rail already there stays where it is">Pack new boards only{unplaced ? ` (${unplaced})` : ''}</button>}
            <span className="hint">{project.panel.auto ? 'The rack is laid out again as you change these.' : 'Applies at the next Auto-arrange.'}</span>
          </div>
        </div>
      )}
    </span>
  );
}
