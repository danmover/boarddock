import { useMemo, useRef, useState, type ReactNode } from 'react';
import { zipSync, strToU8 } from 'fflate';
import type { Board, Comp, Hole, HoleRole, Project, V2 } from '../model/types';
import { applyHoleRoles, boltedOn, detectHoleRoles, ROLE_INFO } from '../model/holes';
import { compatible, KIND_COLOR, linkKind, linkOf, plugName, plugRole, plugsOf, sameRef } from '../model/links';
import { addLinks, removeLinks, setLink } from './linkOps';
import { Icon, I } from './icons';
import { CONNECTORS, DEFAULT_FEATURES, HOLDER_PRESETS, MATERIALS, PRINTERS, connById, connSetup } from '../model/library';
import { TEMPLATES } from '../model/templates';
import { ACCEPT } from '../import';
import { openFiles } from './importFlow';
import { bbox, circleLoop, roundedRectLoop, round, uid } from '../geom/poly';
import { activeModule, addBoard, closeProject, edit, editMod, isSel, putBoards, select, store, toast, useApp, type SelItem } from '../state';
import { Check, Chip, Num, Pick, Section, Seg, Text, download, safeName } from './controls';
import { estimate, packPlates, placedMesh, write3mf, writeStl } from '../cad/export';
import { buildTestKit, runClipFea } from '../worker/client';
import type { ClipFeaResult } from '../fea/clipfea';
import { clipDims } from '../cad/dinclip';
import { RackBuilder } from './RackBuilder';
import { duplicateModule } from './panelOps';
import { DockFeaSection } from './DockFea';

// ============================================================================================ IMPORT
export function ImportPanel() {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hasProject = useApp((s) => !!s.project);
  const replaceMode = useApp((s) => s.replaceMode);
  const nBoards = useApp((s) => s.project?.modules.length ?? 0);
  const put = (b: Board) => { putBoards([b], replaceMode); if (hasProject && !replaceMode) toast(`Added ${b.name} (${nBoards + 1} boards). ⌘Z undoes it.`); };

  const handle = async (fl: FileList | File[]) => {
    const files = Array.from(fl);
    if (!files.length) return;
    setErr(null);
    setBusy(true);
    try {
      await openFiles(files);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className={`drop ${over ? 'over' : ''}`} onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}>
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="14" width="32" height="22" rx="3" /><path d="M14 20h.01M34 20h.01M14 30h.01M34 30h.01M20 22h8v6h-8zM24 4v12M19 11l5 5 5-5" /></svg>
        <b>{busy ? 'Reading…' : 'Drop board files here'}</b>
        <p>KiCad · STEP · IDF · Eagle/Fusion · Gerber + drill + pick & place (zip is fine) · DXF · BoardDock project</p>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => e.target.files && handle(e.target.files)} />
      </div>
      {hasProject && (
        <div className="section" style={{ marginTop: 10, padding: '8px 12px' }}>
          <p className="hint" style={{ marginTop: 0 }}>Boards you drop or pick join this project ({nBoards} so far) and go on the rails. Drop several files at once for several boards.</p>
          <Check label="Replace the board being edited instead" value={replaceMode} onChange={(v) => store.set({ replaceMode: v })} />
        </div>
      )}
      {busy && <div className="progress" style={{ margin: '8px 0' }}><div /></div>}
      {err && <div className="err" style={{ margin: '10px 0' }}>{err}</div>}
      <div style={{ height: 10 }} />
      <Section title="Start from a known board">
        <div className="tiles">
          {TEMPLATES.filter((t) => !t.accessory).map((t) => { const [n, sz] = t.name.split(' ('); return <button key={t.id} className="tile" onClick={() => put(t.make())}><span>{n}</span>{sz && <small>{sz.replace(')', '')}</small>}</button>; })}
        </div>
      </Section>
      <Section title="Hubs, chargers and add-ons">
        <div className="tiles">
          {TEMPLATES.filter((t) => t.accessory).map((t) => { const [n, sz] = t.name.split(' ('); return <button key={t.id} className="tile" onClick={() => (hasProject ? addBoard(t.make()) : put(t.make()))}><span>{n}</span>{sz && <small>{sz.replace(')', '')}</small>}</button>; })}
        </div>
        <p className="hint">They go on their own rail next to the boards, strapped into a low holder, and Auto-connect wires the boards to them. {hasProject ? 'Clicking one adds it to this project.' : ''}</p>
      </Section>
      <ManualBoard put={put} />
      <details className="section">
        <summary style={{ cursor: 'pointer', fontWeight: 650, fontSize: 12.5 }}>Exporting from your EDA tool</summary>
        <ul className="fmt" style={{ marginTop: 10 }}>
          <li><b>KiCad</b>: drop the <code>.kicad_pcb</code>. Outline, holes, courtyards and 3D model names are read.</li>
          <li><b>Altium Designer</b>: File › Export › <b>STEP 3D</b> (best, real part heights). Or zip the fab outputs: Gerbers with the board outline layer, NC Drill, Pick and Place.</li>
          <li><b>Eagle / Fusion Electronics</b>: drop the <code>.brd</code>, or export STEP.</li>
          <li><b>EasyEDA / JLCPCB</b>: Export › Gerber zip plus Export › Pick and Place (CPL), drop both. Or Export › 3D › STEP.</li>
          <li><b>OrCAD, Allegro, PADS, DipTrace, Proteus</b>: export IDF (<code>.emn</code> + <code>.emp</code>) or STEP, or Gerber + drill + centroid.</li>
        </ul>
        <p className="hint">Files never leave your computer: everything runs locally.</p>
      </details>
      {hasProject && <div className="btns" style={{ marginTop: 12 }}><button className="btn danger small" onClick={() => { if (confirm('Close this project? Unsaved changes are kept only in this browser until you start a new one.')) closeProject(); }}>Close project</button></div>}
    </div>
  );
}

