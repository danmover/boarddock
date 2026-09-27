// Rails step: the whole rack as a tree (rails > docks > front / back slots > boards, with stacked boards nested
// under the board they sit on). Drag any board onto a slot, a rail, another board (to stack it) or the tray.
// Automatic until the first change by hand; every change is undoable.
import { useState, type ReactNode } from 'react';
import type { Access, EdgeName, Module, PanelReport, Turn } from '../model/types';
import { baseOf, ridersOf, stackMode } from '../model/holes';
import { edit, isSel, select, setActive, store, useApp } from '../state';
import { Check, Chip, Num, Pick, Section, Seg } from './controls';
import { accessCounts, MODULE_DRAG, PALETTE } from './PanelEditor';
import { addDock, addRail, appendToRail, autoArrange, duplicateModule, newRailWith, placeMount, quickLayout, removeMounts, removeRails, seat, setKind, setLever, setRail, setSlot, setStackMode, stackOn, swapSlots, turnMounts, unseat } from './panelOps';
import { turnLabel } from '../cad/dockplan';
import { mountLabels } from '../model/built';
import { Icon, I } from './icons';

const DIR_TEXT: Record<string, string> = { front: 'points up', up: 'points back', down: 'points toward you', left: 'points left', right: 'points right', wall: 'into the table' };
const EDGE_OPTS: ['auto' | EdgeName, string][] = [['auto', 'auto edge'], ['bottom', 'bottom edge'], ['top', 'top edge'], ['left', 'left edge'], ['right', 'right edge']];

export function AccessChips({ list }: { list: Access[] }) {
  const c = accessCounts(list);
  if (!list.length) return null;
  return (
    <span className="accchips" title="◉ points up · ✓ reachable · ⚠ points at the next dock · ✕ into the table">
      {c.front > 0 && <Chip status="ok">◉{c.front}</Chip>}
      {c.good - c.front > 0 && <Chip status="ok">✓{c.good - c.front}</Chip>}
      {c.side > 0 && <Chip status="warn">⚠{c.side}</Chip>}
      {c.blocked > 0 && <Chip status="bad">✕{c.blocked}</Chip>}
    </span>
  );
}

function AccessList({ list }: { list: Access[] }) {
  if (!list.length) return <p className="hint">No plugs defined on this board.</p>;
  return (
    <div className="access">
      {list.map((a, i) => (
        <div key={i} className={`acc ${a.ok}`}>
          <b className="mono">{a.ref}</b>
          <span>{a.type.replace(/_/g, ' ')}</span>
          <span className="grow">{DIR_TEXT[a.dir]}{a.ok === 'side' ? ', towards the next dock' : ''}</span>
          <i>{a.ok === 'good' ? '✓' : a.ok === 'side' ? '⚠' : '✕'}</i>
        </div>
      ))}
    </div>
  );
}

/** Drop zone for dragged boards. */
function useDrop(onDrop: (id: string) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(MODULE_DRAG)) { e.preventDefault(); e.stopPropagation(); setOver(true); } },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => { const id = e.dataTransfer.getData(MODULE_DRAG); setOver(false); if (id) { e.preventDefault(); e.stopPropagation(); onDrop(id); } },
    },
  };
}

function BoardChip({ m, color, rider, children, acc }: { m: Module; color: string; rider?: boolean; children?: ReactNode; acc?: Access[] }) {
  const p = useApp((s) => s.project)!;
  const i = p.modules.indexOf(m);
  const d = useDrop((id) => { if (id !== m.id && !stackOn(id, m.id)) store.set({ toast: 'That would put a board on top of itself.' }); });
  return (
    <div className={`rchip ${rider ? 'rider' : ''} ${p.active === i ? 'sel' : ''} ${d.over ? 'over' : ''}`} draggable {...d.props}
      onDragStart={(e) => { e.dataTransfer.setData(MODULE_DRAG, m.id); e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); }}
      onClick={(e) => { e.stopPropagation(); setActive(i); select([{ kind: 'module', id: m.id }]); }}
      title="Drag onto a slot, a rail, or another board to stack it on top">
      <i style={{ background: color }} />
      <span className="grow">{m.board.name}{rider && <small style={{ color: 'var(--subtle)', fontWeight: 400 }}> · {stackMode(p, m) === 'bolted' ? 'bolted on top' : 'printed layer'}</small>}</span>
      {acc && <AccessChips list={acc} />}
      {children}
    </div>
  );
}

