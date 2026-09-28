// Rails step: the whole rack as a tree (rails > docks > front / back slots > boards, with stacked boards nested
// under the board they sit on). Drag any board onto a slot, a rail, another board (to stack it) or the tray.
// Automatic until the first change by hand; every change is undoable.
import { useMemo, useState, type ReactNode } from 'react';
import type { Access, EdgeName, Module, PanelReport, Project, Turn } from '../model/types';
import { baseOf, ridersOf, stackAlign, stackHardware, stackMode } from '../model/holes';
import { bbox } from '../geom/poly';
import { companionLabel, isProbe, targetOf } from '../model/probes';
import { isAccessory } from '../model/links';
import { edit, isSel, select, setActive, store, toast, useApp } from '../state';
import { Check, Chip, Num, Pick, Section, Seg } from './controls';
import { accessCounts, MODULE_DRAG, PALETTE } from './PanelEditor';
import { addDock, addRail, appendToRail, autoArrange, dockShorter, makeRoom, tidyUp, duplicateModule, newRailWith, placeMount, quickLayout, removeMounts, removeRails, seat, setKind, setLever, setRail, setSlot, setStackMode, stackOn, swapSlots, turnMounts, unseat } from './panelOps';
import { shorterLever, turnLabel } from '../cad/dockplan';
import { mountLabels } from '../model/built';
import { Icon, I } from './icons';

const DIR_TEXT: Record<string, string> = { front: 'points up', up: 'points back', down: 'points toward you', left: 'points left', right: 'points right', wall: 'into the table' };
const EDGE_OPTS: ['auto' | EdgeName, string][] = [['auto', 'auto edge'], ['bottom', 'bottom edge'], ['top', 'top edge'], ['left', 'left edge'], ['right', 'right edge']];

export function AccessChips({ list }: { list: Access[] }) {
  const c = accessCounts(list);
  if (!list.length) return null;
  return (
    <span className="accchips" title="Plugs on this board: ◉ faces you, easy to reach · ✓ reachable from the side · ⚠ points at the next dock · ✕ points into the table or wall">
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
  const d = useDrop((id) => {
    if (id === m.id) return;
    const up = p.modules.find((x) => x.id === id);
    // a board goes only on one about its size, never on a hub, charger or powerboard
    if (up && !stackTargets(p, up).some((x) => x.m === m)) { toast(`${up.board.name} can't sit on ${m.board.name}: ${m.board.kind === 'box' ? 'it is a box (a hub, charger or powerboard), not a board' : isProbe(up) ? 'a probe stacks only on another probe of the same board' : isAccessory(m.board) ? 'it is an accessory, not a board to build on' : 'it is smaller'}. Drop it on a slot or a rail instead.`); return; }
    if (!stackOn(id, m.id)) store.set({ toast: 'That would put a board on top of itself.' });
  });
  return (
    <div className={`rchip ${rider ? 'rider' : ''} ${p.active === i ? 'sel' : ''} ${d.over ? 'over' : ''}`} draggable {...d.props}
      onDragStart={(e) => { e.dataTransfer.setData(MODULE_DRAG, m.id); e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); }}
      onClick={(e) => { e.stopPropagation(); setActive(i); select([{ kind: 'module', id: m.id }]); }}
      title="Drag onto a slot, a rail, or another board to stack it on top">
      <i style={{ background: color }} />
      <span className="grow" title={m.board.name}>{isProbe(m) ? companionLabel(p, m) : m.board.name}{rider && <small style={{ color: 'var(--subtle)', fontWeight: 400 }}> · {stackMode(p, m) === 'bolted' ? 'bolted on top' : 'printed layer'}</small>}</span>
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
      <Section title="Layout" right={P.auto ? <Chip status="ok">automatic</Chip> : <span className="btns" style={{ gap: 6 }}><button className="btn small ghost" onClick={tidyUp} title="Take out empty docks and slide overlapping docks apart along their rail; nothing else moves">Tidy up</button><button className="btn small soft" onClick={autoArrange} title={p.built ? 'Lay the whole rack out again: built boards move (it asks first)' : 'Lay the whole rack out again'}><Icon d={I.bolt} /> Auto-arrange</button></span>}>
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
        <div className="field" style={{ marginTop: 10 }}><span>Boards in their docks</span></div>
        <Seg value={P.lie ?? 'up'} options={[['up', 'Stand up'], ['flat', 'Lie flat'], ['auto', 'Whichever suits each']]} onChange={(v) => setAuto((q) => { q.lie = v; })} />
        <p className="hint" style={{ margin: '4px 0 0' }}>{(P.lie ?? 'up') === 'up' ? 'Standing takes the least rail.' : P.lie === 'flat' ? 'Top face up, on the same docks: a tab on one edge plugs into the socket, and its button releases it. It takes more rail but stands far less out of the wall, and headers face you.' : `Each board stands, or lies flat where that keeps its plugs clearly easier to reach.${lieNote(p, rep)}`}</p>
        <ModeCompare />
        <div style={{ marginTop: 8 }}><Check label="Two boards back to back in one dock when their plugs allow it" value={P.pairs} onChange={(v) => setAuto((q) => { q.pairs = v; })} /></div>
        <p className="hint">{P.auto ? 'Every board is turned so its plugs stay reachable and packed onto rails. Drag anything below, or in the Rails view, to take over by hand.' : `Your own layout${p.built ? ', frozen when you marked it as built' : ''}. Tidy up takes out empty docks and slides docks apart where they overlap; Auto-arrange starts over (⌘Z undoes either).`}</p>
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
        <p className="hint">DIN rail (TS35 top-hat, 35 × 7.5 mm, the metal strip from electrical cabinets), cut with a hacksaw. {rep ? `Rails to cut: ${rep.rails.map((r) => `${Math.round(r.length)} mm`).join(' + ') || 'none'}. Tallest point ${Math.round(rep.height ?? rep.depth)} mm above the ${rep.stands?.length ? 'table' : 'rail base'}.` : ''}</p>
      </details>
    </>
  );
}