function ManualBoard({ put }: { put: (b: Board) => void }) {
  const [shape, setShape] = useState<'rect' | 'round' | 'circle'>('rect');
  const [w, setW] = useState(60), [h, setH] = useState(40), [r, setR] = useState(2), [t, setT] = useState(1.6);
  const [holesOn, setHolesOn] = useState(true), [inset, setInset] = useState(3.5), [hd, setHd] = useState(3.2);
  const make = () => {
    const outline: V2[] = shape === 'circle' ? circleLoop(w / 2, w / 2, w / 2, 96) : roundedRectLoop(w, h, shape === 'round' ? r : 0.01, 8).map(([x, y]) => [x + w / 2, y + h / 2] as V2);
    const holes: Hole[] = [];
    if (holesOn) {
      if (shape === 'circle') for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + (k * Math.PI) / 2, rr = w / 2 - inset; holes.push({ id: uid('h'), x: w / 2 + rr * Math.cos(a), y: w / 2 + rr * Math.sin(a), d: hd, plated: false, use: 'auto' }); }
      else for (const [x, y] of [[inset, inset], [w - inset, inset], [inset, h - inset], [w - inset, h - inset]]) holes.push({ id: uid('h'), x, y, d: hd, plated: false, use: 'auto' });
    }
    put({ name: 'My board', outline, cutouts: [], thickness: t, holes, comps: [], source: 'drawn', notes: [] });
  };
  return (
    <Section title="Or draw one">
      <Seg value={shape} options={[['rect', 'Rectangle'], ['round', 'Rounded'], ['circle', 'Round']]} onChange={setShape} />
      <div className="row" style={{ marginTop: 10 }}>
        <Num label={shape === 'circle' ? 'Diameter' : 'Width'} value={w} onChange={setW} step={0.5} min={5} />
        {shape !== 'circle' ? <Num label="Height" value={h} onChange={setH} step={0.5} min={5} /> : <Num label="Thickness" value={t} onChange={setT} min={0.4} max={3.2} />}
        {shape === 'round' && <Num label="Corner radius" value={r} onChange={setR} min={0} />}
        {shape !== 'circle' && <Num label="Thickness" value={t} onChange={setT} min={0.4} max={3.2} />}
      </div>
      <div style={{ marginTop: 8 }}><Check label="Four mounting holes" value={holesOn} onChange={setHolesOn} /></div>
      {holesOn && <div className="row"><Num label="Inset from edge" value={inset} onChange={setInset} /><Num label="Hole Ø" value={hd} onChange={setHd} min={1} /></div>}
      <p className="hint">Then add connectors and parts in the board editor.</p>
      <div className="btns" style={{ marginTop: 8 }}><button className="btn primary" onClick={make}>Create board</button></div>
    </Section>
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

export function BoardPanel() {
  const p = useApp((s) => s.project)!;
  const sel = useApp((s) => s.sel);
  const b = activeModule(p).board;
  const bb = bbox(b.outline);
  const [filter, setFilter] = useState<'key' | 'all'>('key');
  const comps = b.comps.filter((c) => !c.hidden && (filter === 'all' || c.conn || c.h >= 5 || c.side === 'bottom' || c.kind === 'hot' || c.kind === 'antenna'));
  const hidden = b.comps.filter((c) => c.hidden).length;
  return (
    <div>
      <ModulePicker />
      <Section title="Summary">
        <Text label="Name" value={b.name} onChange={(v) => editMod((q) => { q.board.name = v; })} />
        <div className="row" style={{ marginTop: 8 }}>
          <Num label="Thickness" value={b.thickness} min={0.3} max={4} onChange={(v) => editMod((q) => { q.board.thickness = v; })} />
          <div className="field"><span>Size</span><div className="static mono">{round(bb.x1 - bb.x0, 1)} × {round(bb.y1 - bb.y0, 1)}</div></div>
        </div>
        <p className="hint">{b.source}. {b.holes.length} holes, {b.comps.filter((c) => !c.hidden).length} parts, {b.comps.filter((c) => c.conn).length} connectors.</p>
        {b.notes.length > 0 && <div className="warns">{b.notes.map((n, i) => <div key={i}>{n}</div>)}</div>}
      </Section>
      {sel.length > 0 && <Inspector />}
      <HoleWizard />
      <CleanUp />
      <Section title="Parts" right={<span className="btns"><AllBox items={comps.map((c) => ({ kind: 'comp' as const, id: c.id }))} /><Seg value={filter} options={[['key', 'Key'], ['all', 'All']]} onChange={setFilter} /></span>}>
        <div className="list" style={{ maxHeight: 340, overflowY: 'auto' }}>
          {comps.map((c) => (
            <SelRow key={c.id} it={{ kind: 'comp', id: c.id }}>
              <span className="grow"><b>{c.ref}</b> <small>{c.pkg}</small></span>
              {c.side === 'bottom' && <Chip status="info">under</Chip>}
              {c.conn && <Chip status="warn">plug</Chip>}
              <small className="mono">{round(c.h, 1)}</small>
            </SelRow>
          ))}
          {!comps.length && <p className="hint">No parts listed. Add keep-out boxes for anything tall near the edges.</p>}
        </div>
        <div className="btns" style={{ marginTop: 8 }}>
          <button className="btn small" onClick={() => store.set({ view: 'editor' })}>Open board editor</button>
          {hidden > 0 && <button className="btn small ghost" onClick={() => editMod((q) => { q.board.comps.forEach((c) => { c.hidden = false; }); })}>Show {hidden} hidden</button>}
        </div>
      </Section>
      <details className="section">
        <summary style={{ cursor: 'pointer', fontWeight: 650, fontSize: 12.5 }}>Reshape the outline</summary>
        <div style={{ marginTop: 10 }}><ReshapeOutline b={b} /></div>
      </details>
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
          {one && <div className="row3"><Num label="X" value={holes[0].x} onChange={(v) => setH((h) => { h.x = v; })} /><Num label="Y" value={holes[0].y} onChange={(v) => setH((h) => { h.y = v; })} /><Num label="Ø" value={holes[0].d} min={0.5} onChange={(v) => setH((h) => { h.d = v; })} /></div>}
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
            <Num label="Rotation" unit="°" step={90} value={mixed(common(comps, (c) => c.rot))} onChange={(v) => setC((x) => { x.rot = v; })} />
            <Num label="Width" value={mixed(common(comps, (c) => c.w))} min={0.2} onChange={(v) => setC((x) => { x.w = v; })} />
            <Num label="Length" value={mixed(common(comps, (c) => c.l))} min={0.2} onChange={(v) => setC((x) => { x.l = v; })} />
            <Num label="Height" value={mixed(common(comps, (c) => c.h))} min={0} onChange={(v) => setC((x) => { x.h = v; })} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <Pick label="Kind" value={common(comps, (c) => c.kind) ?? ('' as Comp['kind'])} options={[['' as Comp['kind'], '— mixed —'], ['generic', 'Part'], ['connector', 'Connector'], ['header', 'Header'], ['switch', 'Button/switch'], ['led', 'LED'], ['module', 'Module'], ['hot', 'Hot part'], ['antenna', 'Antenna/RF']]} onChange={(v) => v && setC((x) => { x.kind = v; })} />
            <div className="field"><span>&nbsp;</span><Check label="Through-hole leads" value={common(comps, (c) => c.tht) ?? false} onChange={(v) => setC((x) => { x.tht = v; })} /></div>
          </div>
          {one && <p className="hint">{comps[0].pkg}{comps[0].value ? ` · ${comps[0].value}` : ''}</p>}
          <div className="btns" style={{ marginTop: 6 }}>
            {comps.some((c) => !c.conn) && <button className="btn small" onClick={() => setC((x) => { if (!x.conn) { x.conn = connSetup(connById('custom'), 0); x.kind = 'connector'; } })}>Treat as connector{multi ? 's' : ''}</button>}
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
  return (
    <div>
      <ModulePicker />
      <p className="lede">Every connector gets an opening sized for its plug. Edge plugs can sit in a <b>cradle</b> with a snap-on <b>cap</b>. Tick several to set them together, or click a cradle in the 3D view.</p>
      <Section title={`Connectors · ${conns.length}`} right={<span className="btns"><AllBox items={conns.map((c) => ({ kind: 'comp' as const, id: c.id }))} /><button className="btn small" onClick={() => store.set({ view: 'editor' })}>+ Add</button></span>}>
        <div className="list">
          {conns.map((c) => (
            <SelRow key={c.id} it={{ kind: 'comp', id: c.id }}>
              <span className="grow"><b>{c.ref}</b> <small>{connById(c.conn!.type).name}</small></span>
              {c.conn!.entry === 'edge' ? <Chip>{c.conn!.cradle ? (c.conn!.cap ? 'cradle + cap' : 'cradle') : c.conn!.guard ? 'guard' : 'opening'}</Chip> : <Chip>from above</Chip>}
            </SelRow>
          ))}
          {!conns.length && <p className="hint">No connectors found. Add them in the board editor (Connector tool, click an edge), or select a part and choose "Treat as connector".</p>}
        </div>
      </Section>
      {chosen.length > 0 && <ConnEditor list={chosen} />}
      <CablesSection />
    </div>
  );
}

/** Every cable in the project: what goes where, how long, what to buy. */
function CablesSection() {
  const p = useApp((s) => s.project)!;
  const cables = useApp((s) => s.result?.report.cables ?? []);
  const sel = useApp((s) => s.sel);
  const links = p.links ?? [];
  const nm = (r: { module: string; ref: string }) => `${p.modules.find((m) => m.id === r.module)?.board.name ?? '?'} ${r.ref}`;
  const buy = new Map<string, number>();
  for (const l of links) {
    const c = cables.find((x) => x.id === l.id);
    const A = p.modules.find((m) => m.id === l.a.module)?.board.comps.find((x) => x.ref === l.a.ref), B = p.modules.find((m) => m.id === l.b.module)?.board.comps.find((x) => x.ref === l.b.ref);
    const key = `${c ? `${c.buy} m ` : ''}${plugName(A?.conn?.type ?? '')} to ${plugName(B?.conn?.type ?? '')}`;
    buy.set(key, (buy.get(key) ?? 0) + 1);
  }
  return (
    <Section title={`Cables · ${links.length}`} right={<span className="btns">
      <button className="btn small soft" onClick={() => addLinks()}><Icon d={I.wand} /> Auto-connect</button>
      <button className="btn small ghost" onClick={() => store.set({ view: 'wiring' })}>Wiring view</button>
    </span>}>
      {!links.length ? <p className="hint" style={{ marginTop: 0 }}>Say what plugs into what (a Pi's USB to an Arduino, power from a charger) and BoardDock keeps connected boards together on the rails, routes each cable along the channels between the rails, and tells you how long a cable to buy. <b>Auto-connect</b> fills in the obvious ones.</p> : (
        <>
          <div className="list">
            {links.map((l) => {
              const c = cables.find((x) => x.id === l.id);
              return (
                <div key={l.id} className={`item ${isSel(sel, l.id) ? 'sel' : ''}`} onClick={() => select([{ kind: 'link', id: l.id }])}>
                  <span className="dot" style={{ background: KIND_COLOR[l.kind ?? 'usb'], borderRadius: 99 }} />
                  <span className="grow"><b>{nm(l.a)}</b> <small>to</small> <b>{nm(l.b)}</b></span>
                  {c ? <span className="chip">{Math.round(c.length / 10)} cm</span> : <span className="chip">not on the rails</span>}
                  <button className="btn small ghost icon" title="Remove the cable" onClick={(e) => { e.stopPropagation(); removeLinks([l.id]); }}><Icon d={I.x} /></button>
                </div>
              );
            })}
          </div>
          <div className="divider" />
          <div className="field"><span>Cables to buy (route + 10%, next standard length)</span></div>
          <ul className="fmt" style={{ marginTop: 4 }}>{[...buy.entries()].map(([k, n]) => <li key={k}>{n} × {k}</li>)}</ul>
        </>
      )}
    </Section>
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
  const options = plugsOf(p).filter((q) => q.module !== m && compatible(myRole, q.role));
  return (
    <Pick label="Cable to" value={other ? `${other.module}|${other.ref}` : ''} options={[['', options.length ? '— not connected —' : '— nothing it fits —'], ...options.map((q) => [`${q.ref.module}|${q.ref.ref}`, `${q.module.board.name} · ${q.label}`] as [string, string])]}
      onChange={(v) => { if (!v) setLink(me, null); else { const [mod, ref] = v.split('|'); const q = options.find((x) => x.ref.module === mod && x.ref.ref === ref)!; setLink(me, q.ref, linkKind(myRole, q.role)); } }} />
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
      <Section title="Protection">
        <Check label="Cradle: carries the plug body outside the wall" value={flag('cradle')} onChange={(v) => set((x) => { if (x.conn!.entry === 'edge') x.conn!.cradle = v; })} />
        <Check label="Snap-on cap: locks the plug into the cradle" value={flag('cap') && flag('cradle')} onChange={(v) => set((x) => { if (x.conn!.entry !== 'edge') return; x.conn!.cap = v; if (v) x.conn!.cradle = true; })} />
        <Check label="Guard collar around the opening" value={flag('guard')} onChange={(v) => set((x) => { x.conn!.guard = v; })} />
        <Check label="Zip-tie anchor for the cable" value={flag('tie')} onChange={(v) => set((x) => { x.conn!.tie = v; })} />
        <p className="hint">Neighbouring cradles on one edge merge automatically and share one cap.</p>
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
        {p.modules.length > 1 && <div className="btns" style={{ marginTop: 8 }}><button className="btn small ghost" onClick={() => edit((q) => { for (const m of q.modules) Object.assign(m.holder, { style: H.style, wall: H.wall, base: H.base, pattern: H.pattern, cell: H.cell, rib: H.rib, wallAbove: H.wallAbove, chamfer: H.chamfer, material: H.material, feat: H.feat }); })}><Icon d={I.copy} /> Use these settings for every board</button></div>}
      </Section>
      <Section title="Features">
        {(() => {
          const F = { ...DEFAULT_FEATURES, ...(H.feat ?? {}) };
          const setF = (k: keyof typeof F, v: boolean) => set((h) => { h.feat = { ...DEFAULT_FEATURES, ...(h.feat ?? {}), [k]: v }; });
          return (
            <>
              <div className="featgrid">
                <Check label="Plug cradles" value={F.cradles} onChange={(v) => setF('cradles', v)} />
                <Check label="Snap-on plug caps" value={F.caps} onChange={(v) => setF('caps', v)} />
                <Check label="Cable-tie anchors" value={F.ties} onChange={(v) => setF('ties', v)} />
                <Check label="Receptacle guards" value={F.guards} onChange={(v) => setF('guards', v)} />
                <Check label="Wall snap fingers" value={H.tabs !== 'off'} onChange={(v) => set((h) => { h.tabs = v ? 'auto' : 'off'; })} />
                {(H.style ?? 'frame') === 'tray' && <Check label="Finger notches" value={H.notches} onChange={(v) => set((h) => { h.notches = v; })} />}
                <Check label="Engraved label" value={!!H.label.trim()} onChange={(v) => set((h) => { h.label = v ? activeModule(p).board.name.slice(0, 24) : ''; })} />
                {(H.style ?? 'frame') === 'tray' && <Check label="Base pattern" value={H.pattern !== 'none'} onChange={(v) => set((h) => { h.pattern = v ? 'hex' : 'none'; })} />}
              </div>
              <p className="hint">Switch a feature off for the whole holder here; the Plugs step still remembers each connector's own choice for when you switch it back on.</p>
            </>
          );
        })()}
      </Section>
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
      <Section title="Holding the board">
        <Seg value={H.tabs} options={[['auto', 'Auto'], ['on', 'Always'], ['off', 'Off']]} onChange={(v) => set((h) => { h.tabs = v; })} />
        <div className="row" style={{ marginTop: 8 }}><Num label="Finger lip" value={H.tabLip} min={0.3} max={1.2} step={0.05} onChange={(v) => set((h) => { h.tabLip = v; })} /></div>
        <p className="hint">Snap fingers are cut into the wall and bend sideways, within the print layers, so they don't snap off. Auto: fingers unless you set holes to snap pins.</p>
        <Check label="Finger notches to lift the board out" value={H.notches} onChange={(v) => set((h) => { h.notches = v; })} />
      </Section>
      <Section title="Look">
        {(H.style ?? 'frame') === 'tray' && <Pick label="Base pattern" value={H.pattern} options={[['hex', 'Hexagons'], ['slots', 'Slots'], ['circles', 'Circles'], ['none', 'Solid']]} onChange={(v) => set((h) => { h.pattern = v; })} />}
        {(H.style ?? 'frame') === 'tray' && H.pattern !== 'none' && <div className="row" style={{ marginTop: 8 }}><Num label="Cell size" value={H.cell} min={5} max={30} step={0.5} onChange={(v) => set((h) => { h.cell = v; })} /><Num label="Rib" value={H.rib} min={1.2} max={5} onChange={(v) => set((h) => { h.rib = v; })} /></div>}
        <div style={{ marginTop: 8 }}><Text label="Engraved label" value={H.label} placeholder="e.g. SENSOR HUB" onChange={(v) => set((h) => { h.label = v; })} /></div>
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

// ============================================================================================ MOUNT
export function MountPanel() {
  const p = useApp((s) => s.project)!;
  const M = p.mount, S = p.stand;
  const setM = (fn: (m: Project['mount']) => void) => edit((q) => fn(q.mount));
  const setS = (fn: (s: Project['stand']) => void) => edit((q) => fn(q.stand));
  const pick = <Seg value={p.layout} options={[['panel', 'On DIN rails'], ['loose', 'Loose holders']]} onChange={(v) => { edit((q) => { q.layout = v; }); store.set({ view: 'assembly' }); }} />;
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
      <Section title="DIN rail clip" right={<Check label="" value={M.kind === 'din'} onChange={(v) => setM((m) => { m.kind = v ? 'din' : 'none'; })} />}>
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
      <Section title="Stand socket (female)" right={<Check label="" value={S.enabled} onChange={(v) => setS((s) => { s.enabled = v; })} />}>
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
  const groups = useMemo(() => {
    const g = new Map<string, NonNullable<typeof res>['report']['checks']>();
    for (const c of res?.report.checks ?? []) (g.get(c.group) ?? g.set(c.group, []).get(c.group)!).push(c);
    return [...g.entries()];
  }, [res]);
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
      <div className="bigstat">
        <div><b style={{ color: 'var(--good)' }}>{res?.report.checks.filter((c) => c.status === 'ok').length ?? 0}</b><span>passing</span></div>
        <div><b style={{ color: 'var(--warn)' }}>{(res?.report.checks.filter((c) => c.status === 'warn').length ?? 0) + (res?.report.warnings.length ?? 0)}</b><span>to look at</span></div>
        <div><b style={{ color: 'var(--bad)' }}>{res?.report.checks.filter((c) => c.status === 'bad').length ?? 0}</b><span>failing</span></div>
      </div>
      {res?.report.warnings.length ? <div className="warns">{res.report.warnings.map((w, i) => <div key={i}>{w}</div>)}</div> : null}
      {groups.map(([g, list]) => (
        <Section key={g} title={g}>
          {list.map((c, i) => (
            <div key={i} className="checkrow"><div className="grow">{c.name}{c.detail && <div className="hint">{c.detail}</div>}</div><Chip status={c.status}>{c.value}</Chip></div>
          ))}
        </Section>
      ))}
      <p className="hint">Hand calculations for every spring and snap, plus finite-element models of the clips. Linear and idealised: print the test-fit kit before a batch.</p>
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
  const plates = useMemo(() => (res ? packPlates(res.parts, p.printer.bed, p.printer.spacing, copies) : []), [res, p.printer.bed[0], p.printer.bed[1], p.printer.spacing, copies]);
  const dens = MATERIALS[activeModule(p).holder.material].density;
  const est = useMemo(() => (res ? res.parts.map((x) => ({ part: x, ...estimate(x, dens) })) : []), [res, dens]);
  const tot = est.reduce((a, e) => ({ g: a.g + e.grams * e.part.qty * copies, m: a.m + e.minutes * e.part.qty * copies }), { g: 0, m: 0 });
  if (!res) return <div><p className="lede">Building…</p></div>;
  const base = safeName(p.modules.map((m) => m.board.name).join('+'));
  const plateMeshes = (i: number) => plates[i].items.map((it) => placedMesh(it, p.printer.bed, plates[i].used));
  const zipAll = () => {
    const files: Record<string, Uint8Array> = {};
    plates.forEach((pl, i) => {
      files[`plate_${i + 1}.stl`] = writeStl(plateMeshes(i));
      files[`plate_${i + 1}.3mf`] = write3mf(pl.items.map((it, k) => ({ name: `${it.part.name} ${k + 1}`, mesh: placedMesh(it, p.printer.bed, pl.used) })));
    });
    for (const x of res.parts) files[`parts/${safeName(x.id)}_${safeName(x.name)}.stl`] = writeStl([x.mesh]);
    files[`${base}.boarddock.json`] = strToU8(JSON.stringify(p, null, 1));
    files['README.txt'] = strToU8(printNotes(p, res, plates.length, tot));
    download(`${base}_boarddock.zip`, zipSync(files), 'application/zip');
  };
  return (
    <div>
      <div className="bigstat">
        <div><b>{plates.length}</b><span>plate{plates.length > 1 ? 's' : ''}</span></div>
        <div><b>{tot.g.toFixed(0)} g</b><span>{activeModule(p).holder.material}</span></div>
        <div><b>{fmtMin(tot.m)}</b><span>print time, rough</span></div>
      </div>
      <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }} onClick={() => zipAll()}><Icon d={I.download} /> Download everything (.zip)</button>
      <Section title="Printer">
        <Pick label="Printer" value={p.printer.name} options={[...PRINTERS.map((x) => [x.name, x.name] as [string, string]), ['Custom', 'Custom']]} onChange={(v) => setP((x) => { const pr = PRINTERS.find((q) => q.name === v); if (pr) Object.assign(x, pr); else x.name = 'Custom'; })} />
        <div className="row3" style={{ marginTop: 8 }}>
          <Num label="Bed X" value={p.printer.bed[0]} min={50} onChange={(v) => setP((x) => { x.bed = [v, x.bed[1]]; x.name = 'Custom'; })} />
          <Num label="Bed Y" value={p.printer.bed[1]} min={50} onChange={(v) => setP((x) => { x.bed = [x.bed[0], v]; x.name = 'Custom'; })} />
          <Num label="Spacing" value={p.printer.spacing} min={2} max={20} onChange={(v) => setP((x) => { x.spacing = v; })} />
        </div>
        <div className="row" style={{ marginTop: 8 }}><Num label="Sets to print" unit="" step={1} min={1} max={50} value={copies} onChange={(v) => setCopies(Math.round(v))} /></div>
      </Section>
      <Section title={`${plates.length} plate${plates.length > 1 ? 's' : ''}`}>
        <div className="plates">
          {plates.map((pl, i) => (
            <div key={i} className="plate">
              <PlateThumb pl={pl} bed={p.printer.bed} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <span>Plate {i + 1} · {pl.items.length} parts</span>
                <span className="btns"><button className="btn small" onClick={() => download(`${base}_plate${i + 1}.stl`, writeStl(plateMeshes(i)))}>STL</button><button className="btn small" onClick={() => download(`${base}_plate${i + 1}.3mf`, write3mf(pl.items.map((it, k) => ({ name: `${it.part.name} ${k + 1}`, mesh: placedMesh(it, p.printer.bed, pl.used) }))))}>3MF</button></span>
              </div>
            </div>
          ))}
        </div>
        <div className="btns" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => download(`${base}.boarddock.json`, JSON.stringify(p, null, 1), 'application/json')}>Save project</button>
          <button className="btn ghost" onClick={() => store.set({ view: 'print' })}>Show plates in 3D</button>
        </div>
      </Section>
      {p.layout === 'panel' && <TestKitSection />}
      <Section title="Estimate">
        <table className="table"><tbody>
          <tr><th>Part</th><th className="num">Qty</th><th className="num">Filament</th><th className="num">Time</th></tr>
          {est.map((e) => <tr key={e.part.id}><td>{e.part.name}</td><td className="num">{e.part.qty * copies}</td><td className="num">{e.grams.toFixed(1)} g</td><td className="num">{fmtMin(e.minutes)}</td></tr>)}
          <tr><td><b>Total</b></td><td /><td className="num"><b>{tot.g.toFixed(0)} g</b></td><td className="num"><b>{fmtMin(tot.m)}</b></td></tr>
        </tbody></table>
        <p className="hint">Rough: 3 walls, 5 top/bottom layers, 15% infill, 0.2 mm layers, {activeModule(p).holder.material}. Your slicer's numbers are the real ones.</p>
      </Section>
      <Section title="Print settings">
        <ul className="fmt">
          <li>{activeModule(p).holder.material}, 0.2 mm layers, 0.4 mm nozzle, 3 walls, 15% infill.</li>
          <li><b>No supports</b>: every part is already oriented, and overhangs are 45° or short bridges.</li>
          <li>The DIN clip prints on its side, so its spring bends within the layers. Keep its first-layer squish normal: the jaw is printed in place with a 0.3 mm gap.</li>
          <li>Print one clip and one plug cap first to check the fit on your printer.</li>
        </ul>
      </Section>
    </div>
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

function printNotes(p: Project, res: NonNullable<ReturnType<typeof store.get>['result']>, nPlates: number, tot: { g: number; m: number }) {
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
    '  1. Press the DIN clip into the holder until both hooks click (any of 4 orientations).',
    '  2. Drop the board in: it snaps under the wall fingers (or onto the snap pins).',
    ...(p.modules.length > 1 ? [p.arrange.mode === 'stack' ? '     Stack: press each layer onto the corner pegs of the layer below.' : p.arrange.mode === 'side' ? '     Side by side: drop a link bar into each pair of facing slots.' : '     Back to back: push the snap rivets through both bases.'] : []),
    '  3. Hook the clip over the top of the rail and push the bottom in until it clicks.',
    '  4. To remove: pull the tab towards you; the holder tilts off.',
    '  5. Plugs: lay the plug in its cradle, slide it home, press the cap on.',
    '',
    'Checks:',
    ...res.report.checks.map((c) => `  [${c.status}] ${c.group} / ${c.name}: ${c.value}${c.detail ? ` (${c.detail})` : ''}`),
    ...(res.report.warnings.length ? ['', 'Warnings:', ...res.report.warnings.map((w) => `  - ${w}`)] : []),
  ];
  return lines.join('\n');
}

// ============================================================================================ BOARDS & LAYOUT
/** Switch which board the Board / Plugs / Holder panels edit (only shown with several boards). */
function ModulePicker() {
  const p = useApp((s) => s.project)!;
  if (p.modules.length < 2) return null;
  return (
    <div className="section" style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="hint" style={{ margin: 0, whiteSpace: 'nowrap' }}>Editing</span>
      <select value={p.active} onChange={(e) => { edit((q) => { q.active = +e.target.value; }); select([]); }}>
        {p.modules.map((m, i) => <option key={m.id} value={i}>{i + 1}. {m.board.name}</option>)}
      </select>
      <span className="chip">{p.active + 1} / {p.modules.length}</span>
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
          <div key={m.id} className={`item ${p.active === i ? 'sel' : ''}`} onClick={() => edit((q) => { q.active = i; })}>
            <span className="grow"><b>{i + 1}.</b> {m.board.name} <small>{round(bbox(m.board.outline).x1 - bbox(m.board.outline).x0, 0)} × {round(bbox(m.board.outline).y1 - bbox(m.board.outline).y0, 0)} mm</small></span>
            {multi && i > 0 && <button className="btn small ghost" title="Move up" onClick={(e) => { e.stopPropagation(); edit((q) => { [q.modules[i - 1], q.modules[i]] = [q.modules[i], q.modules[i - 1]]; q.active = i - 1; }); }}>↑</button>}
            <button className="btn small ghost" title="Duplicate this board and its holder" onClick={(e) => { e.stopPropagation(); duplicateModule(i); }}>⧉</button>
            {multi && <button className="btn small ghost danger" title="Remove" onClick={(e) => { e.stopPropagation(); edit((q) => { q.modules.splice(i, 1); q.active = Math.min(q.active, q.modules.length - 1); }); }}>✕</button>}
          </div>
        ))}
      </div>
      {multi ? (
        <>
          <div style={{ marginTop: 10 }}><Seg value={A.mode} options={[['stack', 'Stacked'], ['side', 'Side by side'], ['back', 'Back to back']]} onChange={(v) => setA((a) => { a.mode = v; })} /></div>
          {A.mode === 'stack' && <>
            <p className="hint">Board 1 is at the bottom and carries the mount. Each holder gets four corner towers; the next layer presses onto their pegs. Towers clear the tallest part plus the gap.</p>
            <div className="row" style={{ marginTop: 6 }}><Num label="Gap above tallest part" value={A.stackGap} min={0} max={40} onChange={(v) => setA((a) => { a.stackGap = v; })} /></div>
          </>}
          {A.mode === 'side' && <>
            <p className="hint">Holders sit next to each other. On a DIN rail each gets its own clip; printed link bars lock neighbours together.</p>
            <div className="row" style={{ marginTop: 6 }}>
              {p.mount.kind === 'din' ? <div className="field"><span>Row along</span><div className="static">the rail</div></div> : <Pick label="Row along" value={A.sideAxis} options={[['x', 'Board X'], ['y', 'Board Y']]} onChange={(v) => setA((a) => { a.sideAxis = v; })} />}
              <Num label="Extra gap" value={A.sideGap} min={0} max={20} onChange={(v) => setA((a) => { a.sideGap = v; })} />
            </div>
            <div style={{ marginTop: 6 }}><Check label="Link bars between neighbours" value={A.links} onChange={(v) => setA((a) => { a.links = v; })} /></div>
          </>}
          {A.mode === 'back' && <p className="hint">Boards 1 and 2 base to base, components facing out on both sides, held by printed snap rivets. Use the DIN clip "standing off the rail" so it sits on an edge.</p>}
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
      <p className="hint">Small parts only matter under the board or near the walls; hiding them frees room for snap fingers and labels. Everything here can be undone (⌘Z).</p>
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
      <p className="hint" style={{ marginTop: 0 }}>One rail shoe, one socket and a small tongue key with its release rod: about 30 to 40 minutes. Clip the shoe on your rail, push the key in until it clicks, press its button and lift. If the key is tight, raise <b>Tongue fit</b> in the Panel step by 0.05 to 0.1 mm and print the kit again.</p>
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
      {!b.holes.length ? <p className="hint" style={{ marginTop: 0 }}>No holes: the board sits on edge seats and snap fingers hold it.</p> : (
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
                      <div style={{ minWidth: 0 }}>Hole {i + 1} <span className="mono" style={{ color: 'var(--subtle)', fontSize: 11 }}>Ø{round(h.d, 2)} · {round(h.x, 1)}, {round(h.y, 1)}</span><small>{h.why ?? guess.get(h.id)?.why}</small></div>
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

// ============================================================================================ HOLDER STYLE
function HolderStyle() {
  const p = useApp((s) => s.project)!;
  const res = useApp((s) => s.result);
  const m = activeModule(p);
  const style = m.holder.style ?? 'frame';
  const holder = res?.parts.find((x) => x.tag?.kind === 'holder' && x.tag.module === m.id);
  const g = holder ? estimate(holder, MATERIALS[m.holder.material].density) : null;
  const card = (k: 'frame' | 'tray', name: string, text: string, art: ReactNode) => (
    <button className={`stylecard ${style === k ? 'on' : ''}`} onClick={() => editMod((q) => { q.holder.style = k; })}>
      {art}
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
