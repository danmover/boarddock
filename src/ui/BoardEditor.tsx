// 2D board editor. Select with click, Shift/Cmd-click to add, or drag a box. Drag to move everything selected.
// Pan: right/middle drag, Space+drag or the hand tool. Wheel zooms. Keys: Cmd/Ctrl+A all, Esc none, Del delete,
// arrows nudge (Shift = 1 mm), R rotate 90 degrees, Cmd/Ctrl+D duplicate.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Board, Comp, Project, V2 } from '../model/types';
import { bbox, compRect, deg, extentAlong, nearestEdge, rad, uid } from '../geom/poly';
import { CONNECTORS, connById, connSetup } from '../model/library';
import { activeModule, commitFrom, editMod, isSel, select, store, useApp, type SelItem } from '../state';
import { ROLE_INFO } from '../model/holes';

export type Tool = 'select' | 'pan' | 'hole' | 'connector' | 'part';

const KIND: Record<string, { fill: string; stroke: string }> = {
  connector: { fill: '#c9d3dd', stroke: '#e8eef4' },
  header: { fill: '#2b3440', stroke: '#8795a6' },
  switch: { fill: '#55606d', stroke: '#9aa6b3' },
  led: { fill: '#ffd166', stroke: '#fff1c2' },
  module: { fill: '#5b6b7c', stroke: '#a7b6c6' },
  hot: { fill: '#ff6b5b', stroke: '#ffb3aa' },
  antenna: { fill: '#5aa9ff', stroke: '#b7d8ff' },
  generic: { fill: '#3d4957', stroke: '#8b99a8' },
};

export function makeConnector(b: Board, typeId: string, at: V2): Comp {
  const t = connById(typeId);
  const e = nearestEdge(at, b.outline);
  const angle = Math.round(deg(Math.atan2(e.n[1], e.n[0])) * 10) / 10;
  const c: Comp = {
    id: uid('c'), ref: `J${b.comps.filter((x) => x.conn).length + 1}`, pkg: t.name, side: 'top', x: 0, y: 0, rot: angle - 90,
    w: t.body.w, l: t.body.l, h: t.body.h, kind: t.entry === 'top' && t.id === 'header' ? 'header' : 'connector', tht: false, conn: connSetup(t, angle),
  };
  const ext = extentAlong(c, angle);
  c.x = e.q[0] + e.n[0] * (t.overhang - ext);
  c.y = e.q[1] + e.n[1] * (t.overhang - ext);
  if (t.entry === 'top') { c.x = at[0]; c.y = at[1]; c.rot = 0; }
  return c;
}

const snap = (v: number) => Math.round(v * 10) / 10;