/** On "Whichever suits each": which boards it laid flat, in words. */
function lieNote(p: Project, rep: PanelReport | null): string {
  if (!rep) return '';
  const flat = rep.modules.filter((q) => q.lie === 'flat').map((q) => p.modules.find((m) => m.id === q.id)?.board.name).filter(Boolean) as string[];
  if (!flat.length) return ' Here every board stands: none has its plugs clearly easier to reach lying flat.';
  if (flat.length === rep.modules.length) return ' Here every board lies flat.';
  return ` Here ${flat.length > 3 ? `${flat.length} boards lie` : `${flat.join(', ')} ${flat.length > 1 ? 'lie' : 'lies'}`} flat; the rest stand.`;
}

type ModeStats = { rails: number; len: number; depth: number; cable: number };
/** What each "Boards in their docks" choice came to, for the rack as it is otherwise (kept while you flip between them). */
const modeCache = new Map<string, Partial<Record<'up' | 'flat' | 'auto', ModeStats>>>();
const counted = new WeakSet<object>();

/** The three dock choices side by side: rails, how far the rack stands out, cable to buy (the ones worked out so far). */
function ModeCompare() {
  const p = useApp((s) => s.project)!;
  const res = useApp((s) => s.result);
  const building = useApp((s) => s.building);
  const key = useMemo(() => JSON.stringify({ ...p, active: 0, name: '', panel: { ...p.panel, lie: null } }), [p]);
  const mode = p.panel.lie ?? 'up';
  const rep = res?.report.panel;
  // (a result is counted once, when it first shows: right after a change the last one is still on screen)
  if (!building && rep && p.panel.auto && res && !counted.has(res)) {
    counted.add(res);
    const c = modeCache.get(key) ?? {};
    c[mode] = { rails: rep.rails.length, len: Math.max(0, ...rep.rails.map((r) => r.length)), depth: rep.depth, cable: (res!.report.cables ?? []).filter((x) => x.ribbon == null).reduce((a, x) => a + x.buy, 0) };
    modeCache.set(key, c);
    if (modeCache.size > 12) modeCache.delete(modeCache.keys().next().value!);
  }
  const c = modeCache.get(key) ?? {};
  if (!p.panel.auto || Object.keys(c).length < 1) return null;
  const rows: ['up' | 'flat' | 'auto', string][] = [['up', 'Stand up'], ['flat', 'Lie flat'], ['auto', 'Whichever suits']];
  return (
    <table className="modecmp">
      <thead><tr><th /><th>Rails</th><th>Stands out</th><th>Cable</th></tr></thead>
      <tbody>
        {rows.map(([k, n]) => {
          const x = c[k];
          return (
            <tr key={k} className={k === mode ? 'on' : ''}>
              <th>{n}</th>
              {x ? <><td>{x.rails} × {Math.round(x.len)} mm</td><td>{Math.round(x.depth)} mm</td><td>{Math.round(x.cable * 10) / 10} m</td></> : <td colSpan={3} className="hint">{k === mode && building ? 'working it out…' : 'pick it to compare'}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
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
        <span className="grow">{turnLabel(mt.turn, railDir, mt.kind, mt.slots[0]?.lie ?? mt.slots[1]?.lie)}</span>
        <button className="btn small ghost icon" title="Turn 90° (R)" onClick={(e) => { e.stopPropagation(); turnMounts([mt.id], 90); }}><Icon d={I.turn} /></button>
        {mt.kind === 'dock' && <button className="btn small ghost icon" title="Swap front and back (F)" onClick={(e) => { e.stopPropagation(); swapSlots([mt.id]); }}><Icon d={I.swap} /></button>}
        <button className="btn small ghost icon" title="Remove the dock (its boards go to the tray)" onClick={(e) => { e.stopPropagation(); removeMounts([mt.id]); }}><Icon d={I.x} /></button>
      </div>
      {slots.map((slot) => {
        const m = mod(mt.slots[slot]?.module ?? null);
        return <Slot key={slot} mountId={mt.id} slot={slot} label={mt.kind === 'flat' ? 'board' : slot ? 'back' : 'front'} m={m} edge={mt.slots[slot]?.edge ?? 'auto'} lie={mt.slots[slot]?.lie} col={col} acc={m ? accOf(m.id) : undefined} stackRows={stackRows} dock={mt.kind === 'dock'} railDir={railDir} turn={mt.turn} />;
      })}
    </div>
  );
}

/**
 * What Check fails for a board in the rack tree, right where it sits, with the fix when there is one: a tongue over
 * its limit gets "Dock by the X edge" (or "Lay it flat") when another way of docking keeps its lever short enough.
 */
function Problems({ m, mountId, slot, railDir, turn }: { m: Module; mountId: string; slot: number; railDir: 'h' | 'v'; turn: Turn }) {
  const checks = useApp((s) => s.result?.report.checks);
  const bad = (checks ?? []).filter((c) => c.module === m.id && c.status === 'bad');
  if (!bad.length) return null;
  const tongue = bad.some((c) => /^Tongue root/.test(c.name));
  const fix = tongue ? shorterLever(m, railDir, turn, slot) : null;
  return (
    <div className="probs" onClick={(e) => e.stopPropagation()}>
      {bad.map((c, i) => <span key={i} className="prob" title={c.detail ?? ''}><Chip status="bad">✕</Chip> {c.name}{c.value ? `: ${c.value}` : ''}</span>)}
      {fix && <button className="btn small soft" onClick={() => dockShorter(mountId, slot, fix)} title="A shorter lever onto the tongue, with no plug pointing into the table (docks along the rail slide on to make room)">{fix.lie ? `Lay it flat by its ${fix.edge} edge` : `Dock it by its ${fix.edge} edge`}</button>}
      {tongue && !fix && <small className="hint" style={{ margin: 0 }}>No other way of docking it keeps the lever short enough: hold it while you plug in, or turn the dock.</small>}
    </div>
  );
}

function Slot({ mountId, slot, label, m, edge, lie, col, acc, stackRows, dock, railDir, turn }: { mountId: string; slot: number; label: string; m: Module | null; edge: EdgeName | 'auto'; lie?: 'flat'; col: (id: string) => string; acc?: Access[]; stackRows: (m: Module) => ReactNode; dock: boolean; railDir: 'h' | 'v'; turn: Turn }) {
  const d = useDrop((id) => seat(id, { mount: mountId, slot }));
  return (
    <div className="slotbox">
      <span>{label}</span>
      <div className={`slotdrop ${m ? 'filled' : ''} ${d.over ? 'over' : ''}`} {...d.props}>
        {m ? (
          <>
            <BoardChip m={m} color={col(m.id)} acc={acc}>
              {dock && (
                <button className={`btn small ghost icon lie ${lie ? 'on' : ''}`} title={lie ? 'Lies flat on the dock (top face up, a tab on its edge in the socket): click to stand it up' : 'Stands up in the dock: click to lay it flat, top face up'} aria-pressed={!!lie}
                  onClick={(e) => { e.stopPropagation(); setSlot(mountId, slot, (x) => { if (x.lie) delete x.lie; else x.lie = 'flat'; x.edge = 'auto'; }); makeRoom(); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">{lie ? <path d="M3 14h18M5 14v-3h14v3M11 14v5h2v-5" /> : <path d="M9 3h6v14H9zM11 17v4h2v-4" />}</svg>
                </button>
              )}
              {dock && (
                <select value={edge} title={lie ? 'Board edge with the tab that plugs into the dock' : 'Board edge that plugs into the dock'} onClick={(e) => e.stopPropagation()} onChange={(e) => { setSlot(mountId, slot, (x) => { x.edge = e.target.value as EdgeName | 'auto'; }); makeRoom(); }}>
                  {EDGE_OPTS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                </select>
              )}
              <button className="btn small ghost icon" title="Take it off the rail" onClick={(e) => { e.stopPropagation(); unseat(m.id); }}><Icon d={I.x} /></button>
            </BoardChip>
            <Problems m={m} mountId={mountId} slot={slot} railDir={railDir} turn={turn} />
            {stackRows(m)}
          </>
        ) : <span className="none">{dock ? 'empty: drop a board here' : 'empty'}</span>}
      </div>
    </div>
  );
}

/**
 * The boards `m` can sit on: boards at least about its size (never a box such as a hub or a powerboard; a probe only
 * on another probe of the same board), the ones it bolts onto (two or more holes in common) first.
 */
export function stackTargets(p: Project, m: Module): { m: Module; bolts: boolean }[] {
  const area = (x: Module) => { const b = bbox(x.board.outline); return (b.x1 - b.x0) * (b.y1 - b.y0); };
  const probe = isProbe(m), mine = probe ? targetOf(p, m) : null;
  return p.modules
    .filter((x) => x !== m && baseOf(p, x) !== m && x.board.kind !== 'box')
    .filter((x) => (probe ? isProbe(x) && !!mine && targetOf(p, x) === mine : !isAccessory(x.board) && area(x) >= 0.8 * area(m)))
    .map((x) => ({ m: x, bolts: !probe && stackAlign(x.board, m.board).matched >= 2 }))
    .sort((a, b) => Number(b.bolts) - Number(a.bolts));
}

/** Stacks: which board sits on which. Lists the stacks there are, and puts a board on another. */
function StackSection() {
  const p = useApp((s) => s.project)!;
  const [pick, setPick] = useState('');
  if (p.modules.length < 2) return null;
  const stacked = p.modules.filter((m) => m.on);
  const can = p.modules.filter((m) => !m.on && m.board.kind !== 'box' && stackTargets(p, m).length);
  const who = can.find((m) => m.id === pick) ?? null;
  const put = (id: string, on: string | null) => { if (!stackOn(id, on)) store.set({ toast: 'That would put a board on top of itself.' }); };
  const label = (x: { m: Module; bolts: boolean }) => `on top of ${x.m.board.name}${x.bolts ? ' (bolts on)' : ''}`;
  return (
    <Section title="Stacks" right={<span className="hint" style={{ margin: 0 }}>or drag a board onto another</span>}>
      <div className="list">
        {stacked.map((m) => {
          const ts = stackTargets(p, m), on = p.modules.find((x) => x.id === m.on);
          const opts = on && !ts.some((x) => x.m === on) ? [{ m: on, bolts: false }, ...ts] : ts;
          return (
            <div key={m.id} className="item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
              <span className="dot" style={{ background: PALETTE[p.modules.indexOf(m) % PALETTE.length] }} />
              <span className="grow"><b>{m.board.name}</b></span>
              <select style={{ width: 170, height: 26, fontSize: 12 }} value={m.on ?? ''} aria-label={`What ${m.board.name} sits on`} onChange={(e) => put(m.id, e.target.value || null)}>
                <option value="">its own dock</option>
                {opts.map((x) => <option key={x.m.id} value={x.m.id}>{label(x)}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%', paddingLeft: 18 }}>
                <div style={{ flex: 1 }}><Seg value={stackMode(p, m)} options={[['bolted', 'Bolted on standoffs'], ['towers', 'Printed layer']]} onChange={(v) => setStackMode(m.id, v)} /></div>
                {stackMode(p, m) === 'bolted' && <input type="number" style={{ width: 62, height: 26 }} title="Standoff length (mm)" value={m.onGap ?? 11} step={0.5} min={2} max={40} onChange={(e) => setStackMode(m.id, 'bolted', Math.max(2, +e.target.value || 11))} />}
              </div>
            {(() => {
              const h = stackHardware(p, m);
              return h && <small className="hint" style={{ margin: 0, paddingLeft: 18, width: '100%' }}>{h.shared ? `Bolted on the ${h.n} holes they share: ${h.n} ${h.size} standoffs, ${h.screws} screws.` : 'No holes line up with the board below: check where the standoffs go.'}</small>;
            })()}
            </div>
          );
        })}
        {!stacked.length && <p className="hint" style={{ margin: 0 }}>Nothing is stacked yet.</p>}
      </div>
      {can.length > 0 && (
        <div className="row" style={{ marginTop: 8 }}>
          <Pick label="Put a board" value={who?.id ?? ''} options={[['', 'pick one…'], ...can.map((m) => [m.id, m.board.name] as [string, string])]} onChange={(v) => setPick(v)} />
          <Pick label="On top of" value="" options={[['', who ? 'pick one…' : 'pick a board first'], ...(who ? stackTargets(p, who).map((x) => [x.m.id, `${x.m.board.name}${x.bolts ? ' (bolts on)' : ''}`] as [string, string]) : [])]} onChange={(v) => { if (who && v) { put(who.id, v); setPick(''); } }} />
        </div>
      )}
      <p className="hint"><b>Bolted</b>: a HAT or shield screwed to the board below on standoffs, lined up on the holes they share ("bolts on": they share two or more); those holes get no pins and room for screw heads. <b>Printed layer</b>: a separate board on its own light holder that presses onto corner towers of the one below. Only boards at least as big as the one on top are offered, and never a hub, charger or powerboard.</p>
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
            <small>{turnLabel(t, railDir, one.kind, one.slots[0]?.lie ?? one.slots[1]?.lie)}</small>
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
            <div className="slothead">{one.kind === 'flat' ? 'Board' : slot ? 'Back slot' : 'Front slot'} · {p.modules.find((m) => m.id === s.module)?.board.name} · {s.lie ? `lying flat, tab on its ${acc.edge} edge` : `${acc.edge} edge in`}</div>
            {one.kind === 'dock' && <Seg value={s.lie ?? 'up'} options={[['up', 'Stands up'], ['flat', 'Lies flat']]} onChange={(v) => { setSlot(one.id, slot, (x) => { if (v === 'flat') x.lie = 'flat'; else delete x.lie; x.edge = 'auto'; }); makeRoom(); }} />}
            <AccessList list={acc.access} />
            <div className="btns" style={{ marginTop: 6 }}><button className="btn small ghost" onClick={() => duplicateModule(p.modules.findIndex((m) => m.id === s.module))}><Icon d={I.copy} /> Another like this</button></div>
          </div>
        );
      })}
    </Section>
  );
}
