import { billOfMaterials, bomCsv } from '../model/bom';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { zipSync, strToU8 } from 'fflate';
import type { Board, Comp, Hole, HoleRole, Module, PartOut, Project, V2 } from '../model/types';
import { applyHoleRoles, boltedOn, detectHoleRoles, ROLE_INFO, stackHardware } from '../model/holes';
import { allPlugs, baseRef, canCable, connectNote, findModule, offRackModule, powerShort, refText, cableNumbers, cablePurpose, shortName, strongerPower, times, hubOffer, KIND_COLOR, linkKind, linkOf, plugName, plugRole, plugsOf, portBudget, sameRef } from '../model/links';
import { cableLines } from '../model/cablelist';
import { addAccessory, addJLinks, addLinks, addSerialAdapters, addUartCables, plugPlaces, rebalancePower, removeLinks, setLink } from './linkOps';
import { adapterFor, debugHeaders, isDebugPort, isProbe, isUartPort, markDebug, ribbonOf, uartHeaders, uartPins, type DebugKind } from '../model/probes';
import { Icon, I } from './icons';
import { CONNECTORS, DEFAULT_FEATURES, HOLDER_PRESETS, MATERIALS, PRINTERS, connById, connSetup, setLayout } from '../model/library';
import { holdOf } from '../cad/grip';
import { inUse, portUses, USE_TEXT } from '../model/portuse';
import { printerByName, printSettings } from '../model/printers';
import { TEMPLATES } from '../model/templates';
import { ACCEPT } from '../import';
import { openRevision } from './importFlow';
import { bbox, compRect, roundedRectLoop, round, uid } from '../geom/poly';
import { activeModule, closeProject, dropModule, edit, editMod, isSel, rememberPrinter, select, setActive, store, toast, useApp, type SelItem, type Step } from '../state';
import { kindName, rackCount, rackName, sameKind } from '../model/diff';
import { Check, Chip, Num, Pick, Section, Seg, Text, download, safeName } from './controls';
import { BRIM_OUT, EDGE_CLEAR, MIN_SPACING, estimate, fitsBed, packPlates, placedMesh, write3mf, writeStl } from '../cad/export';
import { buildTestKit, runClipFea } from '../worker/client';
import type { ClipFeaResult } from '../fea/clipfea';
import { clipDims } from '../cad/dinclip';
import { RackBuilder } from './RackBuilder';
import { dockShorterAll, duplicateModule, leverFix, markBuilt, unmarkBuilt } from './panelOps';
import { removeItems } from './pickOps';
import { delta, partsFor, strapBoxes, type Delta } from '../model/built';
import { baseOf as stackBase, ridersOf } from '../model/holes';
import { DockFeaSection } from './DockFea';
import { mainsBudget, mainsText, powerBudget, powerText } from '../model/power';
import { netSpread } from '../model/netlength';
import { poeBudget, poeText, takesPoe, canFitPoe, poeHats } from '../model/poe';
import { copyHolder } from '../model/copyto';
import { CopyTo } from './CopyTo';
import { ChecklistButton } from './Checklist';
import { saveBoard } from '../model/myboards';
import { ackNote, collapseChecks, summarizeChecks, verdictOf, type CheckRow } from '../model/checkSummary';
import { boardSig, tileUrl, useKeptPicture } from './pics';
import { CompPic } from './Toolbox';
import { BoxEditor } from './BoxEditor';
import { RotateBox } from './RotateBox';
import { turnParts } from './rotateOps';
import { BoardCheck } from './BoardCheck';
import { needOf } from '../model/powerdata';
import { picture } from './snapshot';
import { boardPicture, holderPicture, type PicPart } from '../worker/client';
import { GcodeSection, useGcode } from './GcodeSection';
import { PrintCheckSection } from './PrintCheck';
import { say } from './touch';

// ============================================================================================ IMPORT
export function ImportPanel() {
  const hasProject = useApp((s) => !!s.project);
  const replaceMode = useApp((s) => s.replaceMode);
  const view = useApp((s) => s.view);
  if (!hasProject) return (
    <div className="howto">
      {/* on a phone the four steps fold away under the library, which is what you came for */}
      <details className="howto-steps" open={!window.matchMedia?.('(max-width: 860px)').matches}>
      <summary>How it works, in four steps</summary>
      <ol className="steps4">
        <li><b>Bring your boards in</b><span>Drop their design files, pick them from the library, or draw one: in the middle of the window.</span></li>
        <li><b>Check each board</b><span>Its plugs, holes and tall parts, in the board editor with a toolbox of parts.</span></li>
        <li><b>Cables and rails</b><span>Auto-connect wires them up; every board docks on a DIN rail with its plugs reachable.</span></li>
        <li><b>Print and build</b><span>Plates to print, cables to buy, and the assembly step by step.</span></li>
      </ol>
      </details>
      <p className="hint"><b>You need</b> a 3D printer and a length of DIN rail (TS35 top-hat: the 35 mm metal strip from electrical cabinets, a few dollars a metre, cut with a hacksaw), or pick <b>Loose holders</b> in the Rails step and skip the rail.</p>
      <p className="hint"><span className="nophone">Press <kbd>?</kbd> any time for the keyboard shortcuts. </span>Files never leave your computer.</p>
    </div>
  );
  return (
    <div>
      <RackSummary />
      {view !== 'library' && <button className="btn soft" style={{ width: '100%', marginBottom: 10 }} onClick={() => store.set({ view: 'library' })}><Icon d={I.plus} /> Add boards from the library</button>}
      <div className="section" style={{ padding: '10px 12px' }}>
        <Check label="What I add replaces the board being edited" value={replaceMode} onChange={(v) => store.set({ replaceMode: v })} />
        <p className="hint" style={{ margin: '6px 0 0' }}>Off: new boards join the rack ({replaceMode ? 'on now: the next one swaps in for ' + activeModule(store.get().project!).board.name : 'into a free dock slot or spot when it is laid out'}).</p>
      </div>
      <div className="btns" style={{ marginTop: 12 }}><button className="btn danger small" onClick={() => { if (confirm('Close this project? Save it first (⌘S): unsaved changes are kept only in this browser until you start a new one.')) closeProject(); }}>Close project</button></div>
    </div>
  );
}

/** "3 × Raspberry Pi 4B, Pico and 2 × USB hub": boards of a kind counted, not listed one by one. */
export function countKinds(p: Project): string {
  const n = new Map<string, number>();
  for (const m of p.modules) { const k = kindName(p, m.board.name); n.set(k, (n.get(k) ?? 0) + 1); }
  const xs = [...n].map(([k, c]) => (c > 1 ? `${c} × ${k}` : k));
  return xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '';
}

/** Coming back to a rack: what is in it, whether it is built, and the two ways on. */
function RackSummary() {
  const p = useApp((s) => s.project)!;
  const [name, setName] = useState(p.name ?? '');
  useEffect(() => setName(p.name ?? ''), [p.name]);
  const saveName = () => { if (name.trim() !== (p.name ?? '')) edit((q) => { if (name.trim()) q.name = name.trim(); else delete q.name; }); };
  const res = useApp((s) => s.result);
  const d = res ? delta(p, res) : null;
  const rails = res?.report.panel?.rails.length ?? 0;
  const sum = summarizeChecks(p, res?.report);
  const nl = (p.links ?? []).length, bad = sum.failing.length, warn = sum.nLook;
  const plugs = p.modules.reduce((a, m) => a + m.board.comps.filter((c) => c.conn).length, 0);
  const when = p.built ? new Date(p.built.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : null;
  const s = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  // where the rack is up to: each row goes to its step
  const rows: { step: Step; label: string; state: string; done: boolean; tone?: 'warn' }[] = [
    { step: 'board', label: 'Boards', state: `${rackCount(p)}, ${s(plugs, 'plug')}`, done: p.modules.length > 0 },
    { step: 'plugs', label: 'Cables', state: nl ? s(nl, 'cable') : 'none wired yet', done: nl > 0 },
    { step: 'mount', label: 'Rails', state: p.layout === 'panel' ? (rails ? `on ${s(rails, 'rail')}` : 'laying out…') : 'loose holders', done: p.layout !== 'panel' || rails > 0 },
    { step: 'check', label: 'Check', state: bad ? `${bad} failing${warn ? `, ${warn} to look at` : ''}` : warn ? `${warn} to look at` : 'nothing to look at', done: !bad && !warn, tone: bad || warn ? 'warn' : undefined },
    { step: 'export', label: 'Print', state: p.built ? (d?.any ? `What's new: ${s(d.plan.length, 'step')}, ${s(d.parts.reduce((a, x) => a + x.qty, 0), 'part')} to print` : `built ${when}`) : 'not printed yet', done: !!p.built && !d?.any },
  ];
  return (
    <div className="section rackcard">
      <div className="rackcard-head">
        <input className="rackname" value={name} placeholder={rackName({ ...p, name: undefined })} aria-label="Rack name" title="Name this rack: files are saved under it"
          onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <span className={`chip ${p.built ? 'acc' : ''}`}>{p.built ? `built ${when}` : 'not built yet'}</span>
      </div>
      <ol className="rackprog">
        {rows.map((r) => (
          <li key={r.step}>
            <button onClick={() => store.set({ step: r.step, ...(r.step === 'board' ? { view: 'editor' as const } : { view: 'assembly' as const }) })} title={`Go to ${r.label}`}>
              <i className={r.done ? 'ok' : r.tone ?? ''} aria-hidden>{r.done ? '✓' : ''}</i>
              <b>{r.label}</b>
              <span>{r.state}</span>
              <Icon d={I.right} />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

const thumbCache = new Map<string, Board>();
/** A small top view of a template: outline, holes, parts, and the connectors picked out. */
/** A 3D picture of a template board (rendered once, then kept); the sketch below shows until it is ready. */
function usePicture(key: string, make: () => Promise<PicPart[]>, w?: number, h?: number, view?: [number, number, number]): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    picture(key, make, w, h, view).then((u) => live && setUrl(u)).catch(() => {});
    return () => { live = false; };
  }, [key]);
  return url;
}

const tileFailed = new Set<string>();

export function BoardThumb({ id }: { id: string }) {
  // the picture shipped with the app, rendered ahead of time from the template's 3D model as it is now (tiles.json);
  // a live render only if there is none
  const shipped = tileUrl(id);
  const [live, setLive] = useState(() => !shipped || tileFailed.has(id));
  if (!live) return <img className="thumb pic" src={shipped!} alt="" draggable={false} decoding="async" onError={() => { tileFailed.add(id); setLive(true); }} />;
  return <LiveThumb id={id} />;
}

function LiveThumb({ id }: { id: string }) {
  let b = thumbCache.get(id);
  if (!b) { b = TEMPLATES.find((t) => t.id === id)!.make(); thumbCache.set(id, b); }
  const board = b;
  const pic = usePicture(`board:${id}:${boardSig(board)}`, () => boardPicture(board), 280, 180, [0.5, -1, 0.8]);
  if (pic) return <img className="thumb pic" src={pic} alt="" draggable={false} />;
  return <BoardSketch b={b} />;
}

function BoardSketch({ b }: { b: Board }) {
  const bb = bbox(b.outline), pad = 3, w = bb.x1 - bb.x0 + 2 * pad, h = bb.y1 - bb.y0 + 2 * pad;
  const tx = (x: number) => x - bb.x0 + pad, ty = (y: number) => bb.y1 - y + pad;
  const path = (l: V2[]) => 'M' + l.map((q) => `${tx(q[0]).toFixed(1)},${ty(q[1]).toFixed(1)}`).join('L') + 'Z';
  const box = b.kind === 'box';
  return (
    <svg className="thumb" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMinYMid meet" aria-hidden>
      <path d={path(b.outline)} className={box ? 'th-box' : 'th-pcb'} style={box && b.color ? { fill: b.color } : undefined} />
      {!box && b.comps.filter((c) => !c.conn && c.h >= 1).map((c) => <path key={c.id} d={path(compRect(c))} className="th-part" />)}
      {b.comps.filter((c) => c.conn).map((c) => (c.conn!.entry === 'top' && box
        ? <rect key={c.id} x={tx(c.x) - 3} y={ty(c.y) - 1.2} width={6} height={2.4} rx={0.6} className="th-port" />
        : <path key={c.id} d={path(compRect(c))} className={box ? 'th-port' : 'th-conn'} />))}
      {b.holes.map((q) => <circle key={q.id} cx={tx(q.x)} cy={ty(q.y)} r={Math.max(0.9, q.d / 2)} className="th-hole" />)}
    </svg>
  );
}

const DEBUG_KINDS: [DebugKind, string][] = [['swd10', '10-pin, 1.27 mm (Cortex)'], ['cortex20', '20-pin, 1.27 mm (Cortex + trace)'], ['jtag20', '20-pin, 2.54 mm (JTAG)'], ['tagconnect', 'Tag-Connect pads'], ['pins', 'Pins for jumper wires (SWD)']];

/**
 * Copy this board's holder (style, sizes, features, material, colour, release button) to the boards of the same
 * kind or to every board. The label text and the clearances under the board stay each board's own.
 */
function CopyHolder() {
  const p = useApp((s) => s.project)!;
  if (p.modules.length < 2) return null;
  const me = activeModule(p), H = me.holder;
  const kin = sameKind(p, me.board.name);
  const copy = (ids: string[], what: string) => {
    edit((q) => {
      for (const m of q.modules) if (ids.includes(m.id) && m.id !== me.id) {
        copyHolder(H, m.holder);
      }
    });
    toast(`Copied the holder of ${me.board.name} to ${what}: style, sizes, features, material and colour. ⌘Z undoes it.`);
  };
  return (
    <div className="copyholder">
      <span>Copy these settings to</span>
      {kin.length > 1 && kin.length < p.modules.length && <button className="btn small ghost" onClick={() => copy(kin.map((m) => m.id), `the other ${kin.length - 1} ${kindName(p, me.board.name)}${kin.length > 2 ? 's' : ''}`)}><Icon d={I.copy} /> every {shortName(kindName(p, me.board.name))} ({kin.length})</button>}
      <button className="btn small ghost" onClick={() => copy(p.modules.map((m) => m.id), `all ${p.modules.length - 1} other boards`)}><Icon d={I.copy} /> every board ({p.modules.length})</button>
      <CopyTo start={{ plugs: false, marks: false }} />
    </div>
  );
}

// ============================================================================================ BOARD
/** Row with a checkbox: click the row to select just it, the box (or Shift/Cmd-click) to add or remove it. */
function SelRow({ it, children }: { it: SelItem; children: ReactNode }) {
  const sel = useApp((s) => s.sel);
  const on = isSel(sel, it.id);
  return (
    <div className={`item ${on ? 'sel' : ''}`} onClick={(e) => select([it], e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'set')}>
      <input type="checkbox" className="rowcheck" checked={on} onClick={(e) => e.stopPropagation()} onChange={() => select([it], 'toggle')} />
      {children}
    </div>
  );
}

function AllBox({ items, label }: { items: SelItem[]; label?: string }) {
  const sel = useApp((s) => s.sel);
  const n = items.filter((i) => isSel(sel, i.id)).length;
  return (
    <label className="allbox" title="Select all">
      <input type="checkbox" checked={n > 0 && n === items.length} ref={(el) => { if (el) el.indeterminate = n > 0 && n < items.length; }}
        onChange={() => (n === items.length ? select(sel.filter((s) => !items.some((i) => i.id === s.id))) : select(items, 'add'))} />
      {label ?? 'All'}
    </label>
  );
}

type BTab = 'sel' | 'parts' | 'holes' | 'headers' | 'board' | 'box';

/**
 * The Board step: a card with the board (its picture, name, size, what it is) and tabs for what is on it: the parts
 * and plugs, the holes, the debug and UART headers, the board itself; the selection's own tab while something is
 * picked in the editor.
 */
export function BoardPanel() {
  const p = useApp((s) => s.project)!;
  const sel = useApp((s) => s.sel);
  const m = activeModule(p), b = m.board;
  const box = b.kind === 'box';
  const [tab, setTab] = useState<BTab>(box ? 'box' : 'parts');
  const back = useRef<BTab>(tab);
  const picked = sel.filter((x) => x.kind === 'comp' || x.kind === 'hole').length;
  useEffect(() => {
    if (picked && tab !== 'sel') { back.current = tab; setTab('sel'); }
    else if (!picked && tab === 'sel') setTab(back.current);
  }, [picked]);
  // another board: the same tab when it has one (Headers, Holes), else its first
  useEffect(() => {
    const t = back.current, has = t === 'board' || (box ? t === 'box' : t === 'parts' || t === 'holes') || (t === 'headers' && debugHeaders(b).length + uartHeaders(b).length > 0);
    const next = has ? t : box ? 'box' : 'parts';
    setTab(next); back.current = next;
  }, [m.id]);
  const nHeaders = debugHeaders(b).length + uartHeaders(b).length;
  const shown = b.comps.filter((c) => !c.hidden);
  const tabs: [BTab, string, number | null][] = [
    ...(picked ? [['sel', 'Selected', picked] as [BTab, string, number]] : []),
    ...(box ? [['box', 'Box', null] as [BTab, string, null]] : [['parts', 'Parts', shown.length] as [BTab, string, number], ['holes', 'Holes', b.holes.length] as [BTab, string, number]]),
    ...(nHeaders ? [['headers', 'Headers', nHeaders] as [BTab, string, number]] : []),
    ['board', box ? 'Details' : 'Board', null],
  ];
  return (
    <div className="bpanel">
      <ModulePicker />
      <BoardCard />
      <BoardCheck />
      <div className="ptabs" role="tablist">
        {tabs.map(([k, n, c]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); if (k !== 'sel') back.current = k; }}>{n}{c != null && <small>{c}</small>}</button>)}
      </div>
      <div className="ptab-body">
        {tab === 'sel' && <Inspector />}
        {tab === 'parts' && <PartsTab />}
        {tab === 'holes' && <><HoleWizard /><HolePatterns /></>}
        {tab === 'headers' && <DebugProbes />}
        {tab === 'box' && <BoxEditor />}
        {tab === 'board' && <BoardTab />}
      </div>
    </div>
  );
}

/** The board: its picture (redrawn as you edit), name, size, what it is, and what to do with it. */
function BoardCard() {
  const p = useApp((s) => s.project)!;
  const view = useApp((s) => s.view);
  const m = activeModule(p), b = m.board;
  const bb = bbox(b.outline);
  const ref = useRef(b);
  ref.current = b;
  const pic = useKeptPicture(`card:${m.id}:${boardSig(b)}`, () => boardPicture(ref.current), 320, 190, [0.5, -1, 0.85]);
  const plugs = b.comps.filter((c) => c.conn && !c.hidden).length, tall = b.comps.filter((c) => !c.hidden && !c.conn && c.h >= 5).length;
  const box = b.kind === 'box';
  return (
    <div className="bcard">
      <div className="bcard-pic">{pic ? <img src={pic} alt="" draggable={false} /> : <div className="bcard-ph" />}</div>
      <input className="bcard-name" value={b.name} onChange={(e) => editMod((q) => { q.board.name = e.target.value; })} aria-label="Board name" />
      <div className="bcard-facts mono">
        <span>{round(bb.x1 - bb.x0, 1)} × {round(bb.y1 - bb.y0, 1)} mm</span>
        <span>{round(b.thickness, 1)} {box ? 'tall' : 'thick'}</span>
        {!box && <span>{b.holes.length} hole{b.holes.length === 1 ? '' : 's'}</span>}
        <span>{plugs} plug{plugs === 1 ? '' : 's'}</span>
        {!box && tall > 0 && <span>{tall} tall</span>}
      </div>
      <p className="bcard-src">{b.role === 'probe' ? 'A debug probe' : b.role === 'adapter' ? 'A USB-serial adapter' : box ? 'A box' : 'A board'} · {b.source}</p>
      <div className="bcard-acts">
        {view !== 'editor' ? <button className="btn small primary" onClick={() => store.set({ view: 'editor' })}><Icon d={I.board} /> Open the editor</button> : <button className="btn small" onClick={() => store.set({ view: 'assembly' })}><Icon d={I.cube} /> In 3D</button>}
        <button className="btn small" onClick={() => { const ok = saveBoard(b); toast(ok ? `Saved ${b.name} to My boards: the library lists it for any rack.` : 'This browser would not store it (private window, or storage full).'); }} title="Keep this board to add again to any rack">Save to My boards</button>
        {!box && <NewVersionButton moduleId={m.id} small />}
        {p.modules.length > 1 && <button className="btn small" onClick={() => store.set({ addSheet: true, replaceMode: true })} title="Pick another board from the library (or its files) to take this one's place: its dock, stack, holder settings and the cables to plugs it also has stay">Replace with…</button>}
        {(() => {
          // several of the same board (a cluster's Pis): name them all at once, node1, node2...
          const kind = (x: typeof m) => kindName(p, (x.original ?? x.board).name.replace(/ #\d+$/, ''));
          const kin = p.modules.filter((x) => kind(x) === kind(m));
          return kin.length > 1 && <button className="btn small ghost" title={`Give all ${kin.length} of these boards names with a number (node1, node2…), in the order they are on the rack`} onClick={() => {
            const pre = prompt(`Name all ${kin.length} ${kind(m)} boards as… (a number is added: node1, node2…)`, 'node')?.trim();
            if (!pre) return;
            edit((q) => { kin.forEach((k, i) => { const x = q.modules.find((y) => y.id === k.id); if (x) x.board.name = `${pre}${i + 1}`; }); });
            toast(`Named them ${pre}1 to ${pre}${kin.length}. ⌘Z undoes it.`);
          }}>Name all {kin.length}…</button>;
        })()}
        {p.modules.length > 1 && <button className="btn small ghost" onClick={() => removeItems([{ kind: 'module', id: m.id }])} title="Take this board out of the rack (Undo brings it back)"><Icon d={I.trash} /> Remove</button>}
      </div>
      {b.notes.some((n) => !b.ack?.includes(n)) && <div className="warns">{b.notes.filter((n) => !b.ack?.includes(n)).map((n, i) => (
        <div key={i}>{n} <button className="linkbtn" title="Tick it off once you've done it" onClick={() => edit((q) => ackNote(q, [m.id], n))}>Done</button></div>
      ))}</div>}
    </div>
  );
}

const PART_FILTERS: [string, string, (c: Comp) => boolean][] = [
  ['key', 'That matter', (c) => !!c.conn || c.h >= 5 || c.side === 'bottom' || c.kind === 'hot' || c.kind === 'antenna'],
  ['plugs', 'Plugs', (c) => !!c.conn],
  ['tall', 'Tall', (c) => !c.conn && c.h >= 5],
  ['under', 'Underneath', (c) => c.side === 'bottom'],
  ['all', 'All', () => true],
];

/** What is on the board: its plugs and parts, each with a picture, grouped, found by name. */
function PartsTab() {
  const p = useApp((s) => s.project)!;
  const b = activeModule(p).board;
  const [f, setF] = useState('key');
  const [q, setQ] = useState('');
  const test = PART_FILTERS.find((x) => x[0] === f)![2];
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = b.comps.filter((c) => !c.hidden && test(c) && words.every((w) => `${c.ref} ${c.pkg} ${c.value ?? ''} ${c.conn ? plugName(c.conn.type) : ''}`.toLowerCase().includes(w)));
  const hidden = b.comps.filter((c) => c.hidden).length;
  const groups: [string, Comp[]][] = [['Plugs on the edges', list.filter((c) => c.conn?.entry === 'edge')], ['Plugged from above', list.filter((c) => c.conn?.entry === 'top')], ['Tall parts', list.filter((c) => !c.conn && c.h >= 5)], ['Other parts', list.filter((c) => !c.conn && c.h < 5)]];
  return (
    <>
      <div className="ptools">
        <input type="search" placeholder="Find a part (J1, USB, relay…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a part" />
        <div className="chips">{PART_FILTERS.map(([k, n, t]) => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{n} <small>{b.comps.filter((c) => !c.hidden && t(c)).length}</small></button>)}</div>
      </div>
      {groups.filter(([, cs]) => cs.length).map(([g, cs]) => (
        <div key={g} className="pgroup">
          <h5>{g} <small>{cs.length}</small></h5>
          <div className="plist">
            {cs.slice(0, 200).map((c) => <PartRow key={c.id} c={c} box={b.kind === 'box'} />)}
          </div>
        </div>
      ))}
      {!list.length && <p className="hint">{b.comps.length ? 'Nothing here with that filter.' : 'No parts yet.'} Put plugs, headers and tall parts on it from the toolbox in the editor.</p>}
      <div className="btns" style={{ marginTop: 10 }}>
        <button className="btn small soft" onClick={() => store.set({ view: 'editor' })}><Icon d={I.toolbox} /> Add from the toolbox</button>
        {hidden > 0 && <button className="btn small ghost" onClick={() => editMod((q2) => { q2.board.comps.forEach((c) => { c.hidden = false; }); })}>Show {hidden} hidden</button>}
      </div>
    </>
  );
}

function PartRow({ c, box }: { c: Comp; box: boolean }) {
  const sel = useApp((s) => s.sel);
  const on = isSel(sel, c.id);
  const dir = c.conn?.entry === 'edge' ? ['right', 'top', 'left', 'bottom'][Math.round(((((c.conn.angle % 360) + 360) % 360)) / 90) % 4] : null;
  return (
    <button className={`prow ${on ? 'on' : ''}`} onClick={(e) => { select([{ kind: 'comp', id: c.id }], e.shiftKey || e.metaKey ? 'toggle' : 'set'); if (store.get().view !== 'editor') store.set({ view: 'editor' }); }}>
      <span className="prow-pic"><CompPic c={c} box={box} /></span>
      <span className="prow-txt">
        <b>{c.ref}{c.value ? <em> {c.value}</em> : null}</b>
        <small>{c.conn ? plugName(c.conn.type) : c.pkg}{dir ? `, ${dir} edge` : ''}</small>
      </span>
      <span className="prow-meta mono">{round(c.h, 1)} mm{c.side === 'bottom' ? ' ↓' : ''}{isDebugPort(c) ? ' · debug' : isUartPort(c) ? ' · UART' : ''}</span>
    </button>
  );
}

/** Four holes at once, the way boards give them: at the corners, or a spacing across and up. */
function HolePatterns() {
  const p = useApp((s) => s.project)!;
  const b = activeModule(p).board;
  const bb = bbox(b.outline), W = bb.x1 - bb.x0, H = bb.y1 - bb.y0;
  const [mode, setMode] = useState<'corners' | 'spacing'>('corners');
  const [inset, setInset] = useState(3.5), [d, setD] = useState(3.2), [sx, setSx] = useState(Math.max(1, round(W - 7, 1))), [sy, setSy] = useState(Math.max(1, round(H - 7, 1)));
  const pts: V2[] = mode === 'corners' ? [[bb.x0 + inset, bb.y0 + inset], [bb.x1 - inset, bb.y0 + inset], [bb.x0 + inset, bb.y1 - inset], [bb.x1 - inset, bb.y1 - inset]]
    : [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, y]) => [(bb.x0 + bb.x1) / 2 + (x * sx) / 2, (bb.y0 + bb.y1) / 2 + (y * sy) / 2] as V2);
  return (
    <Section title="Add four holes">
      <Seg value={mode} options={[['corners', 'At the corners'], ['spacing', 'By spacing']]} onChange={setMode} />
      {mode === 'corners' ? <div className="row" style={{ marginTop: 6 }}><Num label="In from each edge" value={inset} onChange={setInset} step={0.5} /><Num label="Hole Ø" value={d} min={1} onChange={setD} step={0.1} /></div>
        : <div className="row3" style={{ marginTop: 6 }}><Num label="Apart across" value={sx} onChange={setSx} step={0.5} /><Num label="Apart up" value={sy} onChange={setSy} step={0.5} /><Num label="Hole Ø" value={d} min={1} onChange={setD} step={0.1} /></div>}
      <div className="btns" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => editMod((q) => { for (const [x, y] of pts) q.board.holes.push({ id: uid('h'), x: round(x, 2), y: round(y, 2), d, plated: true, use: 'auto', role: 'mount', why: 'added by hand' }); })}><Icon d={I.plus} /> Add them</button>
        <span className="hint" style={{ margin: 0 }}>Single holes: from the toolbox (M2 to M4), anywhere.</span>
      </div>
    </Section>
  );
}