export function RackBuilder() {
  const p = useApp((s) => s.project)!;
  const rep = useApp((s) => s.result?.report.panel ?? null);
  const sel = useApp((s) => s.sel);
  const P = p.panel;
  const col = (id: string) => PALETTE[Math.max(0, p.modules.findIndex((m) => m.id === id)) % PALETTE.length];
  const mod = (id: string | null) => p.modules.find((m) => m.id === id) ?? null;
  const accOf = (id: string) => rep?.modules.find((q) => q.id === id)?.access;
  const setAuto = (fn: (q: typeof P) => void) => edit((q) => { fn(q.panel); q.panel.auto = true; });
  const unplaced = p.modules.filter((m) => baseOf(p, m) === m && !rep?.modules.some((q) => q.id === m.id));
  const tray = useDrop((id) => { stackOn(id, null); unseat(id); });
  const kind = P.rowDir === 'v' ? 'cols' : P.maxRail >= 2000 ? 'row' : 'rows';
  const mountsSel = sel.filter((s) => s.kind === 'mount').map((s) => s.id);
  const one = mountsSel.length === 1 ? rep?.mounts.find((m) => m.id === mountsSel[0]) : null;
  const railSel = sel.find((s) => s.kind === 'rail');
  const railOne = railSel ? rep?.rails.find((r) => r.id === railSel.id) : null;
  const flats = rep?.mounts.filter((m) => m.kind === 'flat').length ?? 0;

  const stackRows = (m: Module) => ridersOf(p, m).map((r) => (
    <BoardChip key={r.id} m={r} color={col(r.id)} rider>
      <button className="btn small ghost icon" title="Take it off the stack" onClick={(e) => { e.stopPropagation(); stackOn(r.id, null); }}><Icon d={I.x} /></button>
    </BoardChip>
  ));

  return (
    <>
      <Section title="Layout" right={P.auto ? <Chip status="ok">automatic</Chip> : <button className="btn small soft" onClick={autoArrange}><Icon d={I.bolt} /> Auto-arrange</button>}>
        <div className="quick">
          {([['row', 'One rail', 'M4 16h40M8 16V8h8v8M20 16V8h8v8M32 16V8h8v8'], ['rows', 'Rows', 'M4 9h40M4 21h40M8 9V3h8v6M20 9V3h8v6M32 9V3h8v6M8 21v-6h8v6M20 21v-6h8v6'], ['cols', 'Columns', 'M12 2v24M32 2v24M12 4h7v6h-7M12 13h7v6h-7M32 4h7v6h-7M32 13h7v6h-7']] as const).map(([k, n, d]) => (
            <button key={k} className={P.auto && kind === k ? 'on' : ''} onClick={() => quickLayout(k)}><svg viewBox="0 0 48 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d={d} /></svg>{n}</button>
          ))}
        </div>
        {P.auto && (
          <div className="row" style={{ marginTop: 10 }}>
            {kind !== 'row' && <Num label="Longest rail" value={P.maxRail} min={60} max={1999} step={5} onChange={(v) => setAuto((q) => { q.maxRail = v; })} />}
            <Num label="Gap between docks" value={P.gap} min={0} max={40} step={0.5} onChange={(v) => setAuto((q) => { q.gap = v; })} />
          </div>
        )}
        <div style={{ marginTop: 8 }}><Check label="Two boards back to back in one dock when their plugs allow it" value={P.pairs} onChange={(v) => setAuto((q) => { q.pairs = v; })} /></div>
        <p className="hint">{P.auto ? 'Every board is turned so its plugs stay reachable and packed onto rails. Drag anything below, or in the Rails view, to take over by hand.' : 'Your own layout. Auto-arrange starts over (⌘Z undoes it).'}</p>
      </Section>

      <div className="rack">
        {(rep?.rails ?? []).map((r) => {
          const mts = rep!.mounts.filter((m) => m.rail === r.id);
          return <RailCard key={r.id} r={r} mts={mts} rep={rep!} col={col} mod={mod} accOf={accOf} stackRows={stackRows} />;
        })}
        {unplaced.length > 0 || !rep?.rails.length ? (
          <div>
            <div className="slothead" style={{ margin: '4px 2px 5px' }}>Not on a rail</div>
            <div className={`tray ${tray.over ? 'over' : ''}`} {...tray.props}>
              {unplaced.map((m) => (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 100%' }}>
                  <BoardChip m={m} color={col(m.id)}>
                    <button className="btn small" onClick={(e) => { e.stopPropagation(); seat(m.id); }}>Place</button>
                  </BoardChip>
                  {stackRows(m)}
                </div>
              ))}
              {!unplaced.length && <span className="hint" style={{ margin: 0 }}>Drop a board here to take it off the rails.</span>}
            </div>
          </div>
        ) : (
          <div className={`tray ${tray.over ? 'over' : ''}`} {...tray.props} style={{ minHeight: 32, justifyContent: 'center', alignItems: 'center' }}><span className="hint" style={{ margin: 0 }}>Drop a board here to take it off the rails</span></div>
        )}
        <div className="btns">
          <NewRail dir="h" /><NewRail dir="v" />
          {unplaced.length > 1 && <button className="btn small" onClick={() => { for (const m of unplaced) seat(m.id); }}>Place all</button>}
        </div>
      </div>

      <StackSection />
      <TableStands />

      {one && <DockInspector one={one} rep={rep!} />}
      {mountsSel.length > 1 && (
        <Section title={`${mountsSel.length} docks`} right={<button className="btn small danger" onClick={() => removeMounts(mountsSel)}>Remove</button>}>
          <div className="btns"><button className="btn small" onClick={() => turnMounts(mountsSel, -90)}>⟲ Turn all</button><button className="btn small" onClick={() => turnMounts(mountsSel, 90)}>Turn all ⟳</button><button className="btn small" onClick={() => swapSlots(mountsSel)}>Swap front / back</button></div>
        </Section>
      )}
      {railOne && (
        <Section title={`Rail ${railOne.id.replace(/^r/, '')}`} right={<button className="btn small danger" onClick={() => removeRails([railOne.id])}>Remove</button>}>
          <Seg value={railOne.dir} options={[['h', 'Horizontal ⟷'], ['v', 'Vertical ↕']]} onChange={(v) => setRail(railOne.id, (r) => { r.dir = v; })} />
          <div className="row3" style={{ marginTop: 8 }}>
            <Num label="Start X" value={Math.round(railOne.x)} step={1} onChange={(v) => setRail(railOne.id, (r) => { r.x = v; })} />
            <Num label="Start Y" value={Math.round(railOne.y)} step={1} onChange={(v) => setRail(railOne.id, (r) => { r.y = v; })} />
            <Num label="Length" value={Math.round(railOne.length)} min={30} step={5} onChange={(v) => setRail(railOne.id, (r) => { r.length = v; })} />
          </div>
          <div className="btns" style={{ marginTop: 8 }}>
            <button className="btn small" onClick={() => setRail(railOne.id, (r) => { r.length = null; })}>Cut to fit</button>
            <button className="btn small" onClick={() => addDock(railOne.id)}><Icon d={I.plus} /> Empty dock</button>
          </div>
        </Section>
      )}

      <details className="section">
        <summary style={{ cursor: 'pointer', fontWeight: 650, fontSize: 12.5 }}>Fit and spacing</summary>
        <div className="row" style={{ marginTop: 10 }}>
          <Num label="Space between rails" value={P.rowGap} min={0} max={200} step={1} onChange={(v) => setAuto((q) => { q.rowGap = v; })} />
          <Num label="Tongue fit (looser +)" value={P.fit ?? 0} min={0} max={0.4} step={0.05} hint="print the test-fit kit first" onChange={(v) => edit((q) => { q.panel.fit = v; })} />
        </div>
        {flats > 0 && (
          <div className="row" style={{ marginTop: 8 }}>
            <Num label="Flat clip width" value={p.mount.clipWidth} min={10} max={30} step={1} onChange={(v) => edit((q) => { q.mount.clipWidth = v; })} />
            <Pick label="Pull tab points" value={p.mount.tabSide} options={[['down', 'Down'], ['up', 'Up']]} onChange={(v) => edit((q) => { q.mount.tabSide = v; })} />
          </div>
        )}
        <p className="hint">TS35 × 7.5 top-hat rail, cut with a hacksaw. {rep ? `Rails to cut: ${rep.rails.map((r) => `${Math.round(r.length)} mm`).join(' + ') || 'none'}. Tallest point ${Math.round(rep.height ?? rep.depth)} mm above the ${rep.stands?.length ? 'table' : 'rail base'}.` : ''}</p>
      </details>
    </>
  );
}