export function BoardEditor({ tool, setTool }: { tool: Tool; setTool: (t: Tool) => void }) {
  const project = useApp((s) => s.project)!;
  const sel = useApp((s) => s.sel);
  const result = useApp((s) => s.result);
  const mod = activeModule(project);
  const b = mod.board, H = mod.holder;
  const bb = useMemo(() => bbox(b.outline), [b.outline]);
  const svg = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState(() => fitBox(bb));
  const [px, setPx] = useState(0.1); // mm per screen pixel
  const [cursor, setCursor] = useState<V2 | null>(null);
  const [marquee, setMarquee] = useState<{ a: V2; b: V2 } | null>(null);
  const [space, setSpace] = useState(false);
  const [connType, setConnType] = useState('usb_c');
  const drag = useRef<{ kind: 'pan' | 'move' | 'box'; start: V2; client: V2; vb0: typeof vb; orig?: Map<string, V2>; moved?: boolean; pre?: Project; additive?: boolean } | null>(null);

  useEffect(() => setVb(fitBox(bb)), [bb.x0, bb.y0, bb.x1, bb.y1]);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const upd = () => { const r = el.getBoundingClientRect(); setPx(Math.max(vb.w / Math.max(1, r.width), vb.h / Math.max(1, r.height))); };
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    upd();
    return () => ro.disconnect();
  }, [vb.w, vb.h]);

  const toWorld = (e: { clientX: number; clientY: number }): V2 => {
    const r = svg.current!.getBoundingClientRect();
    const s = Math.max(vb.w / r.width, vb.h / r.height);
    const ox = vb.x + (vb.w - r.width * s) / 2, oy = vb.y + (vb.h - r.height * s) / 2;
    return [ox + (e.clientX - r.left) * s, -(oy + (e.clientY - r.top) * s)];
  };

  const items = (): { it: SelItem; at: V2 }[] => [
    ...b.holes.map((h) => ({ it: { kind: 'hole' as const, id: h.id }, at: [h.x, h.y] as V2 })),
    ...b.comps.filter((c) => !c.hidden).map((c) => ({ it: { kind: 'comp' as const, id: c.id }, at: [c.x, c.y] as V2 })),
  ];

  const onWheel = (e: React.WheelEvent) => {
    const w = toWorld(e);
    const k = Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.0022);
    setVb((v) => ({ x: w[0] - (w[0] - v.x) * k, y: -w[1] - (-w[1] - v.y) * k, w: v.w * k, h: v.h * k }));
  };

  const onDown = (e: React.PointerEvent) => {
    const w = toWorld(e);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const panning = e.button === 1 || e.button === 2 || space || tool === 'pan';
    if (panning) { drag.current = { kind: 'pan', start: w, client: [e.clientX, e.clientY], vb0: vb }; return; }
    if (tool === 'hole') {
      editMod((m) => { m.board.holes.push({ id: uid('h'), x: snap(w[0]), y: snap(w[1]), d: 3.2, plated: false, use: 'auto', role: 'mount', why: 'added by hand' }); });
      const h = activeModule(store.get().project!).board.holes.at(-1)!;
      select([{ kind: 'hole', id: h.id }], e.shiftKey ? 'add' : 'set');
      return;
    }
    if (tool === 'connector' || tool === 'part') {
      const c: Comp = tool === 'connector' ? makeConnector(b, connType, w) : { id: uid('c'), ref: `K${b.comps.length + 1}`, pkg: 'keep-out box', side: 'top', x: snap(w[0]), y: snap(w[1]), rot: 0, w: 5, l: 5, h: 5, kind: 'generic', tht: false };
      editMod((m) => { m.board.comps.push(c); });
      select([{ kind: 'comp', id: c.id }]);
      if (!e.shiftKey) setTool('select');
      return;
    }
    const target = (e.target as SVGElement).closest('[data-id]') as SVGElement | null;
    const multi = e.shiftKey || e.metaKey || e.ctrlKey;
    if (target) {
      const it: SelItem = { kind: target.dataset.kind as 'hole' | 'comp', id: target.dataset.id! };
      if (multi) select([it], 'toggle');
      else if (!isSel(sel, it.id)) select([it]);
      const now = store.get().sel;
      const orig = new Map<string, V2>();
      for (const s of now) {
        const o = s.kind === 'hole' ? b.holes.find((h) => h.id === s.id) : b.comps.find((c) => c.id === s.id);
        if (o) orig.set(s.id, [o.x, o.y]);
      }
      drag.current = { kind: 'move', start: w, client: [e.clientX, e.clientY], vb0: vb, orig, pre: store.get().project! };
    } else {
      if (!multi) select([]);
      drag.current = { kind: 'box', start: w, client: [e.clientX, e.clientY], vb0: vb, additive: multi };
      setMarquee({ a: w, b: w });
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const w = toWorld(e);
    setCursor(w);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const r = svg.current!.getBoundingClientRect();
      const s = Math.max(d.vb0.w / r.width, d.vb0.h / r.height);
      setVb({ ...d.vb0, x: d.vb0.x - (e.clientX - d.client[0]) * s, y: d.vb0.y - (e.clientY - d.client[1]) * s });
    } else if (d.kind === 'box') {
      setMarquee({ a: d.start, b: w });
    } else if (d.orig) {
      if (!d.moved && Math.hypot(e.clientX - d.client[0], e.clientY - d.client[1]) < 3) return;
      d.moved = true;
      const dx = w[0] - d.start[0], dy = w[1] - d.start[1];
      const p = structuredClone(store.get().project!);
      const mb = activeModule(p).board;
      for (const [id, o] of d.orig) {
        const it = mb.holes.find((h) => h.id === id) ?? mb.comps.find((c) => c.id === id);
        if (it) { it.x = snap(o[0] + dx); it.y = snap(o[1] + dy); }
      }
      store.set({ project: p });
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'move' && d.moved && d.pre) commitFrom(d.pre);
    if (d?.kind === 'box' && marquee) {
      const x0 = Math.min(marquee.a[0], marquee.b[0]), x1 = Math.max(marquee.a[0], marquee.b[0]);
      const y0 = Math.min(marquee.a[1], marquee.b[1]), y1 = Math.max(marquee.a[1], marquee.b[1]);
      if (x1 - x0 > px * 3 || y1 - y0 > px * 3) {
        const hit = items().filter(({ at }) => at[0] >= x0 && at[0] <= x1 && at[1] >= y0 && at[1] <= y1).map((i) => i.it);
        select(hit, d.additive ? 'add' : 'set');
      }
      setMarquee(null);
    }
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === ' ') { setSpace(true); e.preventDefault(); return; }
      const cmd = e.metaKey || e.ctrlKey;
      const s = store.get().sel;
      const mb = activeModule(store.get().project!).board;
      if (cmd && e.key.toLowerCase() === 'a') { e.preventDefault(); select([...mb.holes.map((h) => ({ kind: 'hole' as const, id: h.id })), ...mb.comps.filter((c) => !c.hidden).map((c) => ({ kind: 'comp' as const, id: c.id }))]); return; }
      if (e.key === 'Escape') { select([]); setTool('select'); return; }
      if (!s.length) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel(s); return; }
      if (cmd && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(s); return; }
      if (e.key.toLowerCase() === 'r' && !cmd) { rotateSel(s, e.shiftKey ? -90 : 90); return; }
      const step = e.shiftKey ? 1 : 0.1;
      const mv: Record<string, V2> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (mv[e.key]) { e.preventDefault(); moveSel(s, mv[e.key]); }
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ') setSpace(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const path = (l: V2[]) => 'M' + l.map(([x, y]) => `${x.toFixed(3)},${(-y).toFixed(3)}`).join('L') + 'Z';
  const fs = (n: number) => n * px; // screen-constant sizes
  const clipAt = result?.report.clipAt;
  const levels = result?.report.levels;
  const nSel = sel.length;

  return (
    <div className="editor" style={{ position: 'absolute', inset: 0 }} onContextMenu={(e) => e.preventDefault()}>
      <svg ref={svg} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        style={{ cursor: space || tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }}>
        <defs>
          <pattern id="g1" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="var(--grid-fine)" strokeWidth={fs(0.6)} /></pattern>
          <pattern id="g10" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill={px < 0.06 ? 'url(#g1)' : 'none'} /><path d="M10 0H0V10" fill="none" stroke="var(--grid)" strokeWidth={fs(1)} /></pattern>
          <pattern id="hatch" width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.4" stroke="var(--copper)" strokeOpacity="0.45" strokeWidth={0.3} /></pattern>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={fs(2.5)} result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--copper)" /></marker>
        </defs>
        <rect x={vb.x - vb.w * 2} y={vb.y - vb.h * 2} width={vb.w * 5} height={vb.h * 5} fill="url(#g10)" />
        {levels && <path d={path(b.outline)} fill="none" stroke="var(--accent)" strokeOpacity={0.22} strokeWidth={(H.gap + H.wall) * 2} strokeLinejoin="round" />}
        <path d={path(b.outline) + b.cutouts.map(path).join('')} fill="var(--mask)" fillRule="evenodd" stroke="var(--mask-edge)" strokeWidth={fs(1.5)} />
        {b.comps.filter((c) => !c.hidden && c.conn?.entry === 'edge').map((c) => {
          const d = c.conn!;
          const m: V2 = [c.x + Math.cos(rad(d.angle)) * extentAlong(c, d.angle), c.y + Math.sin(rad(d.angle)) * extentAlong(c, d.angle)];
          const pp = plugPoly(m, d.angle, d.plug.w, d.plug.len);
          const tip: V2 = [m[0] + Math.cos(rad(d.angle)) * 0.5, m[1] + Math.sin(rad(d.angle)) * 0.5];
          const L = Math.min(d.plug.len * 0.7, 16);
          const tail: V2 = [m[0] + Math.cos(rad(d.angle)) * L, m[1] + Math.sin(rad(d.angle)) * L];
          return (
            <g key={'p' + c.id} style={{ pointerEvents: 'none' }}>
              <polygon points={pp.map(([x, y]) => `${x},${-y}`).join(' ')} fill="url(#hatch)" stroke="var(--copper)" strokeOpacity={0.7} strokeWidth={fs(1)} strokeDasharray={`${fs(4)} ${fs(3)}`} />
              <line x1={tail[0]} y1={-tail[1]} x2={tip[0]} y2={-tip[1]} stroke="var(--copper)" strokeWidth={fs(2)} markerEnd="url(#arr)" />
            </g>
          );
        })}
        {b.comps.filter((c) => !c.hidden).map((c) => {
          const r = compRect(c);
          const on = isSel(sel, c.id);
          const k = KIND[c.kind] ?? KIND.generic;
          const bottom = c.side === 'bottom';
          const lbl = Math.min(c.w, c.l) / Math.max(px, 1e-6) > 24;
          return (
            <g key={c.id} data-id={c.id} data-kind="comp" style={{ cursor: 'move' }}>
              <polygon points={r.map(([x, y]) => `${x},${-y}`).join(' ')} fill={k.fill} fillOpacity={bottom ? 0.18 : 0.88} stroke={on ? 'var(--accent)' : k.stroke} strokeOpacity={on ? 1 : 0.7} strokeWidth={fs(on ? 2.5 : 1)} strokeDasharray={bottom ? `${fs(5)} ${fs(3)}` : undefined} strokeLinejoin="round" filter={on ? 'url(#glow)' : undefined} />
              {lbl && <text x={c.x} y={-c.y} fontSize={fs(11)} textAnchor="middle" dominantBaseline="central" className={`silk ${c.kind === 'connector' || c.kind === 'led' ? 'dark' : ''}`} style={{ pointerEvents: 'none' }}>{c.ref}</text>}
            </g>
          );
        })}
        {b.holes.map((h) => {
          const on = isSel(sel, h.id);
          const role = h.role ?? 'mount';
          const col = ROLE_INFO[role].color;
          return (
            <g key={h.id} data-id={h.id} data-kind="hole" style={{ cursor: 'move' }}>
              <circle cx={h.x} cy={-h.y} r={h.d / 2 + 1.1} fill={col} fillOpacity={role === 'free' ? 0.5 : 0.92} stroke={on ? 'var(--accent)' : 'none'} strokeWidth={fs(2.5)} filter={on ? 'url(#glow)' : undefined} />
              <circle cx={h.x} cy={-h.y} r={h.d / 2} fill="var(--viewer)" />
              {role === 'mount' && h.use === 'snap' && <path d={`M${h.x - h.d / 2},${-h.y}H${h.x + h.d / 2}`} stroke={col} strokeWidth={fs(1.5)} />}
            </g>
          );
        })}
        {clipAt && project.mount.kind === 'din' && project.mount.mode === 'flat' && project.active === 0 && (
          <g style={{ pointerEvents: 'none' }} opacity={0.9}>
            <circle cx={clipAt[0]} cy={-clipAt[1]} r={fs(9)} fill="none" stroke="var(--coral)" strokeWidth={fs(1.5)} strokeDasharray={`${fs(3)} ${fs(2)}`} />
            <path d={`M${clipAt[0] - fs(14)},${-clipAt[1]}H${clipAt[0] + fs(14)}M${clipAt[0]},${-clipAt[1] - fs(14)}V${-clipAt[1] + fs(14)}`} stroke="var(--coral)" strokeWidth={fs(1)} />
            <text x={clipAt[0] + fs(16)} y={-clipAt[1] - fs(10)} fontSize={fs(10.5)} fill="var(--coral)" className="mono">DIN CLIP</text>
          </g>
        )}
        {marquee && (
          <rect x={Math.min(marquee.a[0], marquee.b[0])} y={-Math.max(marquee.a[1], marquee.b[1])} width={Math.abs(marquee.b[0] - marquee.a[0])} height={Math.abs(marquee.b[1] - marquee.a[1])}
            fill="var(--accent)" fillOpacity={0.08} stroke="var(--accent)" strokeWidth={fs(1)} strokeDasharray={`${fs(4)} ${fs(3)}`} />
        )}
        <g style={{ pointerEvents: 'none' }}>
          <DimLine a={[bb.x0, bb.y1]} b={[bb.x1, bb.y1]} off={fs(30)} px={px} label={`${(bb.x1 - bb.x0).toFixed(1)}`} />
          <DimLine a={[bb.x0, bb.y0]} b={[bb.x0, bb.y1]} off={-fs(30)} px={px} label={`${(bb.y1 - bb.y0).toFixed(1)}`} vertical />
        </g>
      </svg>

      <div className="toolbar floating">
        {([['select', 'Select', 'M5 3l14 8-6 2-2 6z'], ['pan', 'Pan', 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3'], ['hole', 'Hole', 'M12 5a7 7 0 100 14a7 7 0 100-14M12 9a3 3 0 100 6a3 3 0 100-6'], ['connector', 'Connector', 'M4 9h10v6H4zM14 10h4M14 14h4M18 8v8'], ['part', 'Keep-out', 'M4 4h16v16H4zM4 4l16 16M20 4L4 20']] as [Tool, string, string][]).map(([t, label, d]) => (
          <button key={t} className={`tbtn ${tool === t ? 'on' : ''}`} onClick={() => setTool(t)} title={label}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
            <span>{label}</span>
          </button>
        ))}
        {tool === 'connector' && (
          <select value={connType} onChange={(e) => setConnType(e.target.value)} className="tsel">
            {CONNECTORS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <span className="tsep" />
        <button className="tbtn" onClick={() => setVb(fitBox(bb))} title="Fit to view">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg><span>Fit</span>
        </button>
      </div>

      {nSel > 0 && (
        <div className="selbar floating">
          <b className="mono">{nSel} selected</b>
          <button className="btn small ghost" onClick={() => rotateSel(sel, 90)} title="R">Rotate 90°</button>
          <button className="btn small ghost" onClick={() => duplicateSel(sel)} title="Cmd/Ctrl+D">Duplicate</button>
          {nSel > 1 && <>
            <span className="tsep" />
            <button className="btn small ghost icon" onClick={() => alignSel(sel, 'x', 'min')} title="Align left">⇤</button>
            <button className="btn small ghost icon" onClick={() => alignSel(sel, 'x', 'mid')} title="Centre on one vertical line">⇹</button>
            <button className="btn small ghost icon" onClick={() => alignSel(sel, 'x', 'max')} title="Align right">⇥</button>
            <button className="btn small ghost icon" onClick={() => alignSel(sel, 'y', 'max')} title="Align top">⤒</button>
            <button className="btn small ghost icon" onClick={() => alignSel(sel, 'y', 'min')} title="Align bottom">⤓</button>
            {nSel > 2 && <button className="btn small ghost" onClick={() => distributeSel(sel)} title="Space evenly">Distribute</button>}
          </>}
          <span className="tsep" />
          <button className="btn small danger" onClick={() => removeSel(sel)} title="Delete">Delete</button>
          <button className="btn small ghost icon" onClick={() => select([])} title="Esc">✕</button>
        </div>
      )}

      {b.holes.length > 0 && (
        <div className="legend2 floating">
          {(['mount', 'standoff', 'plug', 'lead', 'free'] as const).filter((r) => b.holes.some((h) => (h.role ?? 'mount') === r)).map((r) => <span key={r}><i style={{ background: ROLE_INFO[r].color }} />{ROLE_INFO[r].name}</span>)}
        </div>
      )}
      <div className="hud floating mono">
        <span>{tool === 'hole' ? 'click to place holes · Shift keeps the tool' : tool === 'connector' ? 'click near an edge to add the connector there' : tool === 'part' ? 'click to drop a keep-out box' : 'box-drag selects · Shift-click adds · right-drag pans · wheel zooms · ⌘A  R  ⌘D  Del'}</span>
        {cursor && <span className="xy">{cursor[0].toFixed(1)}, {cursor[1].toFixed(1)}</span>}
      </div>
    </div>
  );
}

function DimLine({ a, b, off, px, label, vertical }: { a: V2; b: V2; off: number; px: number; label: string; vertical?: boolean }) {
  const [ax, ay] = vertical ? [a[0] + off, a[1]] : [a[0], a[1] + off];
  const [bx, by] = vertical ? [b[0] + off, b[1]] : [b[0], b[1] + off];
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const t = 4 * px;
  return (
    <>
      <line x1={a[0]} y1={-a[1]} x2={ax} y2={-ay} stroke="var(--subtle)" strokeWidth={px} />
      <line x1={b[0]} y1={-b[1]} x2={bx} y2={-by} stroke="var(--subtle)" strokeWidth={px} />
      <line x1={ax} y1={-ay} x2={bx} y2={-by} stroke="var(--muted)" strokeWidth={px * 1.2} />
      <path d={vertical ? `M${ax - t},${-ay - t}L${ax + t},${-ay + t}M${bx - t},${-by - t}L${bx + t},${-by + t}` : `M${ax - t},${-ay + t}L${ax + t},${-ay - t}M${bx - t},${-by + t}L${bx + t},${-by - t}`} stroke="var(--muted)" strokeWidth={px * 1.2} />
      <g transform={`translate(${mx},${-my})${vertical ? ' rotate(-90)' : ''}`}>
        <rect x={-label.length * 3.6 * px - 7 * px} y={-9 * px} width={label.length * 7.2 * px + 14 * px} height={18 * px} rx={9 * px} fill="var(--panel)" stroke="var(--line)" strokeWidth={px} />
        <text x={0} y={0} fontSize={11 * px} textAnchor="middle" dominantBaseline="central" className="mono" fill="var(--fg)">{label}</text>
      </g>
    </>
  );
}

function plugPoly(m: V2, a: number, w: number, len: number): V2[] {
  const d: V2 = [Math.cos(rad(a)), Math.sin(rad(a))], t: V2 = [-d[1], d[0]];
  const p = (s: number, u: number): V2 => [m[0] + d[0] * s + t[0] * u, m[1] + d[1] * s + t[1] * u];
  return [p(0.4, -w / 2), p(0.4 + len, -w / 2), p(0.4 + len, w / 2), p(0.4, w / 2)];
}

function fitBox(bb: { x0: number; y0: number; x1: number; y1: number }) {
  const m = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.35 + 14;
  return { x: bb.x0 - m, y: -bb.y1 - m, w: bb.x1 - bb.x0 + 2 * m, h: bb.y1 - bb.y0 + 2 * m };
}

// ---- actions on the selection (all undoable) ----
function each(s: SelItem[], fn: (it: { x: number; y: number }, kind: 'hole' | 'comp') => void) {
  editMod((m) => {
    for (const x of s) {
      const it = x.kind === 'hole' ? m.board.holes.find((h) => h.id === x.id) : m.board.comps.find((c) => c.id === x.id);
      if (it) fn(it, x.kind as 'hole' | 'comp');
    }
  });
}

export function removeSel(s: SelItem[]) {
  const ids = new Set(s.map((x) => x.id));
  editMod((m) => { m.board.holes = m.board.holes.filter((h) => !ids.has(h.id)); m.board.comps = m.board.comps.filter((c) => !ids.has(c.id)); });
  select([]);
}

export function moveSel(s: SelItem[], d: V2) {
  each(s, (it) => { it.x = snap(it.x + d[0]); it.y = snap(it.y + d[1]); });
}

export function rotateSel(s: SelItem[], by: number) {
  // rotate the group about its centre; parts also turn their bodies and plug directions
  const mb = activeModule(store.get().project!).board;
  const pts = s.map((x) => (x.kind === 'hole' ? mb.holes.find((h) => h.id === x.id) : mb.comps.find((c) => c.id === x.id))).filter(Boolean) as { x: number; y: number }[];
  if (!pts.length) return;
  const cx = pts.reduce((a, q) => a + q.x, 0) / pts.length, cy = pts.reduce((a, q) => a + q.y, 0) / pts.length;
  const c = Math.cos(rad(by)), sn = Math.sin(rad(by));
  each(s, (it, kind) => {
    const dx = it.x - cx, dy = it.y - cy;
    it.x = snap(cx + dx * c - dy * sn);
    it.y = snap(cy + dx * sn + dy * c);
    if (kind === 'comp') {
      const cc = it as Comp;
      cc.rot = (cc.rot + by) % 360;
      if (cc.conn) cc.conn.angle = (((cc.conn.angle + by) % 360) + 360) % 360;
    }
  });
}

export function duplicateSel(s: SelItem[]) {
  const fresh: SelItem[] = [];
  editMod((m) => {
    for (const x of s) {
      if (x.kind === 'hole') { const h = m.board.holes.find((q) => q.id === x.id); if (h) { const n = { ...h, id: uid('h'), x: h.x + 2, y: h.y - 2 }; m.board.holes.push(n); fresh.push({ kind: 'hole', id: n.id }); } }
      else { const c = m.board.comps.find((q) => q.id === x.id); if (c) { const n = { ...structuredClone(c), id: uid('c'), ref: c.ref + "'", x: c.x + 2, y: c.y - 2 }; m.board.comps.push(n); fresh.push({ kind: 'comp', id: n.id }); } }
    }
  });
  select(fresh);
}

export function alignSel(s: SelItem[], axis: 'x' | 'y', where: 'min' | 'mid' | 'max') {
  const mb = activeModule(store.get().project!).board;
  const vals = s.map((x) => (x.kind === 'hole' ? mb.holes.find((h) => h.id === x.id) : mb.comps.find((c) => c.id === x.id))?.[axis]).filter((v): v is number => v !== undefined);
  const target = where === 'min' ? Math.min(...vals) : where === 'max' ? Math.max(...vals) : vals.reduce((a, v) => a + v, 0) / vals.length;
  each(s, (it) => { it[axis] = snap(target); });
}

export function distributeSel(s: SelItem[]) {
  const mb = activeModule(store.get().project!).board;
  const list: { x: SelItem; o: { x: number; y: number } }[] = [];
  for (const x of s) { const o = x.kind === 'hole' ? mb.holes.find((h) => h.id === x.id) : mb.comps.find((c) => c.id === x.id); if (o) list.push({ x, o }); }
  const spanX = Math.max(...list.map((q) => q.o.x)) - Math.min(...list.map((q) => q.o.x));
  const spanY = Math.max(...list.map((q) => q.o.y)) - Math.min(...list.map((q) => q.o.y));
  const axis: 'x' | 'y' = spanX >= spanY ? 'x' : 'y';
  list.sort((a, b) => a.o[axis] - b.o[axis]);
  const lo = list[0].o[axis], hi = list[list.length - 1].o[axis];
  const target = new Map(list.map((q, i) => [q.x.id, lo + ((hi - lo) * i) / (list.length - 1)]));
  editMod((m) => {
    for (const [id, v] of target) {
      const it = m.board.holes.find((h) => h.id === id) ?? m.board.comps.find((c) => c.id === id);
      if (it) it[axis] = snap(v);
    }
  });
}