/** The board itself: its shape and thickness, what it is, how much power it takes, tidying an import. */
function BoardTab() {
  const p = useApp((s) => s.project)!;
  const b = activeModule(p).board;
  const box = b.kind === 'box';
  return (
    <>
      <Section title="What it is">
        {box ? <p className="hint" style={{ margin: 0 }}>A box: its size and ports are under Box.</p> : (
          <>
            <Pick label="It is" value={b.role ?? 'board'} options={[['board', 'a board'], ['probe', 'a debug probe (J-Link…)'], ['adapter', 'a USB-serial adapter']]} onChange={(v) => editMod((q) => { q.board.role = v === 'board' ? undefined : (v as 'probe' | 'adapter'); })} />
            <p className="hint" style={{ margin: '6px 0 0' }}>{b.role === 'probe' ? 'Give it its debug connector (the one its ribbon plugs into) and its USB. It is docked like any board: on its long edge, in a column beside the board it serves.' : b.role === 'adapter' ? 'Give it its pins (named, for the jumper wires) and its USB. It is docked like any board: on its long edge, in a column beside the board it serves.' : 'A board you build a holder for. Mark a debug probe or an adapter you drew yourself as one, and it stands in a column beside the board it serves.'}</p>
          </>
        )}
      </Section>
      {!box && (
        <Section title="Shape and thickness">
          <div className="row"><Num label="Thickness" value={b.thickness} min={0.3} max={4} step={0.1} onChange={(v) => editMod((q) => { q.board.thickness = v; })} /></div>
          <div style={{ marginTop: 8 }}><ReshapeOutline b={b} /></div>
        </Section>
      )}
      {!box && !b.role && <Section title="Power"><PowerDraw /><Revision /></Section>}
      {!box && <CleanUp />}
    </>
  );
}

/**
 * A board's debug headers (a J-Link for each, one press) and UART headers (a USB-serial cable to the nearest free USB
 * port, one press).
 */
function DebugProbes() {
  const p = useApp((s) => s.project)!;
  const cables = useApp((s) => s.result?.report.cables);
  const m = activeModule(p);
  const heads = debugHeaders(m.board), uarts = uartHeaders(m.board);
  if (!heads.length && !uarts.length) return null;
  const other = (c: Comp) => { const l = linkOf(p, { module: m.id, ref: c.ref }); const o = l && (l.a.module === m.id ? l.b : l.a); return o ? { m: findModule(p, o.module), ref: o.ref, link: l.id } : null; };
  const freeDbg = heads.filter((c) => !other(c)), freeUart = uarts.filter((c) => !other(c));
  const kindOf = (x: Module) => x.board.name.replace(/\s*\(.*\)$/, '');
  const row = (c: Comp, chip: ReactNode, extra?: ReactNode) => (
    <SelRow key={c.id} it={{ kind: 'comp', id: c.id }}>
      <span className="grow"><b>{c.ref}</b> <small>{isUartPort(c) ? 'UART' : plugName(c.conn!.type)}</small></span>
      {extra}
      {chip}
    </SelRow>
  );
  // a probe's ribbon length, set where the "too short" note shows up
  const ribbon = (o: NonNullable<ReturnType<typeof other>>) => {
    const pm = o.m!, len = ribbonOf(pm.board), run = cables?.find((x) => x.id === o.link && x.ribbon != null)?.length;
    return (
      <span className="ribbon" onClick={(e) => e.stopPropagation()} title={run != null ? `Its ribbon has to run about ${Math.round(run)} mm` : 'How long its ribbon is'}>
        {run != null && run > len && <Chip status="warn">needs ~{Math.round(run)}</Chip>}
        <input type="number" aria-label={`${kindOf(pm)} ribbon length (mm)`} value={len} step={10} min={50} max={1000}
          onChange={(e) => { const v = Math.max(50, Math.min(1000, +e.target.value || 200)); edit((q) => { const x = q.modules.find((y) => y.id === pm.id); if (!x) return; if (x.board.box) x.board.box.ribbon = v; else x.board.ribbon = v; }); }} />
        <small>mm</small>
      </span>
    );
  };
  return (
    <Section title={`${heads.length ? 'Debug' : ''}${heads.length && uarts.length ? ' & ' : ''}${uarts.length ? 'UART' : ''} headers · ${heads.length + uarts.length}`}>
      <div className="list">
        {heads.map((c) => { const o = other(c); return o?.m ? row(c, <Chip status="ok">{kindOf(o.m)}</Chip>, isProbe(o.m) ? ribbon(o) : undefined) : row(c, <button className="btn small soft" onClick={(e) => { e.stopPropagation(); addJLinks(m.id, [c.ref]); }} title={`A J-Link on ${c.ref}, cabled to it, behind this board`}><Icon d={I.plus} /> J-Link</button>); })}
        {uarts.map((c) => { const o = other(c); return o?.m ? row(c, <Chip status="ok">{shortName(kindOf(o.m))} {isProbe(o.m) ? '' : refText(o.m, o.ref)}</Chip>) : row(c, <button className="btn small soft" onClick={(e) => { e.stopPropagation(); addSerialAdapters(m.id, [c.ref]); }} title={`A USB-serial adapter on ${c.ref}, with jumper wires, behind this board`}><Icon d={I.plus} /> Adapter</button>); })}
      </div>
      {uarts.map((c) => <UartPins key={c.id} c={c} many={uarts.length > 1} />)}
      {(freeDbg.length > 1 || freeUart.length > 0) && (
        <div className="btns" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          {freeDbg.length > 1 && <button className="btn small soft" onClick={() => addJLinks(m.id)}>Add {freeDbg.length} J-Links</button>}
          {freeUart.length > 1 && <button className="btn small soft" onClick={() => addSerialAdapters(m.id)} title="The FT232RL board: jumper wires from its pins to the header">Add {freeUart.length} USB-serial adapters</button>}
          {freeUart.length > 0 && <button className="btn small ghost" onClick={() => addUartCables(m.id)} title="A USB to TTL cable with loose jumper ends, straight to a hub">or {freeUart.length > 1 ? 'serial cables' : 'a serial cable'}</button>}
        </div>
      )}
      <p className="hint">{heads.length > 0 && 'Each J-Link is a board of its own: it stands on its long edge in a column beside this board, with its other J-Links and adapters, each holder on pegs on the one below; its ribbon goes to its header, and its USB to a hub (Auto-connect). The number by it is its ribbon\'s length: set yours. '}{uarts.length > 0 && 'A USB-serial adapter (the little FT232RL board) stands in the same column, with jumper wires from its pins to the header: GND to GND, its TXD to the board\'s RX, its RXD to the board\'s TX. (Or a serial cable with loose ends, straight to a hub.) '}Found by shape (2 × 5 at 1.27 mm) or name (SWD, JTAG, debug, UART, serial, TX/RX); mark others by selecting them and choosing <b>Debug / UART</b>.</p>
    </Section>
  );
}