/** Printed sleepers under the rails, with cable combs sized for the routed cables. */
function TableStands() {
  const on = useApp((s) => s.project?.panel.stands !== false);
  const parts = useApp((s) => s.result?.parts);
  const rep = useApp((s) => s.result?.report);
  const st = (parts ?? []).filter((x) => x.tag?.kind === 'railstand');
  const vol = st.reduce((a, x) => a + x.volume * x.qty, 0);
  const n = (k: string) => st.filter((x) => x.name.startsWith(k)).reduce((a, x) => a + x.qty, 0);
  const combs = st.filter((x) => /comb/.test(x.name)).reduce((a, x) => a + x.qty, 0);
  const sag = rep?.checks.find((c) => c.name === 'Rail sag between sleepers');
  return (
    <Section title="Table stands" right={<Chip status={on ? 'ok' : 'info'}>{on ? `${rep?.panel?.stands?.length ?? 0} sleepers` : 'off'}</Chip>}>
      <Check label="Print stands that hold the rails on a table" value={on} onChange={(v) => edit((q) => { q.panel.stands = v; })} />
      {on && st.length > 0 && (
        <>
          <div className="bigstat" style={{ marginTop: 10, gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div><b>{n('Rail end block')}</b><span>end blocks</span></div>
            <div><b>{n('Rail saddle')}</b><span>saddles</span></div>
            <div><b>{n('Stand spacer') + n('Stand foot')}</b><span>spacers, feet</span></div>
            <div><b>{combs}</b><span>cable combs</span></div>
          </div>
          <p className="hint">
            A sleeper crosses the rails at each end{rep?.panel?.stands && rep.panel.stands.length > 2 ? ' and every 200 mm or less between' : ''}. The rail ends push into end blocks, saddles carry the rails between, and spacer bars slide into the blocks' dovetails. Where a cable street crosses a sleeper its spacer gets a comb with one snap-in slot per cable, sized for it. The rails stand clear of the table, so cables can pass under them.
            {' '}{Math.round(vol / 100) / 10} cm³ in all, every piece printed on its end without supports.{sag ? ` Rail sag under a 20 N press: ${sag.value}.` : ''}
          </p>
        </>
      )}
      {!on && <p className="hint">Off: fix the rails to your own base. Cables still route between the rails.</p>}
    </Section>
  );
}

function NewRail({ dir }: { dir: 'h' | 'v' }) {
  const d = useDrop((id) => newRailWith(id, dir));
  return <button className={`btn small ${d.over ? 'soft' : ''}`} {...d.props} onClick={() => addRail(dir)} title="Add a rail (or drop a board here for a new rail with it)"><Icon d={I.plus} /> Rail {dir === 'h' ? '⟷' : '↕'}</button>;
}

function RailCard({ r, mts, rep, col, mod, accOf, stackRows }: {
  r: PanelReport['rails'][number]; mts: PanelReport['mounts']; rep: PanelReport; col: (id: string) => string; mod: (id: string | null) => Module | null;
  accOf: (id: string) => Access[] | undefined; stackRows: (m: Module) => ReactNode;
}) {
  const sel = useApp((s) => s.sel);
  const d = useDrop((id) => appendToRail(id, r.id));
  return (
    <div className={`railcard ${isSel(sel, r.id) ? 'sel' : ''} ${d.over ? 'over' : ''}`} {...d.props}>
      <header onClick={() => select([{ kind: 'rail', id: r.id }])}>
        <svg className="glyph" viewBox="0 0 26 16" fill="none" stroke="currentColor" strokeWidth="1.6">{r.dir === 'h' ? <path d="M2 6h22M2 10h22M6 6v4M20 6v4" /> : <path d="M11 1v14M15 1v14M11 4h4M11 12h4" />}</svg>
        <b>Rail {r.id.replace(/^r/, '')}</b>
        <small>{r.dir === 'h' ? 'horizontal' : 'vertical'} · {Math.round(r.length)} mm</small>
        <span className="grow" />
        <button className="btn small ghost icon" title="Empty dock on this rail" onClick={(e) => { e.stopPropagation(); addDock(r.id); }}><Icon d={I.plus} /></button>
        <button className="btn small ghost icon" title="Remove the rail (its boards go to the tray)" onClick={(e) => { e.stopPropagation(); removeRails([r.id]); }}><Icon d={I.x} /></button>
      </header>
      {mts.map((mt) => <DockRow key={mt.id} mt={mt} railDir={r.dir} rep={rep} col={col} mod={mod} accOf={accOf} stackRows={stackRows} />)}
      {!mts.length && <div className="dockrow"><span className="hint" style={{ margin: 0 }}>Empty: drop a board here.</span></div>}
    </div>
  );
}

function DockRow({ mt, railDir, rep, col, mod, accOf, stackRows }: {
  mt: PanelReport['mounts'][number]; railDir: 'h' | 'v'; rep: PanelReport; col: (id: string) => string; mod: (id: string | null) => Module | null;
  accOf: (id: string) => Access[] | undefined; stackRows: (m: Module) => ReactNode;
}) {
  const sel = useApp((s) => s.sel);
  const built = useApp((s) => s.project?.built);
  const slots = mt.kind === 'dock' ? [0, 1] : [0];
  // since the rack was built: a board that is new here (maybe in a dock that was already there)
  const fresh = !!built && mt.slots.some((sl) => sl.module && !built.boards.includes(sl.module));
  return (
    <div className={`dockrow ${isSel(sel, mt.id) ? 'sel' : ''}`}>
      <div className="dh" onClick={(e) => select([{ kind: 'mount', id: mt.id }], e.shiftKey || e.metaKey ? 'toggle' : 'set')}>
        <b>{mt.kind === 'dock' ? 'Dock' : 'Flat clip'} {mountLabels(rep).get(mt.id) ?? mt.id.replace(/^d/, '')}</b>{fresh && <span className="chip acc" title="Holds a board added since the rack was built">new board</span>}
        <span className="grow">{turnLabel(mt.turn, railDir, mt.kind)}</span>
        <button className="btn small ghost icon" title="Turn 90° (R)" onClick={(e) => { e.stopPropagation(); turnMounts([mt.id], 90); }}><Icon d={I.turn} /></button>
        {mt.kind === 'dock' && <button className="btn small ghost icon" title="Swap front and back (F)" onClick={(e) => { e.stopPropagation(); swapSlots([mt.id]); }}><Icon d={I.swap} /></button>}
        <button className="btn small ghost icon" title="Remove the dock (its boards go to the tray)" onClick={(e) => { e.stopPropagation(); removeMounts([mt.id]); }}><Icon d={I.x} /></button>
      </div>
      {slots.map((slot) => {
        const m = mod(mt.slots[slot]?.module ?? null);
        return <Slot key={slot} mountId={mt.id} slot={slot} label={mt.kind === 'flat' ? 'board' : slot ? 'back' : 'front'} m={m} edge={mt.slots[slot]?.edge ?? 'auto'} col={col} acc={m ? accOf(m.id) : undefined} stackRows={stackRows} dock={mt.kind === 'dock'} />;
      })}
    </div>
  );
}

function Slot({ mountId, slot, label, m, edge, col, acc, stackRows, dock }: { mountId: string; slot: number; label: string; m: Module | null; edge: EdgeName | 'auto'; col: (id: string) => string; acc?: Access[]; stackRows: (m: Module) => ReactNode; dock: boolean }) {
  const d = useDrop((id) => seat(id, { mount: mountId, slot }));
  return (
    <div className="slotbox">
      <span>{label}</span>
      <div className={`slotdrop ${m ? 'filled' : ''} ${d.over ? 'over' : ''}`} {...d.props}>
        {m ? (
          <>
            <BoardChip m={m} color={col(m.id)} acc={acc}>
              {dock && (
                <select value={edge} title="Board edge that plugs into the dock" onClick={(e) => e.stopPropagation()} onChange={(e) => setSlot(mountId, slot, (x) => { x.edge = e.target.value as EdgeName | 'auto'; })}>
                  {EDGE_OPTS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                </select>
              )}
              <button className="btn small ghost icon" title="Take it off the rail" onClick={(e) => { e.stopPropagation(); unseat(m.id); }}><Icon d={I.x} /></button>
            </BoardChip>
            {stackRows(m)}
          </>
        ) : <span className="none">{dock ? 'empty: drop a board here' : 'empty'}</span>}
      </div>
    </div>
  );
}

/** Stacks: which board sits on which. */
function StackSection() {
  const p = useApp((s) => s.project)!;
  if (p.modules.length < 2) return null;
  return (
    <Section title="Stacks" right={<span className="hint" style={{ margin: 0 }}>or drag a board onto another</span>}>
      <div className="list">
        {p.modules.map((m, i) => (
          <div key={m.id} className="item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
            <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="grow"><b>{m.board.name}</b></span>
            <select style={{ width: 150, height: 26, fontSize: 12 }} value={m.on ?? ''} onChange={(e) => { if (!stackOn(m.id, e.target.value || null)) store.set({ toast: 'That would put a board on top of itself.' }); }}>
              <option value="">its own dock</option>
              {p.modules.filter((x) => x !== m && baseOf(p, x) !== m).map((x) => <option key={x.id} value={x.id}>on top of {x.board.name}</option>)}
            </select>
            {m.on && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%', paddingLeft: 18 }}>
                <div style={{ flex: 1 }}><Seg value={stackMode(p, m)} options={[['bolted', 'Bolted on standoffs'], ['towers', 'Printed layer']]} onChange={(v) => setStackMode(m.id, v)} /></div>
                {stackMode(p, m) === 'bolted' && <input type="number" style={{ width: 62, height: 26 }} title="Standoff length (mm)" value={m.onGap ?? 11} step={0.5} min={2} max={40} onChange={(e) => setStackMode(m.id, 'bolted', Math.max(2, +e.target.value || 11))} />}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="hint"><b>Bolted</b>: a HAT or shield screwed to the board below on standoffs, lined up on the holes they share; those holes get no pins and room for screw heads. <b>Printed layer</b>: a separate board on its own light holder that presses onto corner towers of the one below.</p>
    </Section>
  );
}

function DockInspector({ one, rep }: { one: PanelReport['mounts'][number]; rep: PanelReport }) {
  const p = useApp((s) => s.project)!;
  const railDir = rep.rails.find((r) => r.id === one.rail)?.dir ?? 'h';
  const v = railDir === 'v';
  const side = (sgn: number) => (v ? (sgn > 0 ? 'left' : 'right') : sgn > 0 ? 'upper' : 'lower');
  return (
    <Section title={`${one.kind === 'dock' ? 'Dock' : 'Flat clip'} ${mountLabels(rep).get(one.id) ?? one.id.replace(/^d/, '')}`} right={<button className="btn small danger" onClick={() => removeMounts([one.id])}>Remove</button>}>
      <Seg value={one.kind} options={[['dock', 'Dock: stands out'], ['flat', 'Flat on the panel']]} onChange={(k) => setKind([one.id], k)} />
      <div className="turns">
        {([0, 90, 180, 270] as Turn[]).map((t) => (
          <button key={t} className={`turn ${one.turn === t ? 'on' : ''}`} onClick={() => turnMounts([one.id], t - one.turn)}>
            <svg viewBox="-12 -12 24 24"><rect x="-6" y="-7" width="12" height="14" rx="2" transform={`rotate(${-t - (v ? 90 : 0)})`} /><line x1="0" y1="0" x2="0" y2="-7" transform={`rotate(${-t - (v ? 90 : 0)})`} /></svg>
            <span>{t}°</span>
            <small>{turnLabel(t, railDir, one.kind)}</small>
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <Pick label="Rail" value={one.rail} options={rep.rails.map((r) => [r.id, `Rail ${r.id.replace(/^r/, '')} (${r.dir === 'h' ? '⟷' : '↕'})`] as [string, string])} onChange={(val) => placeMount(one.id, val, one.at)} />
        <Num label="Position on the rail" value={Math.round(one.at * 10) / 10} min={0} step={1} onChange={(val) => placeMount(one.id, one.rail, val)} />
      </div>
      {one.kind === 'dock' && (
        <div style={{ marginTop: 8 }}>
          <Pick label="Rail release lever" value={one.lever ?? 'auto'} options={[['auto', `Auto: ${side(one.leverSide)} side (more room)`], ['pos', `${side(1)} side`], ['neg', `${side(-1)} side`]]} onChange={(val) => setLever([one.id], val)} />
          <p className="hint">Boards out, then press the red lever beside the socket down and lift the dock off the rail.</p>
        </div>
      )}
      {one.slots.map((s, slot) => {
        const acc = rep.modules.find((q) => q.mount === one.id && q.slot === slot && q.id === s.module);
        if (!s.module || !acc) return null;
        return (
          <div key={slot} className="slot">
            <div className="slothead">{one.kind === 'flat' ? 'Board' : slot ? 'Back slot' : 'Front slot'} · {p.modules.find((m) => m.id === s.module)?.board.name} · {acc.edge} edge in</div>
            <AccessList list={acc.access} />
            <div className="btns" style={{ marginTop: 6 }}><button className="btn small ghost" onClick={() => duplicateModule(p.modules.findIndex((m) => m.id === s.module))}><Icon d={I.copy} /> Another like this</button></div>
          </div>
        );
      })}
    </Section>
  );
}