/** Which pins of a UART header the serial cable's loose ends go on: from its nets, a guess, or set here. */
function UartPins({ c, many }: { c: Comp; many: boolean }) {
  const u = uartPins(c);
  if (!u) return null;
  const opts = u.pins.map((q) => [q.n, `${q.n}${q.net ? ` · ${q.net.replace(/^\//, '')}` : ''}`] as [string, string]);
  const set = (key: 'gnd' | 'rx' | 'tx', v: string) => editMod((mm) => {
    const cc = mm.board.comps.find((x) => x.id === c.id), cur = cc && uartPins(cc);
    if (cc && cur) cc.uart = { gnd: cur.gnd.n, rx: cur.rx.n, tx: cur.tx.n, [key]: v };
  });
  return (
    <div style={{ marginTop: 8 }}>
      <div className="row">
        <Pick label={`${many ? `${c.ref} ` : ''}GND pin`} value={u.gnd.n} options={opts} onChange={(v) => set('gnd', v)} />
        <Pick label="Board's RX" value={u.rx.n} options={opts} onChange={(v) => set('rx', v)} />
        <Pick label="Board's TX" value={u.tx.n} options={opts} onChange={(v) => set('tx', v)} />
      </div>
      <p className="hint">{u.from === 'nets' ? 'From the nets in your file. ' : u.from === 'guess' ? "A guess from its size: check the board's markings. " : ''}The cable's black end goes on GND, its green (TX) on the board's RX, its white (RX) on the board's TX.</p>
    </div>
  );
}

function ReshapeOutline({ b }: { b: Board }) {
  const bb = bbox(b.outline);
  const [w, setW] = useState(round(bb.x1 - bb.x0, 2)), [h, setH] = useState(round(bb.y1 - bb.y0, 2)), [r, setR] = useState(2);
  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>Replace the outline with a rectangle (for hand-drawn boards). Holes and parts keep their positions.</p>
      <div className="row3"><Num label="Width" value={w} onChange={setW} min={5} /><Num label="Height" value={h} onChange={setH} min={5} /><Num label="Radius" value={r} onChange={setR} min={0} /></div>
      <div className="btns" style={{ marginTop: 8 }}><button className="btn small" onClick={() => editMod((q) => { q.board.outline = roundedRectLoop(w, h, r || 0.01, 8).map(([x, y]) => [x + w / 2, y + h / 2] as V2); q.board.cutouts = []; })}>Apply rectangle</button></div>
    </>
  );
}

/** Shared value of a field across the selection, or undefined when mixed. */
function common<T, V>(list: T[], get: (t: T) => V): V | undefined {
  if (!list.length) return undefined;
  const v = get(list[0]);
  return list.every((x) => get(x) === v) ? v : undefined;
}

export function Inspector() {
  const p = useApp((s) => s.project)!;
  const sel = useApp((s) => s.sel);
  const mb = activeModule(p).board;
  const holes = mb.holes.filter((h) => isSel(sel, h.id));
  const comps = mb.comps.filter((c) => isSel(sel, c.id));
  if (!holes.length && !comps.length) return null;
  const ids = new Set(sel.map((s) => s.id));
  const setH = (fn: (h: Hole) => void) => editMod((q) => { q.board.holes.filter((x) => ids.has(x.id)).forEach(fn); });
  const setC = (fn: (c: Comp) => void) => editMod((q) => { q.board.comps.filter((x) => ids.has(x.id)).forEach(fn); });
  const del = () => { editMod((q) => { q.board.holes = q.board.holes.filter((x) => !ids.has(x.id)); q.board.comps = q.board.comps.filter((x) => !ids.has(x.id)); }); select([]); };
  const multi = holes.length + comps.length > 1;
  const title = multi ? `${holes.length ? `${holes.length} hole${holes.length > 1 ? 's' : ''}` : ''}${holes.length && comps.length ? ' + ' : ''}${comps.length ? `${comps.length} part${comps.length > 1 ? 's' : ''}` : ''}` : holes.length ? 'Selected hole' : `Selected: ${comps[0].ref}`;
  const one = !multi;
  const mixed = (v: number | undefined) => (v === undefined ? NaN : v);
  return (
    <Section title={title} right={<span className="btns"><button className="btn small ghost" onClick={() => select([])}>Clear</button><button className="btn small danger" onClick={del}>Delete</button></span>}>
      {holes.length > 0 && (
        <>
          {one && <div className="row3"><Num label="X" value={holes[0].x} onChange={(v) => setH((h) => { h.x = v; h.why = 'moved by hand'; })} /><Num label="Y" value={holes[0].y} onChange={(v) => setH((h) => { h.y = v; h.why = 'moved by hand'; })} /><Num label="Ø" value={holes[0].d} min={0.5} onChange={(v) => setH((h) => { h.d = v; h.why = 'size set by hand'; })} /></div>}
          {!one && <div className="row"><Num label={`Ø for ${holes.length} holes`} value={mixed(common(holes, (h) => h.d))} min={0.5} onChange={(v) => setH((h) => { h.d = v; })} /></div>}
          <div style={{ marginTop: 8 }}><Seg value={common(holes, (h) => h.use) ?? ('' as Hole['use'])} options={[['auto', 'Auto'], ['snap', 'Snap pin'], ['pin', 'Locating pin'], ['none', 'Ignore']]} onChange={(v) => setH((h) => { h.use = v; })} /></div>
        </>
      )}
      {comps.length > 0 && (
        <div style={{ marginTop: holes.length ? 12 : 0 }}>
          {one && <div className="row"><Text label="Reference" value={comps[0].ref} onChange={(v) => setC((x) => { x.ref = v; })} /><Pick label="Side" value={comps[0].side} options={[['top', 'Top'], ['bottom', 'Bottom (under)']]} onChange={(v) => setC((x) => { x.side = v; })} /></div>}
          {!one && <div style={{ marginBottom: 8 }}><Seg value={common(comps, (c) => c.side) ?? ('' as Comp['side'])} options={[['top', 'On top'], ['bottom', 'Underneath']]} onChange={(v) => setC((x) => { x.side = v; })} /></div>}
          <div className="row3" style={{ marginTop: 8 }}>
            {one && <><Num label="X" value={comps[0].x} onChange={(v) => setC((x) => { x.x = v; })} /><Num label="Y" value={comps[0].y} onChange={(v) => setC((x) => { x.y = v; })} /></>}
            <Num label="Width" value={mixed(common(comps, (c) => c.w))} min={0.2} onChange={(v) => setC((x) => { x.w = v; })} />
            <Num label="Length" value={mixed(common(comps, (c) => c.l))} min={0.2} onChange={(v) => setC((x) => { x.l = v; })} />
            <Num label="Height" value={mixed(common(comps, (c) => c.h))} min={0} onChange={(v) => setC((x) => { x.h = v; })} />
          </div>
          <div style={{ marginTop: 8 }}><RotateBox value={common(comps, (c) => c.rot) ?? null} onTurn={(by) => turnParts(comps.map((c) => c.id), by)} /></div>
          <div className="row" style={{ marginTop: 8 }}>
            <Pick label="Kind" value={common(comps, (c) => c.kind) ?? ('' as Comp['kind'])} options={[['' as Comp['kind'], '— mixed —'], ['generic', 'Part'], ['connector', 'Connector'], ['header', 'Header'], ['switch', 'Button/switch'], ['led', 'LED'], ['module', 'Module'], ['hot', 'Hot part'], ['antenna', 'Antenna/RF']]} onChange={(v) => v && setC((x) => { x.kind = v; })} />
            <div className="field"><span>&nbsp;</span><Check label="Through-hole leads" value={common(comps, (c) => c.tht) ?? false} onChange={(v) => setC((x) => { x.tht = v; })} /></div>
          </div>
          {one && <p className="hint">{comps[0].pkg}{comps[0].value ? ` · ${comps[0].value}` : ''}</p>}
          <div className="btns" style={{ marginTop: 6 }}>
            {comps.some((c) => !c.conn) && <button className="btn small" onClick={() => setC((x) => { if (!x.conn) { x.conn = connSetup(connById('custom'), 0); x.kind = 'connector'; } })}>Treat as connector{multi ? 's' : ''}</button>}
            {activeModule(store.get().project!).board.kind !== 'box' && (
              <select className="btn small" value="" title="A probe (J-Link) or a USB-serial cable plugs in here" onChange={(e) => { const v = e.target.value; if (v) setC((x) => markDebug(x, v === 'none' ? null : (v as DebugKind))); }}>
                <option value="">{comps.every(isDebugPort) ? 'Debug header ✓' : comps.every(isUartPort) ? 'UART header ✓' : 'Debug / UART…'}</option>
                {DEBUG_KINDS.map(([k, n]) => <option key={k} value={k}>Debug: {n}</option>)}
                <option value="uart">UART header (USB-serial cable)</option>
                {comps.some((c) => isDebugPort(c) || isUartPort(c)) && <option value="none">Neither</option>}
              </select>
            )}
            {comps.some((c) => c.conn) && <button className="btn small" onClick={() => store.set({ step: 'plugs' })}>Plug settings →</button>}
            <button className="btn small ghost" onClick={() => { setC((x) => { x.hidden = true; }); select([]); }}>Hide (ignore)</button>
          </div>
        </div>
      )}
    </Section>
  );
}

// ============================================================================================ PLUGS
export function PlugsPanel() {
  const p = useApp((s) => s.project)!;
  const sel = useApp((s) => s.sel);
  const conns = activeModule(p).board.comps.filter((c) => c.conn && !c.hidden);
  const chosen = conns.filter((c) => isSel(sel, c.id));
  const uses = portUses(p, activeModule(p));
  return (
    <div>
      <ModulePicker />
      <p className="lede">Every connector gets an opening sized for its plug. The ones with a plug in them get a <b>cradle</b> with a snap-on <b>cap</b> (edge plugs) and a zip-tie anchor on the side the cable is pulled to; the rest are left bare, so nothing is printed that does no good. Tick several to set them together, or click a cradle in the 3D view.</p>
      <Section title={`Connectors · ${conns.length}`} right={<span className="btns"><AllBox items={conns.map((c) => ({ kind: 'comp' as const, id: c.id }))} /><button className="btn small" onClick={() => store.set({ view: 'editor' })}>+ Add</button></span>}>
        <div className="list">
          {conns.map((c) => {
            const why = uses.get(c.ref), on = inUse(why);
            const cycle = () => edit((q) => { const x = q.modules[q.active].board.comps.find((y) => y.id === c.id); if (!x?.conn) return; const u = x.conn.use ?? 'auto'; if (u === 'auto') x.conn.use = on ? 'no' : 'yes'; else delete x.conn.use; });
            return (
              <SelRow key={c.id} it={{ kind: 'comp', id: c.id }}>
                <span className="grow"><b>{c.ref}</b> <small>{connById(c.conn!.type).name}</small></span>
                <button className={`usechip ${on ? 'on' : ''}`} title={`${on ? 'In use' : 'Empty'}: ${USE_TEXT[why ?? 'unused']}. Click to say ${(c.conn!.use ?? 'auto') !== 'auto' ? 'automatic again' : on ? 'it stays empty' : "you'll plug it in"}.`} onClick={(e) => { e.stopPropagation(); cycle(); }}>{on ? (why === 'cable' ? 'cable' : why === 'yours' ? 'you plug in' : why === 'supply' ? 'supply' : 'power') : 'empty'}</button>
                {!on ? <Chip>bare</Chip> : c.conn!.entry === 'edge' ? <Chip>{c.conn!.cradle ? (c.conn!.cap ? 'cradle + cap' : 'cradle') : c.conn!.guard ? 'guard' : 'opening'}</Chip> : <Chip>from above</Chip>}
              </SelRow>
            );
          })}
          {!conns.length && <p className="hint">{say('No connectors found. Add them in the board editor (Connector tool, click an edge), or select a part and choose "Treat as connector".')}</p>}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>Tap a port's <i>empty</i> or <i>cable</i> tag to say whether you'll plug something into it yourself.</p>
      </Section>
      {chosen.length > 0 && <ConnEditor list={chosen} />}
      {p.modules.length > 1 && <div className="copyholder"><span>Copy this board's plug settings to</span><CopyTo start={{ holder: false }} /></div>}
      <CablesSection />
    </div>
  );
}


/** Every cable in the project: what goes where, how long, what to buy. */
const NO_CABLES: NonNullable<NonNullable<ReturnType<typeof store.get>['result']>['report']['cables']> = [];
export function CablesSection() {
  const p = useApp((s) => s.project)!;
  // no `?? []` inside the selector: a new array on every read makes the store re-render forever before the first build
  const cables = useApp((s) => s.result?.report.cables) ?? NO_CABLES;
  const sel = useApp((s) => s.sel);
  const links = p.links ?? [];
  const nm = (r: { module: string; ref: string }) => { const m = findModule(p, r.module); return `${m?.board.name ?? '?'} ${refText(m, r.ref)}`; };
  const nos = cableNumbers(links);
  // the same list as the shopping list: ribbons come with their probe, jumper wires by the wire
  const buy = cableLines(p, cables);
  const spread = netSpread(cables);
  const budget = portBudget(p);
  return (
    <Section title={`Cables · ${links.length}`} right={<span className="btns">
      <button className="btn small soft" onClick={() => addLinks()}><Icon d={I.wand} /> Auto-connect</button>
      <button className="btn small ghost" onClick={() => store.set({ view: 'wiring' })}>Wiring view</button>
    </span>}>
      {(links.length > 0 || budget.devices.length + budget.powerIns.length > 0) && <PortBudget budget={budget} />}
      {links.length > 0 && <PowerBudget />}
      {!links.length ? <p className="hint" style={{ marginTop: 0 }}>Say what plugs into what (a Pi's USB to an Arduino, power from a charger) and BoardDock keeps connected boards together on the rails, routes each cable along the channels between the rails, and tells you how long a cable to buy. <b>Auto-connect</b> fills in the obvious ones.</p> : (
        <>
          <div className="list">
            {links.map((l) => {
              const c = cables.find((x) => x.id === l.id);
              return (
                <div key={l.id} className={`item ${isSel(sel, l.id) ? 'sel' : ''}`} onClick={() => select([{ kind: 'link', id: l.id }])}>
                  <span className="cno" style={{ background: KIND_COLOR[l.kind ?? 'usb'] }}>{nos.get(l.id)}</span>
                  <span className="grow"><b>{nm(l.a)}</b> <small>to</small> <b>{nm(l.b)}</b><small className="cpurpose">{cablePurpose(p, l).text}</small>{l.auto && l.why && <small className="cpurpose cwhy">{l.why}</small>}</span>
                  {c ? <span className="chip">{Math.round(c.length / 10)} cm</span> : <span className="chip">{[l.a, l.b].some((r) => offRackModule(findModule(p, r.module))) ? 'off the rack' : 'not on the rails'}</span>}
                  <button className="btn small ghost icon" title="Remove the cable" onClick={(e) => { e.stopPropagation(); removeLinks([l.id]); }}><Icon d={I.x} /></button>
                </div>
              );
            })}
          </div>
          <div className="divider" />
          <div className="field"><span>Cables to buy (route + 10%, next standard length)</span></div>
          <ul className="fmt" style={{ marginTop: 4 }}>{buy.buy.map((k) => <li key={k}>{k}</li>)}{!buy.buy.length && <li>nothing: {cables.length ? 'every cable comes with its part' : 'the cables are sized once the rack is laid out'}</li>}</ul>
          {buy.comes.length > 0 && <p className="hint" style={{ margin: '4px 0 0' }}>Not to buy: {buy.comes.join('; ')}.</p>}
          {p.layout === 'panel' && <Check label="Print a numbered tag for each end of every cable" value={p.panel.cableTags !== false} onChange={(v) => edit((q) => { q.panel.cableTags = v; })} />}
          {(spread?.n ?? 0) > 1 && spread!.short !== spread!.long && <Check label={`Buy every Ethernet lead at one length (${spread!.long} m, the longest route, rounded up: now ${spread!.short} to ${spread!.long} m)`} value={!!p.oneNetLength} onChange={(v) => edit((q) => { if (v) q.oneNetLength = true; else delete q.oneNetLength; })} />}
        </>
      )}
    </Section>
  );
}

/**
 * "New version…": pick (or drop) the files of a newer revision of this board. It replaces the board where it is:
 * dock, cables, holder settings and plug choices stay; what changed is listed here and in the toast.
 */
export function NewVersionButton({ moduleId, small }: { moduleId: string; small?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (fl: FileList | File[]) => { setErr(null); try { await openRevision(fl, moduleId); } catch (e: any) { setErr(e?.message ?? String(e)); toast(`Could not read the new version: ${e?.message ?? e}`); } };
  return (
    <>
      <button className={`btn ${small ? 'small' : 'small soft'} ${over ? 'over' : ''}`} title="Pick or drop the files of a newer version of this board: it takes this one's place, cables and holder settings"
        onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); go(e.dataTransfer.files); }}>
        <Icon d={I.download} /> New version…
      </button>
      <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { if (e.target.files) go(e.target.files); e.target.value = ''; }} />
      {err && !small && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
    </>
  );
}

/** The Board step's note on the last new version swapped in, and the way to it. */
function Revision() {
  const p = useApp((s) => s.project)!;
  const m = activeModule(p);
  const r = m.revision;
  return (
    <div className="revision">
      <div className="btns" style={{ alignItems: 'center' }}>
        <NewVersionButton moduleId={m.id} />
        {!r && <small className="hint" style={{ margin: 0 }}>A newer revision of this board? Swap it in here.</small>}
      </div>
      {r && (
        <div className="revnote">
          <b>New version, {new Date(r.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</b> <small>({r.to})</small>
          {r.changes.length ? <ul className="fmt">{r.changes.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="hint" style={{ margin: '4px 0' }}>No mechanical changes: the holder comes out the same.</p>}
          <div className="btns">
            <button className="btn small primary" onClick={() => store.set({ step: 'export', view: 'assembly', exportPick: [m.id] })}><Icon d={I.download} /> Print its holder</button>
            <button className="btn small ghost" onClick={() => editMod((q) => { delete q.revision; })}>Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Board › Power: what this board takes at 5 V, the estimate until the user types their own. */
function PowerDraw() {
  const p = useApp((s) => s.project)!;
  const m = activeModule(p), b = m.board;
  const mine = plugsOf(p).filter((x) => x.module === m);
  const n = needOf(b, mine.some((x) => x.role === 'power-in'));
  // only boards that take power from a port (a power input, or USB as a device) are in the budget
  const budgeted = b.draw != null || mine.some((x) => x.role === 'power-in' || x.role === 'device');
  if (!budgeted && !canFitPoe(b)) return null;
  return (
    <>
      {canFitPoe(b) && <Check label="PoE HAT fitted (powered over its Ethernet)" value={takesPoe(b)} onChange={(v) => editMod((q) => { if (v) q.board.poe = true; else delete q.board.poe; })} hint="On a PoE port of a switch it needs no supply of its own, and Auto-connect leaves its USB-C alone. The HAT goes on the shopping list." />}
      {budgeted && <div className="row" style={{ marginTop: 8, alignItems: 'end' }}>
        <Num label={`Power${b.draw == null ? ' (estimate)' : ''}`} unit="A at 5 V" value={b.draw ?? n.load} min={0} max={10} step={0.1} onChange={(v) => editMod((q) => { q.board.draw = v; })} hint={n.why} />
        {b.draw != null && <button className="btn small ghost" onClick={() => editMod((q) => { delete q.board.draw; })}>Back to the estimate</button>}
      </div>}
      {budgeted && b.draw == null && <p className="hint" style={{ margin: '4px 0 0' }}>{n.why}. Used for the power budget under Plugs › Cables.</p>}
    </>
  );
}

/**
 * What each charger, hub and Pi is asked to supply against what it gives: a bar per source, and what to change
 * (move boards to stronger ports); then what each powerboard carries from the wall.
 */
function PowerBudget() {
  const p = useApp((s) => s.project)!;
  const srcs = useMemo(() => powerBudget(p), [p.links, p.modules]);
  const mains = useMemo(() => mainsBudget(p), [p.links, p.modules]);
  const poe = useMemo(() => poeBudget(p), [p.links, p.modules]);
  const stronger = useMemo(() => strongerPower(p, plugPlaces()), [p.links, p.modules]);
  const [open, setOpen] = useState<string | null>(null);
  if (!srcs.length && !mains.length && !poe.length) return null;
  const bad = srcs.filter((s) => s.status !== 'ok').length;
  return (
    <div className="powerlist">
      <div className="field"><span>Power{bad ? ` · ${bad} short` : ' · every source has enough'} <small>(estimates at 5 V)</small></span></div>
      {stronger && <div className="btns" style={{ margin: '2px 0 6px' }}><button className="btn small soft" onClick={rebalancePower} title="Take the boards off ports that give them too little and plug them into stronger free ports (one undo step)">Move {stronger.moved > 1 ? `${stronger.moved} boards` : 'a board'} to stronger ports</button></div>}
      {srcs.map((s) => {
        const t = powerText(s), f = Math.min(1, s.load / Math.max(0.01, s.total));
        return (
          <div key={s.module.id} className={`pw ${s.status}`} onClick={() => setOpen(open === s.module.id ? null : s.module.id)} title="Click for the details">
            <div className="pw-row"><b title={s.module.board.name}>{shortName(s.module.board.name)}</b><small>{s.kind}</small><span className="grow" /><span className="mono">{Math.round(s.load * 10) / 10} / {Math.round(s.total * 10) / 10} A</span></div>
            {s.ports.length > 0 && <small className="pw-note">{s.ports.length} port{s.ports.length > 1 ? 's' : ''} too weak for {s.ports.length > 1 ? 'their boards' : shortName(s.ports[0].take)}</small>}
            {s.limited.length > 0 && <small className="pw-note">{s.limited.map((q) => shortName(q.take)).join(', ')}: {s.limited[0].cap} A of the {s.limited[0].peak} A {s.limited.length > 1 ? 'they want' : 'it wants'}, so {s.limited.length > 1 ? 'their' : 'its'} USB ports are held back</small>}
            <div className="pw-bar"><i style={{ width: `${f * 100}%` }} /></div>
            {open === s.module.id && <p className="hint" style={{ margin: '6px 0 0' }}>{t.detail}</p>}
          </div>
        );
      })}
      {poe.map((s) => {
        const t = poeText(s), f = Math.min(1, s.load / Math.max(0.01, s.total)), k = `poe-${s.module.id}`;
        return (
          <div key={k} className={`pw ${s.status}`} onClick={() => setOpen(open === k ? null : k)} title="Click for the details">
            <div className="pw-row"><b title={s.module.board.name}>{shortName(s.module.board.name)}</b><small>PoE</small><span className="grow" /><span className="mono">{Math.round(s.load)} / {Math.round(s.total)} W</span></div>
            {s.over.length > 0 && <small className="pw-note">{s.over.map((q) => shortName(q.name)).join(', ')} want more than one PoE port gives</small>}
            <div className="pw-bar"><i style={{ width: `${f * 100}%` }} /></div>
            {open === k && <p className="hint" style={{ margin: '6px 0 0' }}>{t.detail}</p>}
          </div>
        );
      })}
      {mains.map((s) => {
        const t = mainsText(s), f = Math.min(1, s.amps / Math.max(0.01, s.rating)), k = `mains-${s.module.id}`;
        return (
          <div key={k} className={`pw ${s.status}`} onClick={() => setOpen(open === k ? null : k)} title="Click for the details">
            <div className="pw-row"><b title={s.module.board.name}>{shortName(s.module.board.name)}</b><small>mains</small><span className="grow" /><span className="mono">{Math.round(s.amps * 100) / 100} / {s.rating} A</span></div>
            <div className="pw-bar"><i style={{ width: `${f * 100}%` }} /></div>
            {open === k && <p className="hint" style={{ margin: '6px 0 0' }}>{t.detail}</p>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Devices still waiting for a port, boards still without power (or on a port too weak for them), and free ports,
 * with a one-click fix while ports or power run short: it adds the hub, charger or supply and connects it.
 */
function PortBudget({ budget }: { budget: ReturnType<typeof portBudget> }) {
  const p = useApp((s) => s.project)!;
  const { devices, usbPorts, powerIns, powerOuts, weak, unwired } = budget;
  const short = useMemo(() => powerShort(p), [p.links, p.modules]);
  const wires = unwired.length > 0 && <p className="hint">Not wired yet: {unwired.map((u) => `${times(u.name, u.count)} (${u.refs.join(', ')})`).join('; ')}. Auto-connect leaves wires and jumper headers to you: connect them in the Wiring view or with “Cable to” on the connector.</p>;
  if (!devices.length && !powerIns.length && !weak.length) return <><p className="hint">{usbPorts.length ? `${usbPorts.length} USB port${usbPorts.length > 1 ? 's' : ''} still free` : 'No USB ports left over'}{powerOuts.length ? `, ${powerOuts.length} charger port${powerOuts.length > 1 ? 's' : ''} free` : ''}.</p>{wires}</>;
  const named = (id: string) => (TEMPLATES.find((t) => t.id === id)?.name ?? id).replace(/ \(.*$/, '');
  const them = devices.length > 1 ? 'them' : 'it';
  return (
    <div className="warns" style={{ marginTop: 8 }}>
      {devices.length > 0 && <div>{devices.length} USB plug{devices.length > 1 ? 's' : ''} waiting for a port ({devices.map((d) => `${d.module.board.name} ${d.comp.ref}`).join(', ')}); {usbPorts.length} free on the rack.{devices.length > usbPorts.length && <> Plug {them} into your computer (Auto-connect does it), or <button className="btn small" style={{ marginLeft: 4 }} onClick={() => addAccessory(hubOffer(devices.length - usbPorts.length).id, hubOffer(devices.length - usbPorts.length).count)} title={`${devices.length - usbPorts.length} plugs have no port: ${hubOffer(devices.length - usbPorts.length).count * hubOffer(devices.length - usbPorts.length).ports} hub ports cover them. Each hub's uplink goes to a free port of the rack, or to your computer.`}>Add {hubOffer(devices.length - usbPorts.length).count > 1 ? `${hubOffer(devices.length - usbPorts.length).count} USB hubs` : 'a USB hub'}</button></>}</div>}
      {wires}
      {(powerIns.length > 0 || weak.length > 0) && <div>
        {powerIns.length > 0 && `${powerIns.length} board${powerIns.length > 1 ? 's need' : ' needs'} power (${powerIns.map((d) => d.module.board.name).join(', ')})`}{powerIns.length > 0 && weak.length > 0 && '; '}
        {weak.length > 0 && `${weak.length} ${weak.length > 1 ? 'are' : 'is'} on a port too weak for ${weak.length > 1 ? 'them' : 'it'} (${weak.map((w) => `${shortName(w.take.module.board.name)} on ${w.src.label}${w.loop ? ', the hub it hosts' : ''}`).join(', ')})`}; {powerOuts.length} charger port{powerOuts.length === 1 ? '' : 's'} free{short.add && powerOuts.length ? `, not one strong enough for ${short.unserved.length > 1 ? `the ${short.unserved.length} left` : shortName(short.unserved[0].plug.module.board.name)}` : ''}.
        {short.add && <button className="btn small" style={{ marginLeft: 4 }} onClick={() => addAccessory(short.add!.id, short.add!.count)} title="Adds it and connects the boards that need it">Add {short.add.count > 1 ? `${short.add.count} × ` : 'a '}{named(short.add.id)}</button>}
      </div>}
    </div>
  );
}

/** "Cable to" picker for one connector. */
function CableTo({ c }: { c: Comp }) {
  const p = useApp((s) => s.project)!;
  const m = activeModule(p);
  const me = { module: m.id, ref: c.ref };
  const cur = linkOf(p, me);
  const other = cur ? (sameRef(cur.a, me) ? cur.b : cur.a) : null;
  const myRole = plugRole(m, c);
  // only what it can safely go to (never a powerboard into another), your computer included
  const all = allPlugs(p), mine = all.find((q) => sameRef(q.ref, me));
  const options = mine ? all.filter((q) => q.module.id !== m.id && canCable(p, mine, q)) : [];
  return (
    <Pick label="Cable to" value={other ? `${other.module}|${other.ref}` : ''} options={[['', options.length ? '— not connected —' : '— nothing it fits —'], ...options.map((q) => [`${q.ref.module}|${q.ref.ref}`, `${q.module.board.name} · ${q.label}`] as [string, string])]}
      onChange={(v) => { if (!v) setLink(me, null); else { const [mod, ref] = v.split('|'); const q = options.find((x) => x.ref.module === mod && x.ref.ref === ref)!; setLink(me, q.ref, linkKind(myRole, q.role)); const note = mine && connectNote(mine, q); if (note) toast(note); } }} />
  );
}

function ConnEditor({ list }: { list: Comp[] }) {
  const ids = new Set(list.map((c) => c.id));
  const set = (fn: (x: Comp) => void) => editMod((q) => { q.board.comps.filter((k) => ids.has(k.id)).forEach(fn); });
  const cs = list.map((c) => c.conn!);
  const one = list.length === 1;
  const type = common(cs, (c) => c.type);
  const t = type ? connById(type) : undefined;
  const mixed = (v: number | undefined) => (v === undefined ? NaN : v);
  const flag = (k: 'cradle' | 'cap' | 'guard' | 'tie') => cs.every((c) => c[k]);
  // a port nothing is plugged into gets no cradle, cap, collar or tie: asking for one says you'll plug it in
  const p = useApp((s) => s.project)!, uses = portUses(p, activeModule(p));
  const bare = list.filter((c) => !inUse(uses.get(c.ref)));
  const want = (x: Comp) => { if (!inUse(uses.get(x.ref))) x.conn!.use = 'yes'; };
  return (
    <>
      <Section title={one ? `${list[0].ref}: connector` : `${list.length} connectors`}>
        <Pick label="Type" value={type ?? ''} options={[...(type ? [] : [['', '— mixed —'] as [string, string]]), ...CONNECTORS.map((k) => [k.id, k.name] as [string, string])]} onChange={(id) => id && set((x) => {
          const k = connById(id);
          const keep = x.conn!.angle;
          x.conn = connSetup(k, keep);
          x.w = k.body.w; x.l = k.body.l; x.h = k.body.h; x.pkg = k.name; x.rot = keep - 90;
        })} />
        {t?.note && <p className="hint">{t.note}</p>}
        <div className="row" style={{ marginTop: 8 }}>
          <Pick label="Plug enters" value={common(cs, (c) => c.entry) ?? ('' as 'edge')} options={[['edge', 'Through the edge'], ['top', 'From above']]} onChange={(v) => set((x) => { x.conn!.entry = v; })} />
          <Pick label="Mounted on" value={common(list, (c) => c.side) ?? ('' as 'top')} options={[['top', 'Top side'], ['bottom', 'Bottom side']]} onChange={(v) => set((x) => { x.side = v; })} />
        </div>
        {one && <div style={{ marginTop: 8 }}><CableTo c={list[0]} /></div>}
        {one && cs[0].entry === 'edge' && (
          <>
            <div className="row" style={{ marginTop: 8 }}>
              <Num label="Plug direction" unit="°" step={90} value={cs[0].angle} onChange={(v) => set((x) => { x.conn!.angle = v; })} />
              <Num label="Plug axis above board" value={cs[0].zc} onChange={(v) => set((x) => { x.conn!.zc = v; })} />
            </div>
            <div style={{ marginTop: 8 }}><Seg value={((Math.round(cs[0].angle) % 360) + 360) % 360} options={[[180, '← Left'], [270, '↓ Down'], [0, '→ Right'], [90, '↑ Up']]} onChange={(v) => set((x) => { x.conn!.angle = v; })} /></div>
          </>
        )}
      </Section>
      <Section title="Mating plug size" right={<button className="btn small ghost" onClick={() => set((x) => { x.conn!.plug = { ...connById(x.conn!.type).plug }; })}>Reset to type</button>}>
        <p className="hint" style={{ marginTop: 0 }}>Measure the plug body (the moulded part you hold), not the metal tip. Real plugs vary a lot.{!one && ' Blank fields differ between the selected connectors; typing a value sets it for all.'}</p>
        <div className="row" style={{ marginTop: 8 }}>
          <Num label="Width" value={mixed(common(cs, (c) => c.plug.w))} min={1} onChange={(v) => set((x) => { x.conn!.plug.w = v; })} />
          <Num label="Height" value={mixed(common(cs, (c) => c.plug.h))} min={0.5} onChange={(v) => set((x) => { x.conn!.plug.h = v; })} />
          <Num label="Body length" value={mixed(common(cs, (c) => c.plug.len))} min={2} onChange={(v) => set((x) => { x.conn!.plug.len = v; })} />
          <Num label="Cable Ø" value={mixed(common(cs, (c) => c.plug.cable))} min={0} onChange={(v) => set((x) => { x.conn!.plug.cable = v; })} />
        </div>
      </Section>
      <Section title="Will a plug be in it?">
        <Seg value={common(cs, (c) => c.use ?? 'auto') ?? ('' as 'auto')} options={[['auto', 'Automatic'], ['yes', 'Yes, I plug it in'], ['no', 'No, it stays empty']]} onChange={(v) => set((x) => { if (v === 'auto') delete x.conn!.use; else x.conn!.use = v; })} />
        <p className="hint">Only ports with a plug in them get a cradle, cap, collar or zip-tie anchor: nothing is printed for a port you never use (its opening in the wall is still there). Automatic counts a port as used when a cable to it is in the app, or it is how the board gets power. Say Yes for what you'll plug in yourself: a screen, a keyboard, a supply off the rack.</p>
      </Section>
      <Section title="Protection">
        <Check label="Cradle: carries the plug body outside the wall" value={flag('cradle')} onChange={(v) => set((x) => { if (x.conn!.entry === 'edge') { x.conn!.cradle = v; if (v) want(x); } })} />
        <Check label="Snap-on cap: locks the plug into the cradle" value={flag('cap') && flag('cradle')} onChange={(v) => set((x) => { if (x.conn!.entry !== 'edge') return; x.conn!.cap = v; if (v) { x.conn!.cradle = true; want(x); } })} />
        <Check label="Guard collar around the opening" value={flag('guard')} onChange={(v) => set((x) => { x.conn!.guard = v; if (v) want(x); })} />
        <Check label="Zip-tie anchor for the cable" value={flag('tie')} onChange={(v) => set((x) => { x.conn!.tie = v; if (v) want(x); })} />
        <p className="hint">Neighbouring cradles on one edge merge automatically and share one cap.{bare.length > 0 && ` ${bare.length === 1 ? 'This port is' : `${bare.length} of these ports are`} empty, so nothing is printed for ${bare.length === 1 ? 'it' : 'them'}: ticking one of these says you'll plug ${bare.length === 1 ? 'it' : 'them'} in.`}</p>
      </Section>
    </>
  );
}

// ============================================================================================ HOLDER
export function HolderPanel() {
  const p = useApp((s) => s.project)!;
  const H = activeModule(p).holder;
  const set = (fn: (h: Project['modules'][number]['holder']) => void) => editMod((q) => fn(q.holder));
  const lv = useApp((s) => s.result?.report.levels);
  return (
    <div>
      <ModulePicker />
      <HolderStyle />
      {p.layout === 'panel' && (
        <Section title="Release button">
          <Seg value={H.release ?? 'centre'} options={[['centre', 'Centred'], ['side', 'Beside the board'], ['auto', 'Automatic']]} onChange={(v) => set((h) => { h.release = v; })} />
          <p className="hint">{(H.release ?? 'centre') === 'centre' ? 'The button sits in the middle of the holder’s far edge; the spine that carries its rod runs under the board, which sits about 10 mm up.' : (H.release ?? 'centre') === 'side' ? 'The spine, grip bar and button run beside the board: the board sits low and the far edge stays free for plugs.' : 'Picks centred or beside for each board, whichever keeps the plugs clear with the least plastic.'} Plugs in the way always win: the button moves if it would block one.</p>
        </Section>
      )}
      <Section title="Material">
        <Seg value={H.material} options={(Object.keys(MATERIALS) as (keyof typeof MATERIALS)[]).map((m) => [m, m])} onChange={(v) => set((h) => { h.material = v; })} />
        <p className="hint">{H.material === 'PLA' ? 'PLA works but is stiff and brittle for springs and softens around 55 °C. PETG is the default.' : `${H.material}: E ≈ ${MATERIALS[H.material].E} MPa, spring strain limit ${(MATERIALS[H.material].strainAllow * 100).toFixed(1)}%.`}</p>
      </Section>
      <Section title="Preset">
        <div className="presets">
          {([['sturdy', 'Sturdy', 'full tray, thick walls'], ['balanced', 'Balanced', 'frame, the default'], ['lean', 'Lean', 'thin frame, fastest print']] as const).map(([k, n, d]) => {
            const on = Object.entries(HOLDER_PRESETS[k]).every(([key, v]) => (H as any)[key] === v);
            return <button key={k} className={`preset ${on ? 'on' : ''}`} onClick={() => set((h) => { Object.assign(h, HOLDER_PRESETS[k]); })}><b>{n}</b><small>{d}</small></button>;
          })}
        </div>
        <CopyHolder />
      </Section>
      <HolderFeatures />
      <Section title={(H.style ?? 'frame') === 'frame' ? 'Frame' : 'Tray'}>
        <div className="row">
          <Num label="Wall" value={H.wall} min={1.2} max={4} onChange={(v) => set((h) => { h.wall = v; })} />
          <Num label="Base" value={H.base} min={1.2} max={5} onChange={(v) => set((h) => { h.base = v; })} />
          <Num label="Board-to-wall gap" value={H.gap} min={0.1} max={1.5} step={0.05} onChange={(v) => set((h) => { h.gap = v; })} />
          <Num label="Wall above board" value={H.wallAbove} min={-3} max={10} onChange={(v) => set((h) => { h.wallAbove = v; })} />
        </div>
        <div style={{ marginTop: 8 }}><Check label="Chamfered edges (stepped 0.2 mm, prints clean)" value={H.chamfer} onChange={(v) => set((h) => { h.chamfer = v; })} /></div>
      </Section>
      <Section title="Under the board">
        <div className="row">
          <Num label={`Clearance${H.standoff === null ? ' (auto)' : ''}`} value={H.standoff ?? (lv ? round(lv.boardBottom - lv.base, 1) : H.minStandoff)} min={1} max={40} onChange={(v) => set((h) => { h.standoff = v; })} />
          <Num label="Lead length (THT)" value={H.leadLen} min={0} max={10} onChange={(v) => set((h) => { h.leadLen = v; })} />
        </div>
        {H.standoff !== null && <div className="btns" style={{ marginTop: 6 }}><button className="btn small ghost" onClick={() => set((h) => { h.standoff = null; })}>Back to automatic</button></div>}
        <p className="hint">Automatic clearance clears the tallest part under the board; deeper parts get pockets in the base.</p>
        <div className="row" style={{ marginTop: 8 }}><Num label="Pin clearance in holes" value={H.pinClear} min={0} max={0.5} step={0.05} onChange={(v) => set((h) => { h.pinClear = v; })} /></div>
      </Section>
      <Section title="Look">
        {(H.style ?? 'frame') === 'tray' && <Pick label="Base pattern" value={H.pattern} options={[['hex', 'Hexagons'], ['slots', 'Slots'], ['circles', 'Circles'], ['none', 'Solid']]} onChange={(v) => set((h) => { h.pattern = v; })} />}
        {(H.style ?? 'frame') === 'tray' && H.pattern !== 'none' && <div className="row" style={{ marginTop: 8 }}><Num label="Cell size" value={H.cell} min={5} max={30} step={0.5} onChange={(v) => set((h) => { h.cell = v; })} /><Num label="Rib" value={H.rib} min={1.2} max={5} onChange={(v) => set((h) => { h.rib = v; })} /></div>}
        <div className="field" style={{ marginTop: 10 }}><span>Filament colour (preview)</span>
          <div className="swatches">
            {[['#e9e6df', 'Bone'], ['#3a4048', 'Graphite'], ['#4c8dff', 'Blue'], ['#46d58b', 'Mint'], ['#c084fc', 'Violet'], ['#f5c542', 'Yellow']].map(([c, n]) => (
              <button key={c} title={n} className={(H.color ?? '#e9e6df') === c ? 'on' : ''} style={{ background: c }} onClick={() => set((h) => { h.color = c; })} />
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}

/**
 * Every holder feature in one place, each with what this holder actually got: a switch that can't do anything here
 * (no free wall for a label, plugs where clips would go) says why instead of silently changing nothing.
 */
function HolderFeatures() {
  const p = useApp((s) => s.project)!;
  const res = useApp((s) => s.result);
  const building = useApp((s) => s.building);
  const m = activeModule(p), H = m.holder;
  const set = (fn: (h: Project['modules'][number]['holder']) => void) => editMod((q) => fn(q.holder));
  const F = { ...DEFAULT_FEATURES, ...(H.feat ?? {}) };
  const setF = (k: keyof typeof F, v: boolean) => set((h) => { h.feat = { ...DEFAULT_FEATURES, ...(h.feat ?? {}), [k]: v }; });
  const frame = (H.style ?? 'frame') === 'frame';
  const box = m.board.kind === 'box';
  const checks = (res?.report.checks ?? []).filter((c) => c.module === m.id);
  const check = (re: RegExp) => checks.find((c) => re.test(c.name));
  const count = (k: string) => (res?.report.features ?? []).filter((f) => f.module === m.id && f.kind === k).length;
  const caps = (res?.parts ?? []).filter((x) => x.tag?.module === m.id && x.tag?.kind === 'cap').reduce((a, x) => a + x.qty, 0);
  const conns = m.board.comps.filter((c) => c.conn && !c.hidden).length;
  const st = (on: boolean, n: number, what: string, none: string) => (!res || building ? '…' : !on ? 'off' : n ? `${n} ${what}${n > 1 ? 's' : ''}` : none);
  const clipsC = check(/^Spring clips/), pins = check(/^Snap pins/), lab = check(/^Label$/);
  const hold = holdOf(H);
  const nClips = clipsC ? +(/\((\d+)\)/.exec(clipsC.name)?.[1] ?? 0) : 0, nPins = pins ? +(/\((\d+),/.exec(pins.name)?.[1] ?? 0) : 0;
  const heldBy = [nClips ? `${nClips} spring clips` : '', nPins ? `${nPins} snap pins` : ''].filter(Boolean).join(' + ') || 'nothing yet';
  const Row = ({ title, status, why, children }: { title: string; status: string; why?: string; children: ReactNode }) => (
    <div className="featrow">
      <div className="featrow-l"><b>{title}</b><small title={why}>{status}{why ? <em> · {why}</em> : null}</small></div>
      <div className="featrow-r">{children}</div>
    </div>
  );
  const toggle = (v: boolean, on: (v: boolean) => void, disabled = false) => <label className="switch"><input type="checkbox" checked={v} disabled={disabled} onChange={(e) => on(e.target.checked)} /><i /></label>;
  return (
    <Section title="Features">
      {!box && (
        <>
          <Row title="Plug cradles" status={st(F.cradles, count('cradle'), 'cradle', conns ? 'none needed' : 'no plugs')}>{toggle(F.cradles, (v) => setF('cradles', v))}</Row>
          <Row title="Snap-on plug caps" status={F.cradles ? st(F.caps, caps, 'cap', 'none needed') : 'need the cradles'} why={!F.cradles ? 'caps clip onto the cradles' : undefined}>{toggle(F.caps && F.cradles, (v) => setF('caps', v), !F.cradles)}</Row>
          <Row title="Receptacle guards" status={st(F.guards, count('guard'), 'guard', 'none needed')}>{toggle(F.guards, (v) => setF('guards', v))}</Row>
          <Row title="Cable-tie anchors" status={st(F.ties, count('tie'), 'anchor', 'none needed')}>{toggle(F.ties, (v) => setF('ties', v))}</Row>
          <Row title="Hold the board with" status={!res || building ? '…' : heldBy} why={clipsC && !nClips ? clipsC.detail : undefined}>
            <Seg value={hold} options={[['auto', 'Auto'], ['clips', 'Clips'], ['pins', 'Pins'], ['both', 'Both']]} onChange={(v) => set((h) => { h.hold = v; })} />
          </Row>
          <div className="featsub">
            {hold !== 'pins' && <div className="featrow"><div className="featrow-l"><b>Clip strength</b><small>{clipsC && nClips ? `${clipsC.value}; ${check(/^Press-in force$/)?.value ?? ''} to press in` : '…'}</small></div><div className="featrow-r"><Seg value={H.grip ?? 'firm'} options={[['firm', 'Firm'], ['gentle', 'Gentle']]} onChange={(v) => set((h) => { h.grip = v; })} /></div></div>}
            <p className="hint">Spring clips stand up round the board's edges and bend sideways, within the print layers; once the board is in they carry no load. Snap pins grip it by its mounting holes. Auto uses clips where two fit facing each other, snap pins where they don't.</p>
          </div>
          {!frame && <Row title="Finger notches" status={st(H.notches, count('notch'), 'notch', 'no free wall')}>{toggle(H.notches, (v) => set((h) => { h.notches = v; }))}</Row>}
          <Row title="Engraved label" status={!res || building ? '…' : !H.label.trim() ? 'off' : lab ? lab.value : '…'} why={lab && lab.value === 'left off' ? lab.detail : lab?.detail?.includes('did not fit') ? 'the full name did not fit' : undefined}>
            {toggle(!!H.label.trim(), (v) => set((h) => { h.label = v ? m.board.name.slice(0, 40) : ''; }))}
          </Row>
          {!!H.label.trim() && <div className="featsub"><Text label="Label text" value={H.label} placeholder="e.g. SENSOR HUB" onChange={(v) => set((h) => { h.label = v; })} /></div>}
          <p className="hint">Switching a kind of feature off here keeps each plug's own choice in the Plugs step for when you switch it back on.{frame ? ' Frame holders are open underneath: pull a clip back and push the board out from below, no notches needed.' : ''}</p>
        </>
      )}
      {box && <p className="hint" style={{ marginTop: 0 }}>A box sits in low guards and is strapped down, so it has no clips, notches or label. Set its ports under Board › Box.</p>}
    </Section>
  );
}

// ============================================================================================ MOUNT
export function MountPanel() {
  const p = useApp((s) => s.project)!;
  const M = p.mount, S = p.stand;
  const setM = (fn: (m: Project['mount']) => void) => edit((q) => fn(q.mount));
  const setS = (fn: (s: Project['stand']) => void) => edit((q) => fn(q.stand));
  const pick = <Seg value={p.layout} options={[['panel', 'On DIN rails'], ['loose', 'Loose holders']]} onChange={(v) => { edit((q) => { setLayout(q, v); }); store.set({ view: 'assembly' }); }} />;
  if (p.layout === 'panel') return (
    <div>
      <div style={{ marginBottom: 10 }}>{pick}</div>
      <RackBuilder />
    </div>
  );
  return (
    <div>
      <div style={{ marginBottom: 10 }}>{pick}</div>
      <p className="lede">Holders without rail docks: stack them, set them side by side or back to back, clip one flat onto a DIN rail, or give it a stand socket.</p>
      <LayoutSection />
      <Section title="DIN rail clip" toggle={{ value: M.kind === 'din', onChange: (v) => setM((m) => { m.kind = v ? 'din' : 'none'; m.picked = true; }) }}>
        {M.kind === 'din' ? (
          <>
            <p className="hint" style={{ marginTop: 0 }}><b>To remove: pull the tab towards you.</b> The lower jaw swings off the rail and the holder tilts free in the same motion. Nothing to push sideways, no screwdriver, and it works with neighbours packed tight. The clip snaps into the holder in four orientations.</p>
            <div style={{ marginTop: 8 }}><Seg value={M.mode === 'inline' ? 'rack' : M.mode} options={[['flat', 'Flat on the panel'], ['rack', 'Standing off the rail']]} onChange={(v) => setM((m) => { m.mode = v; if (v === 'rack') m.edge = quietEdge(p); })} /></div>
            <div className="row" style={{ marginTop: 8 }}>
              {M.mode === 'flat'
                ? <Pick label="Rail runs along" value={M.rotation} options={[[0, 'Board X'], [90, 'Board Y'], [180, 'Board X (flipped)'], [270, 'Board Y (flipped)']]} onChange={(v) => setM((m) => { m.rotation = v; m.at = null; })} />
                : <Pick label="Edge on the rail" value={M.edge} options={[['bottom', 'Bottom'], ['top', 'Top'], ['left', 'Left'], ['right', 'Right']]} onChange={(v) => setM((m) => { m.edge = v; })} />}
              {M.mode !== 'flat' && <Pick label="Board vs rail" value={M.rotation === 90 || M.rotation === 270 ? 90 : 0} options={[[0, 'Across the rail'], [90, 'Along the rail']]} onChange={(v) => setM((m) => { m.rotation = v as 0 | 90; })} />}
              <Pick label="Tab points" value={M.tabSide} options={[['down', 'Down'], ['up', 'Up']]} onChange={(v) => setM((m) => { m.tabSide = v; })} />
              <Num label="Clip width" value={M.clipWidth} min={10} max={30} step={1} onChange={(v) => setM((m) => { m.clipWidth = v; })} />
              <Pick label="Rail" value={M.railT} options={[[1.0, 'TS35 × 7.5 (1.0 mm)'], [1.5, 'TS35 × 15 (1.5 mm)'], [0.8, 'Thin 0.8 mm']]} onChange={(v) => setM((m) => { m.railT = v; })} />
            </div>
            {M.mode === 'flat' && (
              <div className="btns" style={{ marginTop: 8 }}>
                <span className="hint" style={{ margin: 0 }}>{M.at ? `Clip at ${round(M.at[0], 1)}, ${round(M.at[1], 1)}` : 'Clip position: automatic (clear of supports, shortest tab)'}</span>
                {M.at && <button className="btn small ghost" onClick={() => setM((m) => { m.at = null; })}>Auto</button>}
              </div>
            )}
            <p className="hint">Wider clips hold harder and release a little stiffer; the spring strain stays the same.</p>
          </>
        ) : <p className="hint" style={{ marginTop: 0 }}>No DIN clip. The flat base also sticks well with double-sided foam tape.</p>}
      </Section>
      <Section title="Stand socket (female)" toggle={{ value: S.enabled, onChange: (v) => setS((s) => { s.enabled = v; }) }}>
        {S.enabled ? (
          <>
            <div className="row">
              <Pick label="Shape" value={S.shape} options={[['round', 'Round'], ['square', 'Square'], ['hex', 'Hex'], ['d', 'D (flat)'], ['tripod', 'Tripod 1/4″-20']]} onChange={(v) => setS((s) => { s.shape = v; })} />
              {S.shape !== 'tripod' && <Num label={S.shape === 'hex' ? 'Across flats' : S.shape === 'square' ? 'Side' : 'Diameter'} value={S.size} min={2} max={40} onChange={(v) => setS((s) => { s.size = v; })} />}
              {S.shape !== 'tripod' && <Num label="Depth" value={S.depth} min={3} max={60} onChange={(v) => setS((s) => { s.depth = v; })} />}
              {S.shape !== 'tripod' && <Pick label="Axis" value={S.axis} options={[['edge', 'Out of an edge'], ['down', 'Downwards']]} onChange={(v) => setS((s) => { s.axis = v; })} />}
              <Pick label="Edge" value={S.edge} options={[['bottom', 'Bottom'], ['top', 'Top'], ['left', 'Left'], ['right', 'Right']]} onChange={(v) => setS((s) => { s.edge = v; })} />
              <Num label="Offset along edge" value={S.offset} onChange={(v) => setS((s) => { s.offset = v; })} />
            </div>
            {S.shape !== 'tripod' && (
              <>
                <div style={{ marginTop: 8 }}><Seg value={S.fit} options={[['slip', 'Slip fit'], ['press', 'Press fit (crush ribs)']]} onChange={(v) => setS((s) => { s.fit = v; })} /></div>
                {S.fit === 'slip' && <div className="row" style={{ marginTop: 8 }}><Num label="Clearance (on Ø)" value={S.clearance} min={0} max={1.5} step={0.05} onChange={(v) => setS((s) => { s.clearance = v; })} /><Num label="Socket wall" value={S.wall} min={2} max={8} onChange={(v) => setS((s) => { s.wall = v; })} /></div>}
              </>
            )}
            <p className="hint">{S.shape === 'tripod' ? 'A 1/4″-20 nut drops into a trap from the top; a camera tripod screw comes up from below.' : 'Sideways round holes are printed as teardrops (pointed top) so they need no support.'}</p>
          </>
        ) : <p className="hint" style={{ marginTop: 0 }}>Add a socket so the holder can sit on a post, rod or tripod.</p>}
      </Section>
    </div>
  );
}

// ============================================================================================ CHECK
export function CheckPanel() {
  const res = useApp((s) => s.result);
  const p = useApp((s) => s.project)!;
  const [fea, setFea] = useState<(ClipFeaResult & { loops: V2[][] }) | null>(null);
  const [feaBusy, setFeaBusy] = useState<string | null>(null);
  const [feaErr, setFeaErr] = useState<string | null>(null);
  const [fine, setFine] = useState(false);
  // the tiles filter the list: every check, only passing, only the ones to look at (failing ones always show on top)
  const [only, setOnly] = useState<'all' | 'ok' | 'warn' | 'bad'>('all');
  const sum = useMemo(() => summarizeChecks(p, res?.report), [p, res]);
  const groups = useMemo(() => {
    const g = new Map<string, NonNullable<typeof res>['report']['checks']>();
    for (const c of res?.report.checks ?? []) {
      if (c.status === 'bad' || c.status === 'warn' || (only !== 'all' && c.status !== only)) continue; // (the ones to look at have their own list)
      (g.get(c.group) ?? g.set(c.group, []).get(c.group)!).push(c);
    }
    return [...g.entries()];
  }, [res, only]);
  const tile = (k: 'ok' | 'warn' | 'bad', n: number, color: string, label: string) => (
    <button className={only === k ? 'on' : ''} aria-pressed={only === k} onClick={() => setOnly(only === k ? 'all' : k)} title={only === k ? 'Show every check' : `Show only the checks ${label}`}>
      <b style={{ color }}>{n}</b><span>{label}</span>
    </button>
  );
  const show = (module?: string) => { if (!module) return; select([{ kind: 'module', id: module }]); store.set({ view: 'assembly' }); };
  // the ones to look at: repeated lines as one row with a count, each with its verdict and the fix when there is one
  const looks = useMemo(() => collapseChecks(sum.look), [sum]);
  const pr = res?.report.panel;
  const fixOf = (r: CheckRow): { label: string; title: string; run: () => void } | null => {
    if (/^Tongue root/.test(r.c.name) && pr && p.layout === 'panel') {
      const fx = r.modules.flatMap((id) => { const f = leverFix(p, pr, id, 0.4); return f ? [f] : []; });
      if (!fx.length) return null;
      const one = fx.length === 1 ? fx[0].fix : null;
      return { label: one ? (one.lie ? `Lay it flat by its ${one.edge} edge` : `Dock it by its ${one.edge} edge`) : `Dock ${fx.length} another way`, title: 'A shorter lever onto the tongue, with no plug pointing into the table (docks along the rail slide on to make room)', run: () => dockShorterAll(fx) };
    }
    if (r.c.name === 'Material') return { label: 'Print in PETG', title: 'Every PLA holder becomes PETG', run: () => edit((q) => { for (const m of q.modules) if (m.holder.material === 'PLA') m.holder.material = 'PETG'; }) };
    if (r.c.name === 'DC inputs with no supply') return { label: 'Add a 12 V plug pack', title: "Check your board's label for its voltage first", run: () => addAccessory('dc_pack_12v') };
    return null;
  };
  const boardsOf = (r: CheckRow) => { const ns = r.modules.map((id) => p.modules.find((m) => m.id === id)?.board.name).filter(Boolean) as string[]; return ns.length > 3 ? `${ns.slice(0, 3).join(', ')} and ${ns.length - 3} more` : ns.join(', '); };
  const mat = MATERIALS[activeModule(p).holder.material];
  const run = async () => {
    setFeaErr(null);
    setFeaBusy('Meshing the clip profile…');
    try {
      const r = await runClipFea(p.mount.clipWidth, p.mount.railT, 0, undefined, mat.E, mat.nu, fine ? 0.1 : 0.2, (s) => setFeaBusy(s));
      setFea(r);
    } catch (e: any) {
      setFeaErr(e.message);
    } finally {
      setFeaBusy(null);
    }
  };
  return (
    <div>
      <div className="bigstat tiles">
        {tile('ok', sum.passing.length, 'var(--good)', 'passing')}
        {tile('warn', sum.nLook, 'var(--warn)', 'to look at')}
        {tile('bad', sum.failing.length, 'var(--bad)', 'failing')}
      </div>
      {sum.failing.length > 0 && (
        <Section title="Failing">
          {sum.failing.map((c, i) => (
            <div key={i} className="checkrow"><div className="grow">{c.name}<div className="hint">{c.group}{c.detail ? ` · ${c.detail}` : ''}</div>{c.module && <button className="btn small ghost" style={{ marginTop: 4 }} onClick={() => show(c.module)}><Icon d={I.cube} /> Show in 3D</button>}</div><Chip status={c.status}>{c.value}</Chip></div>
          ))}
        </Section>
      )}
      {only !== 'ok' && only !== 'bad' && looks.length > 0 && (
        <Section title="To look at">
          {looks.map((r, i) => {
            const v = verdictOf(r.c.name), fix = fixOf(r);
            return (
              <div key={i} className="checkrow"><div className="grow">{r.c.name}{r.n > 1 && <> <Chip>× {r.n}</Chip></>}
                <div className="hint">{r.n > 1 && boardsOf(r) ? `${boardsOf(r)} · worst: ` : ''}{r.c.detail ?? r.c.group}</div>
                <div className="verdictrow"><Chip status={v === 'OK to print' ? 'ok' : 'warn'}>{v}</Chip>
                  {fix && <button className="btn small soft" title={fix.title} onClick={fix.run}>{fix.label}</button>}
                  {r.modules.length === 1 && <button className="btn small ghost" onClick={() => show(r.modules[0])}><Icon d={I.cube} /> Show in 3D</button>}</div></div>
                <Chip status="warn">{r.c.value}</Chip></div>
            );
          })}
        </Section>
      )}
      {only !== 'ok' && sum.warnings.length > 0 && <div className="warns">{sum.warnings.map((w, i) => <div key={i}>{w} <Chip status="warn">{verdictOf(w)}</Chip></div>)}</div>}
      {only === 'bad' && !sum.failing.length && <p className="hint">Nothing is failing.</p>}
      {only !== 'bad' && groups.map(([g, list]) => (
        <Section key={g} title={g}>
          {list.map((c, i) => (
            <div key={i} className="checkrow"><div className="grow">{c.name}{c.detail && <div className="hint">{c.detail}</div>}</div><Chip status={c.status}>{c.value}</Chip></div>
          ))}
        </Section>
      ))}
      {sum.reminders.length > 0 && (
        <details className="reminders">
          <summary>{sum.reminders.length} reminder{sum.reminders.length === 1 ? '' : 's'} from the boards' templates</summary>
          {sum.reminders.map((r, i) => (
            <div key={i} className="checkrow"><div className="grow hint" style={{ marginTop: 0 }}>{r.text}</div>
              <button className="btn small" title="Tick it off once you've done it: it stops showing here" onClick={() => edit((q) => ackNote(q, r.modules, r.note))}><Icon d={I.check} /> Done</button></div>
          ))}
        </details>
      )}
      <p className="hint">Hand calculations for every spring and snap, plus finite-element models of the clips. Linear and idealised: print the test-fit kit before a batch.</p>
      <PrintCheckSection />
      {p.layout === 'panel' && <DockFeaSection />}
      {(p.layout === 'loose' ? p.mount.kind === 'din' : !!res?.report.panel?.mounts.some((m) => m.kind === 'flat')) && (
        <Section title="Flat DIN clip FEA">
          <p className="hint" style={{ marginTop: 0 }}>2D plane-stress model of the clip profile ({p.mount.clipWidth} mm wide, {activeModule(p).holder.material}): incompatible-mode quads, checked against beam theory in the test suite.</p>
          <div className="btns" style={{ alignItems: 'center' }}>
            <button className="btn primary" disabled={!!feaBusy} onClick={run}>{feaBusy ? 'Running…' : 'Run clip FEA'}</button>
            <Check label="Fine mesh (0.1 mm, ~30 s)" value={fine} onChange={setFine} />
          </div>
          {feaBusy && <><div className="progress" style={{ marginTop: 8 }}><div /></div><p className="hint">{feaBusy}</p></>}
          {feaErr && <div className="err" style={{ marginTop: 8 }}>{feaErr}</div>}
          {fea && <FeaResult r={fea} allow={mat.strainAllow} W={p.mount.clipWidth} tf={p.mount.railT} />}
        </Section>
      )}
    </div>
  );
}

function FeaResult({ r, allow, W, tf }: { r: ClipFeaResult & { loops: V2[][] }; allow: number; W: number; tf: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const d = clipDims({ W, tf, tabExt: 0 });
  useMemo(() => setTimeout(() => {
    const cv = canvas.current;
    if (!cv) return;
    const f = r.field;
    const s = 6;
    cv.width = f.nx * s * 0.5; cv.height = f.ny * s * 0.5;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#0a0f14'; g.fillRect(0, 0, cv.width, cv.height);
    const k = s * 0.5;
    for (let e = 0; e < f.elems.length; e++) {
      const ge = f.elems[e], i = ge % f.nx, j = Math.floor(ge / f.nx);
      const t = Math.min(1, f.strain[e] / allow);
      g.fillStyle = heat(t);
      g.fillRect(i * k, (f.ny - 1 - j) * k, k + 0.5, k + 0.5);
    }
  }, 0), [r]);
  return (
    <div style={{ marginTop: 10 }}>
      <canvas ref={canvas} className="heat" />
      <p className="hint">Strain while releasing, as a fraction of the {(allow * 100).toFixed(1)}% limit: blue low, red at the limit. Mesh {r.mesh.h} mm, {r.mesh.elements.toLocaleString()} elements.</p>
      <table className="table"><tbody>
        <tr><th>Case</th><th className="num">Force</th><th className="num">Peak / 99%</th></tr>
        {r.cases.map((c, i) => (
          <tr key={i}><td>{c.name}<div className="hint" style={{ marginTop: 2 }}>{c.target}</div></td><td className="num">{c.force.toFixed(1)} N</td>
            <td className="num"><Chip status={c.peakStrain <= allow ? 'ok' : c.peakStrain <= allow * 1.15 ? 'warn' : 'bad'}>{(c.peakStrain * 100).toFixed(2)}%</Chip><div className="hint">{(c.p99Strain * 100).toFixed(2)}%</div></td></tr>
        ))}
      </tbody></table>
      <div className="kv" style={{ marginTop: 8 }}>
        <span>Lip engagement</span><span>{d.eL} mm behind the flange</span>
        <span>Travel stop</span><span>lip travel {r.lipAtStop.toFixed(2)} mm when the jaw hits the stop (clears the flange by {(r.lipAtStop - d.eL).toFixed(2)} mm)</span>
        <span>Pull-off path</span><span>tongue moves {Math.abs(r.tongueMoveAtRelease).toFixed(2)} mm of its 0.30 mm gap while releasing, so it never binds</span>
      </div>
      <p className="hint">Peak strain sits at the root of the leaf spring, and 99% of the part stays far lower. Forces scale with clip width.</p>
    </div>
  );
}

function heat(t: number) {
  const stops = [[30, 64, 175], [34, 197, 164], [250, 204, 21], [244, 63, 94]];
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ============================================================================================ EXPORT
export function ExportPanel() {
  const p = useApp((s) => s.project)!;
  const res = useApp((s) => s.result);
  const [copies, setCopies] = useState(1);
  const setP = (fn: (x: Project['printer']) => void) => edit((q) => fn(q.printer));
  const d = useMemo(() => (res ? delta(p, res) : null), [res, p.built]);
  // what to print: everything, only what is new since the rack was built, or just some boards
  // coming from "Print its holder" (a new version of a board): just that board, without its dock (the one on the
  // rack stays); on a built rack "What's new" already lists exactly its new parts
  const pick0 = useApp((s) => s.exportPick);
  const [scopeSel, setScope] = useState<'all' | 'new' | 'pick' | null>(() => (pick0 ? (p.built ? 'new' : 'pick') : null));
  const scope = scopeSel ?? (d?.any ? 'new' : 'all');
  const [picked, setPicked] = useState<string[]>(() => pick0 ?? [activeModule(p).id]);
  const [withDocks, setWithDocks] = useState(() => !pick0);
  useEffect(() => { if (pick0) store.set({ exportPick: null }); }, []);
  const [withStands, setWithStands] = useState(false);
  const pickSet = useMemo(() => new Set(picked.flatMap((id) => { const m = p.modules.find((x) => x.id === id); return m ? [id, ...ridersOf(p, m).map((r) => r.id)] : []; })), [picked, p.modules]);
  const onlyNew = scope === 'new' && !!d;
  const parts = useMemo(() => (!res ? [] : onlyNew ? d!.parts : scope === 'pick' ? partsFor(res, pickSet, { docks: withDocks, stands: withStands }) : res.parts), [res, onlyNew, d, scope, pickSet, withDocks, withStands]);
  useEffect(() => { store.set({ printParts: scope === 'all' ? null : parts }); }, [parts, scope]);
  useEffect(() => () => store.set({ printParts: null }), []);
  // the footer's Download button
  const zipRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const f = () => (zipRef.current ? zipRef.current() : toast('Still building: the download is ready in a moment.'));
    window.addEventListener('boarddock:download', f);
    return () => window.removeEventListener('boarddock:download', f);
  }, []);
  const plates = useMemo(() => packPlates(parts, p.printer.bed, p.printer.spacing, copies), [parts, p.printer.bed[0], p.printer.bed[1], p.printer.spacing, copies]);
  const dens = MATERIALS[activeModule(p).holder.material].density;
  const est = useMemo(() => parts.map((x) => ({ part: x, ...estimate(x, dens) })), [parts, dens]);
  const tot = est.reduce((a, e) => ({ g: a.g + e.grams * e.part.qty * copies, m: a.m + e.minutes * e.part.qty * copies }), { g: 0, m: 0 });
  const base = safeName(rackName(p));
  const plateMeshes = (i: number) => plates[i].items.map((it) => placedMesh(it, p.printer.bed, plates[i].used));
  const brim = tallness(parts, p.printer.maxZ ?? 250).tall.length > 0;
  // slicing lives here so the buttons below and the G-code section see the same slices
  const g = useGcode({ plates: plates.length, plateKey: plates, fits: plates.map((pl) => fitsBed(pl, p.printer.bed)), plateMeshes, brim, base });
  zipRef.current = null;
  if (!res) return <div><p className="lede">Building…</p></div>;
  /** The G-code of every plate, sliced here first if it isn't yet (in the background: the page stays usable). */
  const sliceAll = async () => {
    if (g.busy) { toast('Slicing is still running: this downloads when it is done.'); return null; }
    const todo = plates.filter((_, i) => !g.done[i] && g.ok(i)).length;
    if (todo > 0) toast(`Slicing ${todo} plate${todo > 1 ? 's' : ''} in the background. The download starts when ${todo > 1 ? 'they are' : 'it is'} done: you can keep working.`);
    const r = await g.sliceAll();
    if (r.bad.length) toast(`${r.bad.length > 1 ? 'Plates' : 'Plate'} ${r.bad.map((b) => b.i + 1).join(', ')} could not be sliced (${r.bad[0].why}).${Object.keys(r.files).length ? ' The rest are in the download.' : ''}`);
    return r.files;
  };
  const gcodeZip = async () => {
    const files = await sliceAll();
    if (files && Object.keys(files).length) download(`${base}_gcode.zip`, zipSync(files, { level: 6 }), 'application/zip');
  };
  const zipAll = async () => {
    const gcode = g.canSlice ? await sliceAll() : null;
    if (g.canSlice && !gcode) return;
    const files: Record<string, Uint8Array> = {};
    plates.forEach((pl, i) => {
      files[`plate_${i + 1}.stl`] = writeStl(plateMeshes(i));
      files[`plate_${i + 1}.3mf`] = write3mf(pl.items.map((it, k) => ({ name: `${it.part.name} ${k + 1}`, mesh: placedMesh(it, p.printer.bed, pl.used) })));
    });
    for (const x of parts) files[`parts/${safeName(x.id)}_${safeName(x.name)}.stl`] = writeStl([x.mesh]);
    files[`${base}.boarddock.json`] = strToU8(JSON.stringify(p, null, 1));
    files['BOM.csv'] = strToU8(bomCsv(billOfMaterials(p, res)));
    for (const [name, bytes] of Object.entries(gcode ?? {})) files[`gcode/${name}`] = bytes;
    const pr = printerByName(p.printer.name), mat = activeModule(p).holder.material;
    const settings = [`Print settings (${pr?.name ?? p.printer.name}, ${mat}${pr ? `, printer preset "${pr.orca}"` : ''}):`, ...printSettings(pr, mat, tallness(parts, p.printer.maxZ ?? 250).tall).map((r) => `  ${r.name}: ${r.value}  (${r.basis}: ${r.why})`)].join('\n');
    files['README.txt'] = strToU8(printNotes(p, res, plates.length, tot, shopping(p, res, onlyNew ? d : null, tot, scope === 'pick' ? pickSet : undefined)).replace('Print: 0.2 mm layers, 3 walls, 15% infill, NO supports. Parts are already in print orientation.', settings));
    download(`${base}_boarddock${onlyNew ? '_new-parts' : scope === 'pick' ? '_some-boards' : ''}.zip`, zipSync(files), 'application/zip');
  };
  zipRef.current = zipAll;
  return (
    <div>
      {p.built && <BuildSection d={d} />}
      <Section title="What to print" right={<span className="chip">{parts.reduce((a, x) => a + x.qty, 0)} parts</span>}>
        <Seg value={scope} options={[['all', 'Everything'], ...(p.built ? [['new', "What's new"] as ['new', string]] : []), ['pick', 'Some boards']]} onChange={setScope} />
        {scope === 'pick' && (
          <div className="picklist">
            {p.modules.filter((m) => stackBase(p, m) === m).map((m) => {
              const rs = ridersOf(p, m);
              return <Check key={m.id} label={<>{m.board.name}{rs.length > 0 && <small> with {rs.map((r) => r.board.name).join(', ')}</small>}</>} value={picked.includes(m.id)} onChange={(v) => setPicked((x) => (v ? [...x, m.id] : x.filter((y) => y !== m.id)))} />;
            })}
            <div className="btns"><button className="btn small ghost" onClick={() => setPicked(p.modules.map((m) => m.id))}>All</button><button className="btn small ghost" onClick={() => setPicked([])}>None</button><button className="btn small ghost" onClick={() => setPicked([activeModule(p).id])}>Just {activeModule(p).board.name}</button></div>
            {p.layout === 'panel' && (
              <div className="picklist-opts">
                <Check label="Their docks (rail shoe and socket)" value={withDocks} onChange={setWithDocks} />
                <Check label="Table stands" value={withStands} onChange={setWithStands} />
              </div>
            )}
          </div>
        )}
        <p className="hint">{scope === 'all' ? 'Every part of the rack.' : scope === 'new' ? (d?.any ? 'Only the parts added or changed since you marked the rack as built.' : 'Nothing is new since the rack was built.') : picked.length ? 'Just the holders (and plug caps and release rods) of the boards you tick, with anything stacked on them.' : 'Tick the boards to print.'} The plates, the estimate, the download and the plates view all follow this.</p>
      </Section>
      <div className="bigstat">
        <div><b>{plates.length}</b><span>plate{plates.length === 1 ? '' : 's'}{onlyNew ? ', new parts' : scope === 'pick' ? ', chosen boards' : ''}</span></div>
        <div><b>{tot.g.toFixed(0)} g</b><span>{activeModule(p).holder.material}</span></div>
        <div><b>{fmtMin(tot.m)}</b><span>print time, rough</span></div>
      </div>
      {(() => {
        const what = scope === 'all' ? 'Download everything' : scope === 'new' ? "Download what's new" : 'Download these';
        const wait = g.busy ? `Slicing plate ${Math.min(g.queue ? g.queue.k + 1 : (g.prog?.i ?? 0) + 1, plates.length)} of ${plates.length}…` : null;
        // once the start code is known the main button slices (the STLs, 3MFs and the rest are in the other one)
        return g.canSlice ? (
          <div style={{ marginBottom: 10 }}>
            <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={g.busy} onClick={() => gcodeZip()}><Icon d={I.download} /> {wait ?? 'Slice and download all G-code (.zip)'}</button>
            <button className="btn soft" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} disabled={g.busy} onClick={() => zipAll()}><Icon d={I.download} /> {what} with the G-code (.zip)</button>
            <p className="hint" style={{ margin: '6px 0 0' }}>The G-code is sliced here with the start code below, plate by plate, in the background (a plate takes from several seconds to a minute or two).</p>
          </div>
        ) : (
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }} onClick={() => zipAll()}><Icon d={I.download} /> {what} (.zip)</button>
        );
      })()}
      <Section title="Printer">
        <Pick label="Printer" value={p.printer.name} options={[...PRINTERS.map((x) => [x.name, x.name] as [string, string]), ['Custom', 'Custom']]} onChange={(v) => {
          // code loaded from now on says which printer it was for (the check stops it on another); an older project's doesn't, so it goes
          const unknown = v !== p.printer.name && !!p.printer.bambu && !p.printer.bambu.for;
          setP((x) => { rememberPrinter(v); const pr = PRINTERS.find((q) => q.name === v); delete x.gcodeStart; delete x.gcodeEnd; delete x.gcodeOk; if (unknown) delete x.bambu; if (pr) Object.assign(x, { ...pr, spacing: x.spacing }); else x.name = 'Custom'; });
          if (unknown) toast("The printer's own start code kept in this project didn't say which printer it was for, so it was dropped: load it again for this printer.");
        }} />
        <div className="row3" style={{ marginTop: 8 }}>
          <Num label="Bed X" value={p.printer.bed[0]} min={50} onChange={(v) => setP((x) => { x.bed = [v, x.bed[1]]; x.name = 'Custom'; })} />
          <Num label="Bed Y" value={p.printer.bed[1]} min={50} onChange={(v) => setP((x) => { x.bed = [x.bed[0], v]; x.name = 'Custom'; })} />
          <Num label="Spacing" value={Math.max(p.printer.spacing, MIN_SPACING)} min={MIN_SPACING} max={20} hint={`Room between parts: never less than ${MIN_SPACING.toFixed(1)} mm, so neighbouring brims don't run together`} onChange={(v) => setP((x) => { x.spacing = v; })} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <Num label="Build height" value={p.printer.maxZ ?? 250} min={50} max={1000} step={1} onChange={(v) => setP((x) => { x.maxZ = v; x.name = 'Custom'; })} />
          <Num label="Sets to print" unit="" step={1} min={1} max={50} value={copies} onChange={(v) => setCopies(Math.round(v))} />
        </div>
        {(() => { const pr = printerByName(p.printer.name); return pr ? <p className="hint">{pr.kind === 'corexy' ? 'CoreXY' : 'Bed-slinger'}, {pr.extruder === 'direct' ? 'direct drive' : 'bowden'}, {pr.firmware === 'bambu' ? 'Bambu firmware' : pr.firmware === 'klipper' ? 'Klipper' : 'Marlin'}. Profiles in {pr.slicers.join(' and ')}.</p> : null; })()}
      </Section>
      <Section title={`${plates.length} plate${plates.length > 1 ? 's' : ''}`}>
        <div className="plates">
          {plates.map((pl, i) => {
            const big = !fitsBed(pl, p.printer.bed);
            return (
            <div key={i} className={`plate ${big ? 'toobig' : ''}`}>
              <PlateThumb pl={pl} bed={p.printer.bed} />
              {big && <div className="err" style={{ marginTop: 6 }}>{pl.items[0].part.name} is {Math.round(pl.used[0])} × {Math.round(pl.used[1])} mm: bigger than the {p.printer.name} bed ({p.printer.bed[0]} × {p.printer.bed[1]} mm). Pick a printer with a bigger bed above, or turn the board so its holder is smaller (Board step).</div>}
              {!big && pl.edge < BRIM_OUT + EDGE_CLEAR && <div className="hint" style={{ marginTop: 6 }}>{pl.items[0].part.name} leaves {Math.max(0, pl.edge).toFixed(1)} mm to the nearest bed edge, too tight for a brim or skirt ({(BRIM_OUT + EDGE_CLEAR).toFixed(1)} mm). The app slices this plate without one; in your own slicer, leave the brim off it.</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <span>Plate {i + 1} · {pl.items.length} part{pl.items.length === 1 ? '' : 's'}{big ? ' · does not fit' : ''}</span>
                <span className="btns"><button className="btn small" onClick={() => download(`${base}_plate${i + 1}.stl`, writeStl(plateMeshes(i)))}>STL</button><button className="btn small" onClick={() => download(`${base}_plate${i + 1}.3mf`, write3mf(pl.items.map((it, k) => ({ name: `${it.part.name} ${k + 1}`, mesh: placedMesh(it, p.printer.bed, pl.used) }))))}>3MF</button></span>
              </div>
            </div>
            );
          })}
        </div>
        <div className="btns" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => download(`${base}.boarddock.json`, JSON.stringify(p, null, 1), 'application/json')}>Save project</button>
          <button className="btn ghost" onClick={() => store.set({ view: 'print' })}>Show plates in 3D</button>
        </div>
      </Section>
      <ShoppingList p={p} lines={shopping(p, res, onlyNew ? d : null, tot, scope === 'pick' ? pickSet : undefined)} />
      <BomSection p={p} res={res} base={base} />
      {!p.built && <BuildSection d={d} />}
      {p.layout === 'panel' && <TestKitSection />}
      <Section title="Estimate">
        <table className="table"><tbody>
          <tr><th>Part</th><th className="num">Qty</th><th className="num">Filament</th><th className="num">Time</th></tr>
          {est.map((e) => <tr key={e.part.id}><td>{e.part.name}</td><td className="num">{e.part.qty * copies}</td><td className="num">{e.grams.toFixed(1)} g</td><td className="num">{fmtMin(e.minutes)}</td></tr>)}
          <tr><td><b>Total</b></td><td /><td className="num"><b>{tot.g.toFixed(0)} g</b></td><td className="num"><b>{fmtMin(tot.m)}</b></td></tr>
        </tbody></table>
        <p className="hint">Rough: 3 walls, 5 top/bottom layers, 15% infill, 0.2 mm layers, {activeModule(p).holder.material}. Your slicer's numbers are the real ones.</p>
      </Section>
      <PrintSettings parts={parts} />
      <GcodeSection g={g} plates={plates.length} plateKey={plates} fits={plates.map((pl) => fitsBed(pl, p.printer.bed))} plateMeshes={plateMeshes} brim={brim} plate3mf={(i) => write3mf(plates[i].items.map((it, k) => ({ name: `${it.part.name} ${k + 1}`, mesh: placedMesh(it, p.printer.bed, plates[i].used) })))} base={base} />
    </div>
  );
}

/** Parts that stand much taller than they are wide (a brim helps), and parts too tall for the printer. */
function tallness(parts: PartOut[], maxZ: number) {
  const tall = [...new Set(parts.filter((x) => x.size[2] > 20 && x.size[2] > 3 * Math.min(x.size[0], x.size[1])).map((x) => x.name.replace(/\s*\(.*$/, '')))];
  const tooTall = parts.filter((x) => x.size[2] > maxZ).map((x) => `${x.name} (${Math.round(x.size[2])} mm)`);
  return { tall, tooTall };
}

/** Slicer settings for this printer and filament, each marked by where it comes from. */
function PrintSettings({ parts }: { parts: PartOut[] }) {
  const p = useApp((s) => s.project)!;
  const mat = activeModule(p).holder.material;
  const pr = printerByName(p.printer.name);
  const { tall, tooTall } = tallness(parts, p.printer.maxZ ?? pr?.maxZ ?? 250);
  const rows = printSettings(pr, mat, tall);
  const [where, setWhere] = useState<'orca' | 'prusa'>(pr?.slicers[0] === 'PrusaSlicer' ? 'prusa' : 'orca');
  const text = () => [`BoardDock print settings: ${pr?.name ?? p.printer.name}, ${mat}`, pr ? `Printer preset: ${pr.orca}` : '', ...rows.map((r) => `${r.name}: ${r.value}  [${r.basis}: ${r.why}]`)].filter(Boolean).join('\n');
  return (
    <Section title="Print settings" right={<button className="btn small ghost" onClick={() => { navigator.clipboard?.writeText(text()); toast('Print settings copied.'); }}>Copy</button>}>
      <p className="hint" style={{ marginTop: 0 }}>{pr ? <>In {pr.slicers.join(' or ')}, pick the <b>{pr.orca}</b> printer preset and a generic {mat} filament, then set these:</> : <>Pick your printer's preset and a generic {mat} filament, then set these:</>}</p>
      {tooTall.length > 0 && <div className="warns" style={{ marginTop: 8 }}><div>Taller than the {p.printer.maxZ ?? pr?.maxZ} mm build height: {tooTall.join(', ')}.</div></div>}
      <table className="table settings"><tbody>
        {rows.map((r) => (
          <tr key={r.name} title={`${r.why}. ${where === 'orca' ? 'OrcaSlicer / Bambu Studio' : 'PrusaSlicer'}: ${where === 'orca' ? r.orca : r.prusa}`}>
            <td>{r.name}<div className="where">{where === 'orca' ? r.orca : r.prusa}</div></td>
            <td className="val">{r.value}</td>
            <td><span className={`basis ${r.basis}`}>{r.basis === 'design' ? 'design' : r.basis === 'vendor' ? 'profile' : 'convention'}</span></td>
          </tr>
        ))}
      </tbody></table>
      <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
        <Seg value={where} options={[['orca', 'OrcaSlicer, Bambu Studio'], ['prusa', 'PrusaSlicer']]} onChange={setWhere} />
      </div>
      <p className="hint"><b>design</b>: the parts need it. <b>profile</b>: OrcaSlicer's generic {mat} profile or your printer's machine profile. <b>convention</b>: common practice, not a tested requirement. Nothing has been print-tested yet: print the test-fit kit first.</p>
    </Section>
  );
}

function fmtMin(m: number) { const t = Math.round(m); return t < 60 ? `${t} min` : `${Math.floor(t / 60)} h ${t % 60} min`; }

function PlateThumb({ pl, bed }: { pl: ReturnType<typeof packPlates>[number]; bed: V2 }) {
  const cx = (bed[0] - pl.used[0]) / 2, cy = (bed[1] - pl.used[1]) / 2;
  return (
    <svg viewBox={`0 0 ${bed[0]} ${bed[1]}`}>
      {pl.items.map((it, i) => {
        const bbx = { w: 0, h: 0 };
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let k = 0; k < it.part.mesh.pos.length; k += 3) { x0 = Math.min(x0, it.part.mesh.pos[k]); x1 = Math.max(x1, it.part.mesh.pos[k]); y0 = Math.min(y0, it.part.mesh.pos[k + 1]); y1 = Math.max(y1, it.part.mesh.pos[k + 1]); }
        bbx.w = it.rot90 ? y1 - y0 : x1 - x0; bbx.h = it.rot90 ? x1 - x0 : y1 - y0;
        return <rect key={i} x={it.x + cx} y={bed[1] - (it.y + cy) - bbx.h} width={bbx.w} height={bbx.h} rx={2} fill={it.part.color} fillOpacity={0.75} />;
      })}
    </svg>
  );
}

/** One step of What's new: tick it off as you go (the ticks are only on this screen), with what to print for it. */
function PlanItem({ st }: { st: Delta['plan'][number] }) {
  const [done, setDone] = useState(false);
  return (
    <li className={`${st.kind}${done ? ' done' : ''}`}>
      <label><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /><span>{st.text}</span></label>
      {st.parts && st.parts.length > 0 && <ul className="deltaparts">{st.parts.map((x, k) => <li key={k}>Print {x.name}{x.qty > 1 ? ` ×${x.qty}` : ''}</li>)}</ul>}
    </li>
  );
}

/** Mark the rack as built, and what is new since. */
function BuildSection({ d }: { d: Delta | null }) {
  const p = useApp((s) => s.project)!;
  if (!p.built) return (
    <Section title="Built it?">
      <p className="hint" style={{ marginTop: 0 }}>Once you have printed and put the rack together, mark it as built. BoardDock then keeps every board, dock and rail where it is when you add boards later, and this step lists only the new parts, cables and rails.</p>
      <button className="btn soft" onClick={markBuilt}>Mark the rack as built</button>
    </Section>
  );
  const when = new Date(p.built.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <Section title={`Built ${when}`} right={<button className="btn small ghost" title="Forget what was built: Export lists everything again" onClick={unmarkBuilt}>Forget</button>}>
      {d && d.any ? (
        <>
          <p className="hint" style={{ marginTop: 0 }}>Since then {[d.boards.length ? `you added ${d.boards.join(', ')}` : '', d.removed.length ? `took off ${d.removed.join(', ')}` : '', d.revised.length ? `swapped in a new version of ${d.revised.join(', ')}` : ''].filter(Boolean).join(', ').replace(/^(took|swapped)/, 'you $1') || 'the rack changed'}. On the rack:</p>
          <ol className="deltaplan">
            {d.plan.map((st, i) => <PlanItem key={`${i}:${st.text}`} st={st} />)}
          </ol>
          {d.parts.length > 0 && <p className="hint">{d.parts.reduce((a, x) => a + x.qty, 0)} new part{d.parts.reduce((a, x) => a + x.qty, 0) > 1 ? 's' : ''} to print in all: <b>What's new</b> above picks just these for the plates.</p>}
          <div className="btns" style={{ marginTop: 8 }}><button className="btn small soft" onClick={markBuilt}>I've built these too</button></div>
        </>
      ) : <p className="hint" style={{ marginTop: 0 }}>Nothing new to print, cut or buy since then. Add a board and this lists just what it needs.</p>}
    </Section>
  );
}

type Res = NonNullable<ReturnType<typeof store.get>['result']>;
/** Everything to print, cut and buy (or only what's new since the rack was built). */
export function shopping(p: Project, res: Res, d: Delta | null, tot: { g: number; m: number }, pick?: Set<string>): { head: string; items: string[] }[] {
  const out: { head: string; items: string[] }[] = [];
  // a bolted board: a standoff on each hole it shares with the board below, a screw in each end, sized from the holes
  const bolts = (m: Project['modules'][number]) => {
    const h = stackHardware(p, m);
    if (!h) return null;
    const below = p.modules.find((x) => x.id === m.on)?.board.name ?? 'its board';
    return `${h.n} × ${h.size} standoff, ${h.gap} mm, and ${h.screws} × ${h.size} screw (${m.board.name} on ${below}: ${h.shared ? `the ${h.n} holes they share` : 'no holes line up, so check where yours go'})`;
  };
  if (pick) {
    const other: string[] = [], strap = new Set(strapBoxes(p, res.report.panel).map((x) => x.id));
    for (const m of p.modules.filter((x) => pick.has(x.id))) {
      if (strap.has(m.id)) other.push(`12 mm hook-and-loop strap for the ${m.board.name}`);
      const b = m.on && pick.has(m.on) ? bolts(m) : null;
      if (b) other.push(b);
    }
    if (other.length) out.push({ head: 'Hardware', items: other });
    out.push({ head: 'Filament', items: [`about ${tot.g.toFixed(0)} g of ${activeModule(p).holder.material} (roughly ${fmtMin(tot.m)} of printing)`] });
    return out;
  }
  const count = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return [...m.entries()].map(([k, n]) => `${n} × ${k}`); };
  if (d && (d.removed.length || d.moved.length || d.slid.length || d.spareCables.length)) out.push({ head: 'On the rack', items: [
    ...d.removed.map((n) => `Take off ${n}`),
    ...d.moved.map((m) => `Move ${m.name} from ${m.from} to ${m.to}`),
    ...d.slid.map((x) => `Slide dock ${x.dock} along ${x.rail} to ${Math.round(x.to)} mm (it is at ${Math.round(x.from)} mm)`),
    ...d.spareCables.map((c) => `Cable ${c.no != null ? `#${c.no} ` : ''}(${c.a} to ${c.b}) is no longer used`),
  ] });
  const rails = d ? d.rails.map((r) => r.length) : (res.report.panel?.rails ?? []).map((r) => r.length);
  if (rails.length) out.push({ head: 'Rails', items: count(rails.map((l) => `DIN rail (TS35 top-hat, 35 × 7.5 mm), cut to ${Math.round(l)} mm`)) });
  // loose holders on their DIN clips go on a rail you have (or cut to suit): BoardDock doesn't lay that rail out
  else if (p.layout === 'loose' && p.mount.kind === 'din' && !d) out.push({ head: 'Rails', items: ['a TS35 DIN rail (the 35 mm top-hat rail), long enough for the clipped holders'] });
  // the same cable list as Plugs › Cables to buy (a probe's ribbon and a plug pack's lead come with them)
  const cl = cableLines(p, d ? d.cables : res.report.cables ?? [], !!d);
  if (cl.buy.length) out.push({ head: 'Cables', items: cl.buy });
  const newIds = new Set(p.built ? p.modules.filter((m) => !p.built!.boards.includes(m.id)).map((m) => m.id) : p.modules.map((m) => m.id));
  const mods = p.modules.filter((m) => !d || newIds.has(m.id));
  const other: string[] = [];
  // straps: one line with the total, the lengths per box after it (only boxes that get a holder: not a plug pack)
  const straps = strapBoxes(p, res.report.panel).filter((m) => mods.includes(m)).map((m) => { const b = m.board.box; return { name: m.board.name, per: b ? Math.ceil((2 * (b.w + b.h) + 80) / 50) * 5 : 30 }; });
  if (straps.length) {
    const lo = Math.min(...straps.map((x) => x.per)), hi = Math.max(...straps.map((x) => x.per)), all = straps.reduce((a, x) => a + 2 * x.per, 0);
    other.push(`${2 * straps.length} × 12 mm hook-and-loop strap, ${lo === hi ? `about ${lo} cm` : `${lo} to ${hi} cm`} each (${(all / 100).toFixed(1)} m in all, or a roll to cut): 2 for each of ${straps.length > 3 ? `the ${straps.length} boxes` : straps.map((x) => x.name).join(', ')}`);
  }
  for (const m of mods) { const b = m.on && stackBase(p, m) !== m ? bolts(m) : null; if (b) other.push(b); }
  for (const h of poeHats({ ...p, modules: mods })) other.push(`${h.qty} × ${h.item}: ${h.note}`);
  if (other.length) out.push({ head: 'Hardware', items: other });
  const adapters = new Map<string, string[]>();
  for (const l of p.links ?? []) {
    if (l.kind !== 'debug') continue;
    const end = (r: typeof l.a) => { const m = findModule(p, r.module); return m && { m, c: m.board.comps.find((x) => x.ref === baseRef(r.ref)) }; };
    const A = end(l.a), B = end(l.b);
    if (!A?.c || !B?.c || !mods.some((m) => m === A.m || m === B.m)) continue;
    const [pr, bd] = isProbe(A.m) ? [A, B] : [B, A];
    const need = adapterFor(pr.c!, bd.c!);
    if (need) adapters.set(need, [...(adapters.get(need) ?? []), pr.m.board.name]);
  }
  if (adapters.size) out.push({ head: 'Debug probes', items: [...adapters.entries()].map(([k, who]) => `${who.length} × ${k} (${who.length > 2 ? `${who.length} probes` : who.join(', ')})`) });
  out.push({ head: 'Filament', items: [`about ${tot.g.toFixed(0)} g of ${activeModule(p).holder.material} (roughly ${fmtMin(tot.m)} of printing)`] });
  return out;
}

/** The bill of materials: the whole rack, every group with its quantities (folded away: it is long), and as a CSV. */
function BomSection({ p, res, base }: { p: Project; res: Res; base: string }) {
  const bom = useMemo(() => billOfMaterials(p, res), [p, res]);
  return (
    <Section title="Bill of materials" right={<button className="btn ghost small" title="The bill of materials as a spreadsheet (CSV)" onClick={() => download(`${base}_bom.csv`, bomCsv(bom), 'text/csv')}>CSV</button>}>
      <details className="bom">
        <summary>Everything the rack is made of, and how many: {bom.reduce((n, g) => n + g.rows.length, 0)} lines</summary>
        <table className="table"><tbody>
          {bom.map((g) => [
            <tr key={g.head}><th colSpan={3}>{g.head}</th></tr>,
            ...g.rows.map((r, i) => <tr key={`${g.head}${i}`}><td className="num">{r.qty}</td><td>{r.item}</td><td style={{ color: 'var(--subtle)' }}>{r.note ?? ''}</td></tr>),
          ])}
        </tbody></table>
      </details>
      <p className="hint">The build guide's printout ends with this list, and the download has it as BOM.csv.</p>
    </Section>
  );
}

function ShoppingList({ p, lines }: { p: Project; lines: { head: string; items: string[] }[] }) {
  const rail = lines.some((g) => g.head === 'Rails');
  const loose = p.layout === 'loose', nLinks = (p.links ?? []).length;
  return (
    <Section title="Shopping list" right={<ChecklistButton />}>
      {lines.map((g) => (
        <div key={g.head} style={{ marginBottom: 6 }}>
          <div className="field"><span>{g.head}</span></div>
          <ul className="fmt" style={{ marginTop: 2 }}>{g.items.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      ))}
      {loose && nLinks > 0 && <p className="hint">Loose holders' cables aren't routed or sized, so there are no cables here: lay the boards out on your bench and measure the {nLinks === 1 ? 'one' : nLinks} you need before you buy {nLinks === 1 ? 'it' : 'them'}. On DIN rails BoardDock routes and sizes every cable.</p>}
      <p className="hint">No screws hold any printed part: the list above is all you need besides a printer{rail ? ' and a hacksaw for the rail' : ''}.</p>
    </Section>
  );
}

function printNotes(p: Project, res: Res, nPlates: number, tot: { g: number; m: number }, shop: { head: string; items: string[] }[]) {
  if (res.steps?.length) {
    const steps = [...res.steps].sort((a, b) => a.seq - b.seq);
    return [
      `BoardDock export: ${p.modules.map((m) => m.board.name).join(' + ')}`,
      `${nPlates} plate(s), about ${tot.g.toFixed(0)} g of ${activeModule(p).holder.material}, about ${fmtMin(tot.m)}.`,
      '',
      'Print: 0.2 mm layers, 3 walls, 15% infill, NO supports. Parts are already in print orientation.',
      '',
      'Shopping list:',
      ...shop.flatMap((g) => [`  ${g.head}:`, ...g.items.map((x) => `    - ${x}`)]),
      '',
      'Parts:',
      ...res.parts.map((x) => `  - ${x.name} x${x.qty}: ${(x.volume / 1000).toFixed(2)} cm3, ${x.size.map((v) => v.toFixed(0)).join(' x ')} mm`),
      '',
      'Assembly (the play button in the 3D view shows each step):',
      ...steps.map((s, i) => `  ${i + 1}. ${s.text}`),
      '',
      'Checks:',
      ...res.report.checks.map((c) => `  [${c.status}] ${c.group} / ${c.name}: ${c.value}${c.detail ? ` (${c.detail})` : ''}`),
      ...(res.report.warnings.length ? ['', 'Warnings:', ...res.report.warnings.map((w) => `  - ${w}`)] : []),
    ].join('\n');
  }
  const clip = p.mount.kind === 'din';
  const lines = [
    `BoardDock export: ${p.modules.map((m) => m.board.name).join(' + ')}`,
    `${nPlates} plate(s), about ${tot.g.toFixed(0)} g of ${activeModule(p).holder.material}, about ${fmtMin(tot.m)}.`,
    '',
    'Print: 0.2 mm layers, 3 walls, 15% infill, NO supports. Parts are already in print orientation.',
    '',
    'Parts:',
    ...res.parts.map((x) => `  - ${x.name} x${x.qty}: ${(x.volume / 1000).toFixed(2)} cm3, ${x.size.map((v) => v.toFixed(0)).join(' x ')} mm`),
    '',
    'Assembly:',
    ...[
      ...(clip ? ['Press the DIN clip into the holder until both hooks click (any of 4 orientations).'] : []),
      'Press the board in: it clicks under the spring clips (or onto the snap pins).',
      ...(p.modules.length > 1 ? [p.arrange.mode === 'stack' ? 'Stack: press each layer onto the corner pegs of the layer below.' : p.arrange.mode === 'side' ? 'Side by side: drop a link bar into each pair of facing slots.' : 'Back to back: push the snap rivets through both bases.'] : []),
      ...(clip ? ['Hook the clip over the top of the rail and push the bottom in until it clicks.', 'To remove: pull the tab towards you; the holder tilts off.'] : []),
      ...(p.stand.enabled ? ['Slide the holder onto its stand post.'] : []),
      'Plugs: lay the plug in its cradle, slide it home, press the cap on.',
      ...((p.links ?? []).length ? ['Cables: loose holders\' cables are not routed or sized. Lay the boards out and measure each one before you buy it.'] : []),
    ].map((x, i) => `  ${i + 1}. ${x}`),
    '',
    'Checks:',
    ...res.report.checks.map((c) => `  [${c.status}] ${c.group} / ${c.name}: ${c.value}${c.detail ? ` (${c.detail})` : ''}`),
    ...(res.report.warnings.length ? ['', 'Warnings:', ...res.report.warnings.map((w) => `  - ${w}`)] : []),
  ];
  return lines.join('\n');
}

// ============================================================================================ BOARDS & LAYOUT
/** Switch which board the Board / Plugs / Holder panels edit (only shown with several boards). */
/** Which board the step is about: one chip per board, and + to add another without leaving the step. */
function ModulePicker() {
  const p = useApp((s) => s.project)!;
  const [open, setOpen] = useState<string | null>(null);
  const pick = (i: number) => { setActive(i); select([]); };
  const dot = (i: number) => <i style={{ background: p.modules[i].board.kind === 'box' ? '#3a3f47' : p.modules[i].board.color ?? 'var(--mask)' }} />;
  const add = <button className="bchip add" title="Add a board (A)" onClick={() => store.set({ addSheet: true })}><Icon d={I.plus} /> Add</button>;
  if (p.modules.length <= 10) return (
    <div className="boardchips" role="tablist" aria-label="Boards">
      {p.modules.map((m, i) => (
        <button key={m.id} role="tab" aria-selected={p.active === i} className={`bchip ${p.active === i ? 'on' : ''}`} title={`${m.board.name} · right-click to remove`} onClick={() => pick(i)}
          onContextMenu={(e) => { e.preventDefault(); if (p.modules.length > 1 && confirm(`Remove ${m.board.name} from the rack? Undo brings it back.`)) removeItems([{ kind: 'module', id: m.id }]); }}>
          {dot(i)}{shortName(m.board.name)}
        </button>
      ))}
      {add}
    </div>
  );
  // a big rack: one chip per kind of board ("Pi 4B ×6"), and that kind's boards by number under it
  const groups = new Map<string, number[]>();
  p.modules.forEach((m, i) => { const k = kindName(p, m.board.name); groups.set(k, [...(groups.get(k) ?? []), i]); });
  const mine = kindName(p, p.modules[p.active].board.name), show = open && groups.has(open) ? open : mine;
  const sub = groups.get(show) ?? [];
  return (
    <div className="boardchips" role="tablist" aria-label="Boards">
      {[...groups].map(([k, is]) => (
        <button key={k} role="tab" aria-selected={is.includes(p.active)} className={`bchip ${is.includes(p.active) ? 'on' : ''} ${show === k && is.length > 1 ? 'open' : ''}`} title={k}
          onClick={() => { setOpen(k); if (!is.includes(p.active)) pick(is[0]); }}>
          {dot(is[0])}<span className="bname">{shortName(k)}</span>{is.length > 1 && <b className="bcount">×{is.length}</b>}
        </button>
      ))}
      {add}
      {sub.length > 1 && (
        <div className="bsub" aria-label={`${show} boards`}>
          {sub.map((i) => { const nm = p.modules[i].board.name, n = nm === show ? '1' : nm.slice(show.length).trim().replace(/^#/, ''); return <button key={i} className={`bnum ${p.active === i ? 'on' : ''}`} title={nm} onClick={() => pick(i)}>{/^\d+$/.test(n) ? n : shortName(nm)}</button>; })}
        </div>
      )}
    </div>
  );
}

export function LayoutSection() {
  const p = useApp((s) => s.project)!;
  const A = p.arrange;
  const setA = (fn: (a: Project['arrange']) => void) => edit((q) => fn(q.arrange));
  const multi = p.modules.length > 1;
  return (
    <Section title={`Boards (${p.modules.length})`} right={<button className="btn small" onClick={() => store.set({ step: 'import', replaceMode: false })}>+ Add board</button>}>
      <div className="list">
        {p.modules.map((m, i) => (
          <div key={m.id} className={`item ${p.active === i ? 'sel' : ''}`} onClick={() => setActive(i)}>
            <span className="grow"><b>{i + 1}.</b> {m.board.name} <small>{round(bbox(m.board.outline).x1 - bbox(m.board.outline).x0, 0)} × {round(bbox(m.board.outline).y1 - bbox(m.board.outline).y0, 0)} mm</small></span>
            {multi && i > 0 && <button className="btn small ghost" title="Move up" onClick={(e) => { e.stopPropagation(); edit((q) => { [q.modules[i - 1], q.modules[i]] = [q.modules[i], q.modules[i - 1]]; q.active = i - 1; }); }}>↑</button>}
            <button className="btn small ghost" title="Duplicate this board and its holder" onClick={(e) => { e.stopPropagation(); duplicateModule(i); }}>⧉</button>
            {multi && <button className="btn small ghost danger" title="Remove" onClick={(e) => { e.stopPropagation(); const nm = m.board.name; edit((q) => { dropModule(q, m.id); }); toast(`Removed ${nm}. ⌘Z brings it back.`); }}>✕</button>}
          </div>
        ))}
      </div>
      {multi ? (
        <>
          <div style={{ marginTop: 10 }}><Seg value={A.mode} options={[['stack', 'Stacked'], ['side', 'Side by side'], ['back', 'Back to back']]} onChange={(v) => setA((a) => { a.mode = v; a.picked = true; })} /></div>
          {A.mode === 'stack' && <>
            <p className="hint">Board 1 is at the bottom{p.mount.kind === 'din' ? ' and carries the DIN clip' : p.stand.enabled ? ' and carries the stand socket' : ''}. Each holder gets four corner towers; the next layer presses onto their pegs. Towers clear the tallest part plus the gap.{p.modules.some((m) => m.board.kind === 'box') ? ' Boxes (hubs, chargers, powerboards) stand beside the stack, never in it, so nothing covers their ports and outlets.' : ''}</p>
            <div className="row" style={{ marginTop: 6 }}><Num label="Gap above tallest part" value={A.stackGap} min={0} max={40} onChange={(v) => setA((a) => { a.stackGap = v; })} /></div>
          </>}
          {A.mode === 'side' && <>
            <p className="hint">Holders sit next to each other{p.mount.kind === 'din' ? ', each on its own DIN clip' : ''}; printed link bars lock neighbours together.</p>
            <div className="row" style={{ marginTop: 6 }}>
              {p.mount.kind === 'din' ? <div className="field"><span>Row along</span><div className="static">the rail</div></div> : <Pick label="Row along" value={A.sideAxis} options={[['x', 'Board X'], ['y', 'Board Y']]} onChange={(v) => setA((a) => { a.sideAxis = v; })} />}
              <Num label="Extra gap" value={A.sideGap} min={0} max={20} onChange={(v) => setA((a) => { a.sideGap = v; })} />
            </div>
            <div style={{ marginTop: 6 }}><Check label="Link bars between neighbours" value={A.links} onChange={(v) => setA((a) => { a.links = v; })} /></div>
          </>}
          {A.mode === 'back' && <p className="hint">Boards 1 and 2 base to base, components facing out on both sides, held by printed snap rivets.{p.mount.kind === 'din' ? ' Use the DIN clip "standing off the rail" so it sits on an edge.' : ''}</p>}
        </>
      ) : <p className="hint">Add more boards to stack them, put them side by side, or mount two back to back.</p>}
    </Section>
  );
}

/** The holder edge with the fewest edge connectors: the natural side to put on the rail. */
function quietEdge(p: Project): 'bottom' | 'top' | 'left' | 'right' {
  const m = activeModule(p);
  const count = { bottom: 0, top: 0, left: 0, right: 0 };
  for (const c of m.board.comps) {
    if (!c.conn || c.conn.entry !== 'edge' || c.hidden) continue;
    const a = ((Math.round(c.conn.angle) % 360) + 360) % 360;
    const e = a > 45 && a <= 135 ? 'top' : a > 135 && a <= 225 ? 'left' : a > 225 && a <= 315 ? 'bottom' : 'right';
    count[e]++;
  }
  return (['bottom', 'top', 'left', 'right'] as const).reduce((best, e) => (count[e] < count[best] ? e : best), 'bottom');
}

/** Undo what the importer got wrong: revert, drop small parts, ignore holes, strip plug protection. */
function CleanUp() {
  const p = useApp((s) => s.project)!;
  const m = activeModule(p);
  const b = m.board;
  const small = b.comps.filter((c) => !c.hidden && !c.conn && c.h < 3 && c.side === 'top' && !c.tht).length;
  const prot = b.comps.filter((c) => c.conn && (c.conn.cradle || c.conn.cap || c.conn.guard || c.conn.tie)).length;
  const [all, setAll] = useState(false);
  const each = (fn: (mm: Project['modules'][number]) => void) => edit((q) => { for (const x of all ? q.modules : [q.modules[q.active]]) fn(x); });
  return (
    <Section title="Clean up the import">
      <div className="cleanup">
        <button className="btn small" disabled={!small} onClick={() => each((x) => { for (const c of x.board.comps) if (!c.conn && c.h < 3 && c.side === 'top' && !c.tht) c.hidden = true; })}>Hide small parts <small>({small})</small></button>
        <button className="btn small" disabled={!b.comps.some((c) => c.hidden)} onClick={() => each((x) => { for (const c of x.board.comps) c.hidden = false; })}>Show hidden parts</button>
        <button className="btn small" disabled={!prot} onClick={() => each((x) => { for (const c of x.board.comps) if (c.conn) Object.assign(c.conn, { cradle: false, cap: false, guard: false, tie: false }); })}>Strip plug cradles, caps & ties <small>({prot})</small></button>
        <button className="btn small" disabled={!b.holes.length} onClick={() => each((x) => { for (const h of x.board.holes) h.use = 'none'; })}>Ignore all holes</button>
        <button className="btn small ghost" disabled={!m.original} onClick={() => each((x) => { if (x.original) x.board = structuredClone(x.original); })}>↺ Revert to the import</button>
      </div>
      {p.modules.length > 1 && <div style={{ marginTop: 8 }}><Check label="Apply to every board" value={all} onChange={setAll} /></div>}
      <p className="hint">Small parts only matter under the board or near the walls; hiding them frees room for spring clips and labels. Everything here can be undone (⌘Z).</p>
    </Section>
  );
}


function TestKitSection() {
  const p = useApp((s) => s.project)!;
  const [busy, setBusy] = useState(false);
  const get = async () => {
    setBusy(true);
    try {
      const parts = await buildTestKit(p.panel.fit ?? 0);
      const plates = packPlates(parts, p.printer.bed, p.printer.spacing);
      download('boarddock_test_fit_kit.3mf', write3mf(plates.flatMap((pl) => pl.items.map((it) => ({ name: it.part.name, mesh: placedMesh(it, p.printer.bed, pl.used) })))));
    } finally { setBusy(false); }
  };
  return (
    <Section title="Test-fit kit · print this first">
      <p className="hint" style={{ marginTop: 0 }}>One rail shoe, one socket and a small tongue key with its release rod: about 30 to 40 minutes. Clip the shoe on your rail, push the key in until it clicks, press its button and lift. If the key is tight, raise <b>Tongue fit</b> in the Rails step by 0.05 to 0.1 mm and print the kit again.</p>
      <div className="btns" style={{ marginTop: 8 }}><button className="btn" disabled={busy} onClick={get}>{busy ? 'Building…' : 'Download test-fit kit (3MF)'}</button></div>
    </Section>
  );
}

// ============================================================================================ HOLE WIZARD
const ROLES: HoleRole[] = ['mount', 'standoff', 'plug', 'lead', 'free'];

/**
 * Hole wizard: every hole sorted by what it is for. Mounting holes get pins; connector pegs, part leads and the
 * standoffs of a board stacked on top are left free with clearance underneath. Detected automatically on import,
 * changeable per hole or per group.
 */
function HoleWizard() {
  const p = useApp((s) => s.project)!;
  const sel = useApp((s) => s.sel);
  const m = activeModule(p);
  const b = m.board;
  const above = boltedOn(p, m).map((x) => x.board);
  const guess = useMemo(() => new Map(detectHoleRoles(b, above).map((g) => [g.id, g])), [b, above.length]);
  const bb = bbox(b.outline);
  const byRole = ROLES.map((r) => ({ r, holes: b.holes.filter((h) => (h.role ?? 'mount') === r) })).filter((g) => g.holes.length);
  const differs = b.holes.filter((h) => (h.role ?? 'mount') !== guess.get(h.id)?.role).length;
  const setRole = (ids: string[], role: HoleRole) => editMod((q) => { for (const h of q.board.holes) if (ids.includes(h.id)) { h.role = role; h.why = 'set by hand'; } });
  const mountHoles = b.holes.filter((h) => (h.role ?? 'mount') === 'mount');
  const useAll = common(mountHoles, (h) => h.use);
  return (
    <Section title={`Hole wizard · ${b.holes.length}`} right={<span className="btns">
      <button className="btn small ghost" title="Sort every hole again from the parts and the stack" onClick={() => editMod((q) => applyHoleRoles(q.board, above, true))}><Icon d={I.wand} /> Detect{differs ? ` (${differs})` : ''}</button>
      <button className="btn small ghost icon" title="Add a hole" onClick={() => { editMod((q) => { q.board.holes.push({ id: uid('h'), x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2, d: 3.2, plated: false, use: 'auto', role: 'mount', why: 'added by hand' }); }); store.set({ view: 'editor' }); }}><Icon d={I.plus} /></button>
    </span>}>
      {!b.holes.length ? <NoHoles /> : (
        <>
          <div className="rolebar">{byRole.map((g) => <i key={g.r} style={{ width: `${(g.holes.length / b.holes.length) * 100}%`, background: ROLE_INFO[g.r].color }} title={`${g.holes.length} ${ROLE_INFO[g.r].name}`} />)}</div>
          {byRole.map((g) => (
            <div key={g.r} className="rolegrp">
              <header>
                <i style={{ background: ROLE_INFO[g.r].color }} />
                <b>{ROLE_INFO[g.r].name} · {g.holes.length}</b>
                <span>{g.r === 'mount' ? 'pins' : g.r === 'free' ? 'ignored' : 'kept clear'}</span>
              </header>
              <div className="holes">
                {g.holes.map((h) => {
                  const i = b.holes.indexOf(h);
                  const on = isSel(sel, h.id);
                  return (
                    <div key={h.id} className={`holerow ${on ? 'sel' : ''}`} onClick={(e) => select([{ kind: 'hole', id: h.id }], e.shiftKey || e.metaKey ? 'toggle' : 'set')}>
                      <div style={{ minWidth: 0 }}>Hole {i + 1} <span className="mono" style={{ color: 'var(--subtle)', fontSize: 11 }}>Ø{round(h.d, 2)} · {round(h.x, 1)}, {round(h.y, 1)}</span><small title={h.why ?? guess.get(h.id)?.why}>{h.why ?? guess.get(h.id)?.why}</small></div>
                      <select value={h.role ?? 'mount'} onClick={(e) => e.stopPropagation()} onChange={(e) => setRole(isSel(sel, h.id) ? sel.filter((s) => s.kind === 'hole').map((s) => s.id) : [h.id], e.target.value as HoleRole)}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_INFO[r].short}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {mountHoles.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="field"><span>Pins in the mounting holes</span></div>
              <div style={{ marginTop: 5 }}><Seg value={useAll ?? ('' as Hole['use'])} options={[['auto', 'Auto'], ['snap', 'Snap pins'], ['pin', 'Locating pins']]} onChange={(v) => editMod((q) => { for (const h of q.board.holes) if ((h.role ?? 'mount') === 'mount') h.use = v; })} /></div>
            </div>
          )}
          <p className="hint">{ROLE_INFO.plug.name}s, {ROLE_INFO.lead.name.toLowerCase()}s and {ROLE_INFO.standoff.name.toLowerCase()}s never get a pin: pegs, pins and screw heads stick out under the board, so the holder leaves room there. Pick several holes (Shift-click) and change one to change them all.</p>
        </>
      )}
    </Section>
  );
}

/** A board with no holes: what holds it, from the build (the spring clips at its edges), and what to do if nothing does. */
function NoHoles() {
  const p = useApp((s) => s.project)!;
  const res = useApp((s) => s.result);
  const id = activeModule(p).id;
  const clipsC = res?.report.checks.find((c) => c.module === id && /^Spring clips \(\d+\)/.test(c.name));
  // warnings name their boards ("Pico, Pico 2 and Nano: Nothing clips…") or none when there is one board
  const loose = res?.report.warnings.some((w) => {
    const i = w.indexOf('Nothing clips this board in');
    if (i < 0) return false;
    return i === 0 ? p.modules.length === 1 : w.slice(0, i - 2).split(/, | and /).includes(activeModule(p).board.name);
  });
  const n = clipsC ? +(/\((\d+)\)/.exec(clipsC.name)?.[1] ?? 0) : 0;
  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>No holes: the board sits on seats along its edges and spring clips at its edges hold it down.{clipsC ? ` Here ${n} clip${n === 1 ? '' : 's'} hold it (${clipsC.value}; Check has the details).` : ''}</p>
      {loose && <div className="warns"><div>Nothing holds this board in yet: plugs{p.layout === 'panel' ? ', the dock' : ''} and the label take its free edges. Turn off a plug cradle or the label (Plugs, Holder) to free an edge for the clips.</div></div>}
      {!loose && n >= 2 && <p className="hint">Press it down until the clips click over its edge. To take it out, pull a clip's ear back with a fingernail and lift that side.</p>}
    </>
  );
}

// ============================================================================================ HOLDER STYLE
function HolderStyle() {
  const p = useApp((s) => s.project)!;
  const res = useApp((s) => s.result);
  const m = activeModule(p);
  const style = m.holder.style ?? 'frame';
  const holder = res?.parts.find((x) => x.tag?.kind === 'holder' && x.tag.module === m.id);
  const g = holder ? estimate(holder, MATERIALS[m.holder.material].density) : null;
  const keyOf = (k: string) => { let h = 2166136261; for (const ch of JSON.stringify([m.board.name, m.board.outline.length, m.board.comps.length, m.board.holes.length, { ...m.holder, style: k }])) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return `holder:${(h >>> 0).toString(36)}`; };
  const picFrame = usePicture(keyOf('frame') + ':v2', () => holderPicture(m.board, { ...m.holder, style: 'frame' }), 300, 190, [0.55, -1, 1.1]);
  const picTray = usePicture(keyOf('tray') + ':v2', () => holderPicture(m.board, { ...m.holder, style: 'tray' }), 300, 190, [0.55, -1, 1.1]);
  const card = (k: 'frame' | 'tray', name: string, text: string, art: ReactNode) => (
    <button className={`stylecard ${style === k ? 'on' : ''}`} onClick={() => editMod((q) => { q.holder.style = k; })}>
      {(k === 'frame' ? picFrame : picTray) ? <img className="stylepic" src={(k === 'frame' ? picFrame : picTray)!} alt="" draggable={false} /> : art}
      <b>{name}</b>
      <small>{text}</small>
    </button>
  );
  const board = <rect x="26" y="15" width="68" height="34" rx="3" fill="#1f8a57" opacity="0.9" />;
  return (
    <Section title="Holder style" right={g ? <span className="chip acc">{g.grams.toFixed(0)} g · {fmtMin(g.minutes)}</span> : undefined}>
      <div className="styles">
        {card('frame', 'Frame', 'Rim, corner guards and ribs to every pin. 25 to 50% less plastic than the tray, quicker to print.',
          <svg viewBox="0 0 120 64"><rect x="18" y="9" width="84" height="46" rx="5" fill="none" stroke="var(--fg)" strokeOpacity="0.8" strokeWidth="4" />{board}<path d="M18 22V14a5 5 0 015-5h8M102 22v-8a5 5 0 00-5-5h-8M18 42v8a5 5 0 005 5h8M102 42v8a5 5 0 01-5 5h-8" stroke="var(--accent)" strokeWidth="4" fill="none" /></svg>)}
        {card('tray', 'Tray', 'Full base with a hex pattern and a wall all round. Stiffest, most plastic.',
          <svg viewBox="0 0 120 64"><rect x="16" y="7" width="88" height="50" rx="6" fill="var(--fg)" fillOpacity="0.14" stroke="var(--fg)" strokeOpacity="0.8" strokeWidth="3" />{[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M${28 + i * 16} 53l5-3 5 3`} stroke="var(--fg)" strokeOpacity="0.3" fill="none" />)}{board}</svg>)}
      </div>
    </Section>
  );
}
