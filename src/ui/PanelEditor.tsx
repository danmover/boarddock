// The panel as seen on the wall: DIN rails, docks and the boards in them, with the direction every plug points.
// Drag docks along or between rails, drag rails to move them, drag boards from the sidebar onto a rail or a dock.
// Keys: R / Shift+R turn, F swap front and back, arrows move along the rail (Shift = 10 mm), Del remove,
// Cmd/Ctrl+A select all docks, Esc clear.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Access, PanelReport, V2 } from '../model/types';
import { isSel, select, store, useApp, type SelItem } from '../state';
import { addDock, addRail, autoArrange, moveRail, nudge, placeMount, removeMounts, removeRails, seat, swapSlots, turnMounts } from './panelOps';

export const PALETTE = ['#3ddc97', '#6cb6ff', '#ffc857', '#ff8fa3', '#b69cff', '#5eead4', '#fdba74', '#a3e635'];
export const MODULE_DRAG = 'application/x-boarddock-module';

const ARROW: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→', front: '◉', wall: '✕' };

type Box = { x: number; y: number; w: number; h: number };
function fit(r: PanelReport | null): Box {
  if (!r || !r.mounts.length) return { x: -60, y: -120, w: 320, h: 240 };
  const xs: number[] = [], ys: number[] = [];
  for (const m of r.mounts) { xs.push(m.foot[0], m.foot[2]); ys.push(m.foot[1], m.foot[3]); }
  for (const l of r.rails) { xs.push(l.x, l.dir === 'h' ? l.x + l.length : l.x); ys.push(l.y, l.dir === 'v' ? l.y + l.length : l.y); }
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const m = Math.max(x1 - x0, y1 - y0) * 0.12 + 30;
  return { x: x0 - m, y: -y1 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
}

export function accessCounts(a: Access[]) {
  return { good: a.filter((x) => x.ok === 'good').length, side: a.filter((x) => x.ok === 'side').length, blocked: a.filter((x) => x.ok === 'blocked').length, front: a.filter((x) => x.dir === 'front').length };
}

export function PanelEditor() {
  const project = useApp((s) => s.project)!;
  const result = useApp((s) => s.result);
  const building = useApp((s) => s.building);
  const sel = useApp((s) => s.sel);
  const rep = result?.report.panel ?? null;
  const svg = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState<Box>(() => fit(rep));
  const [px, setPx] = useState(0.5);
  const [cursor, setCursor] = useState<V2 | null>(null);
  const [marquee, setMarquee] = useState<{ a: V2; b: V2 } | null>(null);
  const [ghost, setGhost] = useState<{ ids: string[]; d: V2; rail?: string | null; railMove?: string } | null>(null);
  const [dropAt, setDropAt] = useState<V2 | null>(null);
  const [space, setSpace] = useState(false);
  const drag = useRef<{ kind: 'pan' | 'move' | 'rail' | 'box'; start: V2; client: V2; vb0: Box; ids?: string[]; moved?: boolean; additive?: boolean } | null>(null);
  const fitted = useRef(false);

  const color = useMemo(() => new Map(project.modules.map((m, i) => [m.id, PALETTE[i % PALETTE.length]])), [project.modules]);
  const nameOf = (id: string | null) => project.modules.find((m) => m.id === id)?.board.name ?? '';

  useEffect(() => { if (rep && !fitted.current) { setVb(fit(rep)); fitted.current = true; } }, [rep]);
  useEffect(() => { setGhost(null); }, [result]);
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

  /** Nearest rail to a point (within reach), with the position along it. */
  const railAt = (w: V2, reach = 45): { id: string; at: number } | null => {
    let best: { id: string; at: number; d: number } | null = null;
    for (const r of rep?.rails ?? []) {
      const along = r.dir === 'h' ? w[0] - r.x : w[1] - r.y;
      const off = r.dir === 'h' ? Math.abs(w[1] - r.y) : Math.abs(w[0] - r.x);
      const out = Math.max(0, -along, along - r.length);
      const d = Math.hypot(off, out);
      if (d < reach && (!best || d < best.d)) best = { id: r.id, at: along, d };
    }
    return best;
  };

  const mountAt = (w: V2) => rep?.mounts.find((m) => w[0] >= m.foot[0] && w[0] <= m.foot[2] && w[1] >= m.foot[1] && w[1] <= m.foot[3]) ?? null;

  const onWheel = (e: React.WheelEvent) => {
    const w = toWorld(e);
    const k = Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.0022);
    setVb((v) => ({ x: w[0] - (w[0] - v.x) * k, y: -w[1] - (-w[1] - v.y) * k, w: v.w * k, h: v.h * k }));
  };

  const onDown = (e: React.PointerEvent) => {
    const w = toWorld(e);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || e.button === 2 || space) { drag.current = { kind: 'pan', start: w, client: [e.clientX, e.clientY], vb0: vb }; return; }
    const t = (e.target as SVGElement).closest('[data-kind]') as SVGElement | null;
    const multi = e.shiftKey || e.metaKey || e.ctrlKey;
    if (t) {
      const it: SelItem = { kind: t.dataset.kind as 'mount' | 'rail', id: t.dataset.id! };
      if (multi) select([it], 'toggle');
      else if (!isSel(sel, it.id)) select([it]);
      const now = store.get().sel;
      if (it.kind === 'rail') drag.current = { kind: 'rail', start: w, client: [e.clientX, e.clientY], vb0: vb, ids: [it.id] };
      else drag.current = { kind: 'move', start: w, client: [e.clientX, e.clientY], vb0: vb, ids: now.filter((s) => s.kind === 'mount').map((s) => s.id) };
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
    } else if (d.kind === 'box') setMarquee({ a: d.start, b: w });
    else {
      if (!d.moved && Math.hypot(e.clientX - d.client[0], e.clientY - d.client[1]) < 3) return;
      d.moved = true;
      const dd: V2 = [w[0] - d.start[0], w[1] - d.start[1]];
      if (d.kind === 'rail') setGhost({ ids: [], d: dd, railMove: d.ids![0] });
      else {
        const one = d.ids!.length === 1 ? rep?.mounts.find((m) => m.id === d.ids![0]) : null;
        const target = one ? railAt([one.x + dd[0], one.y + dd[1]], 40) : null;
        setGhost({ ids: d.ids!, d: dd, rail: target && target.id !== one?.rail ? target.id : null });
      }
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'box' && marquee) {
      const x0 = Math.min(marquee.a[0], marquee.b[0]), x1 = Math.max(marquee.a[0], marquee.b[0]);
      const y0 = Math.min(marquee.a[1], marquee.b[1]), y1 = Math.max(marquee.a[1], marquee.b[1]);
      if (x1 - x0 > px * 3 || y1 - y0 > px * 3) {
        const hit = (rep?.mounts ?? []).filter((m) => m.x >= x0 && m.x <= x1 && m.y >= y0 && m.y <= y1).map((m) => ({ kind: 'mount' as const, id: m.id }));
        select(hit, d.additive ? 'add' : 'set');
      }
      setMarquee(null);
      return;
    }
    if (!d?.moved || !ghost) return;
    if (d.kind === 'rail' && ghost.railMove) { moveRail(ghost.railMove, ghost.d[0], ghost.d[1]); return; }
    if (d.kind === 'move' && rep) {
      const ms = rep.mounts.filter((m) => d.ids!.includes(m.id));
      if (ms.length === 1) {
        const m = ms[0];
        const c: V2 = [m.x + ghost.d[0], m.y + ghost.d[1]];
        const tr = railAt(c, 40);
        const r = rep.rails.find((x) => x.id === (tr?.id ?? m.rail))!;
        placeMount(m.id, r.id, tr ? tr.at : m.at + (r.dir === 'h' ? ghost.d[0] : ghost.d[1]));
      } else {
        const r0 = rep.rails.find((x) => x.id === ms[0]?.rail);
        nudge(d.ids!, r0?.dir === 'v' ? ghost.d[1] : ghost.d[0]);
      }
    }
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === ' ') { setSpace(true); e.preventDefault(); return; }
      const cmd = e.metaKey || e.ctrlKey;
      const s = store.get().sel;
      const mounts = s.filter((x) => x.kind === 'mount').map((x) => x.id), rails = s.filter((x) => x.kind === 'rail').map((x) => x.id);
      const r = store.get().result?.report.panel;
      if (cmd && e.key.toLowerCase() === 'a') { e.preventDefault(); select((r?.mounts ?? []).map((m) => ({ kind: 'mount' as const, id: m.id }))); return; }
      if (e.key === 'Escape') { select([]); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (mounts.length) removeMounts(mounts); else if (rails.length) removeRails(rails); return; }
      if (!mounts.length) return;
      if (e.key.toLowerCase() === 'r' && !cmd) { turnMounts(mounts, e.shiftKey ? -90 : 90); return; }
      if (e.key.toLowerCase() === 'f' && !cmd) { swapSlots(mounts); return; }
      const step = e.shiftKey ? 10 : 1;
      const dirOf = (id: string) => r?.rails.find((x) => x.id === r.mounts.find((m) => m.id === id)?.rail)?.dir ?? 'h';
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
        const v = dirOf(mounts[0]) === 'v';
        const sgn = (v ? (k === 'ArrowUp' ? 1 : k === 'ArrowDown' ? -1 : 0) : (k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0));
        if (sgn) nudge(mounts, sgn * step);
      }
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ') setSpace(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(MODULE_DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropAt(toWorld(e));
  };
  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData(MODULE_DRAG);
    setDropAt(null);
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    const w = toWorld(e);
    const m = mountAt(w);
    if (m && m.kind === 'dock' && (!m.slots[1]?.module || !m.slots[0]?.module)) { seat(id, { mount: m.id, slot: m.slots[0]?.module ? 1 : 0 }); return; }
    const r = railAt(w, 60);
    if (r) { seat(id, { rail: r.id, at: r.at }); return; }
    seat(id);
  };

  const fs = (n: number) => n * px;
  const selMounts = sel.filter((s) => s.kind === 'mount').map((s) => s.id);
  const offsetOf = (id: string, railDir: 'h' | 'v'): V2 => {
    if (!ghost || !ghost.ids.includes(id)) return [0, 0];
    if (ghost.ids.length === 1) return ghost.d;
    return railDir === 'h' ? [ghost.d[0], 0] : [0, ghost.d[1]];
  };
  const collide = new Set((rep?.collisions ?? []).flat());
  const shownDrop = dropAt ? (mountAt(dropAt) ? { m: mountAt(dropAt)! } : railAt(dropAt, 60) ? { r: railAt(dropAt, 60)! } : null) : null;

  return (
    <div className="editor" style={{ position: 'absolute', inset: 0 }} onContextMenu={(e) => e.preventDefault()} onDragOver={onDragOver} onDragLeave={() => setDropAt(null)} onDrop={onDrop}>
      <svg ref={svg} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} style={{ cursor: space ? 'grab' : 'default' }}>
        <defs>
          <pattern id="pg10" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="var(--grid)" strokeWidth={fs(0.7)} /></pattern>
          <pattern id="pg50" width="50" height="50" patternUnits="userSpaceOnUse"><rect width="50" height="50" fill="url(#pg10)" /><path d="M50 0H0V50" fill="none" stroke="var(--grid)" strokeWidth={fs(1.4)} /></pattern>
          <linearGradient id="railH" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c7d1db" /><stop offset="0.18" stopColor="#8e9aa6" /><stop offset="0.5" stopColor="#6b7783" /><stop offset="0.82" stopColor="#8e9aa6" /><stop offset="1" stopColor="#c7d1db" /></linearGradient>
          <linearGradient id="railV" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#c7d1db" /><stop offset="0.18" stopColor="#8e9aa6" /><stop offset="0.5" stopColor="#6b7783" /><stop offset="0.82" stopColor="#8e9aa6" /><stop offset="1" stopColor="#c7d1db" /></linearGradient>
          <pattern id="clash" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="var(--bad)" strokeOpacity="0.6" strokeWidth="1.2" /></pattern>
        </defs>
        <rect x={vb.x - vb.w} y={vb.y - vb.h} width={vb.w * 3} height={vb.h * 3} fill="url(#pg50)" />

        {(rep?.rails ?? []).map((r) => {
          const o = ghost?.railMove === r.id ? ghost.d : [0, 0];
          const x = r.x + o[0], y = r.y + o[1];
          const L = r.length, h = r.dir === 'h';
          const on = isSel(sel, r.id), target = ghost?.rail === r.id || (shownDrop && 'r' in shownDrop && shownDrop.r?.id === r.id);
          const slots = [];
          for (let s = 12.5; s < L - 8; s += 25) slots.push(s);
          return (
            <g key={r.id} data-kind="rail" data-id={r.id} style={{ cursor: 'move' }}>
              <rect x={h ? x : x - 17.5} y={h ? -(y + 17.5) : -(y + L)} width={h ? L : 35} height={h ? 35 : L} rx={1.5} fill={`url(#${h ? 'railH' : 'railV'})`} stroke={on || target ? 'var(--accent)' : '#56616c'} strokeWidth={fs(on || target ? 2.2 : 1)} opacity={0.95} />
              {slots.map((s) => <rect key={s} x={h ? x + s - 7.5 : x - 2.6} y={h ? -(y + 2.6) : -(y + s + 7.5)} width={h ? 15 : 5.2} height={h ? 5.2 : 15} rx={2.6} fill="#3a434d" />)}
            </g>
          );
        })}

        {(['body', 'hub', 'label'] as const).map((layer) => (rep?.mounts ?? []).map((m) => {
          const r = rep!.rails.find((x) => x.id === m.rail);
          if (!r) return null;
          const o = offsetOf(m.id, r.dir);
          const on = isSel(sel, m.id);
          const mods = rep!.modules.filter((q) => q.mount === m.id);
          const h = r.dir === 'h';
          const sx = m.x + o[0], sy = m.y + o[1];
          const rot = -(m.turn + (h ? 0 : 90));
          if (layer === 'hub') return (
            <g key={`h${m.id}`} data-kind="mount" data-id={m.id} style={{ cursor: 'grab' }}>
              {m.kind === 'dock' && <rect x={sx - (h ? 10.5 : 25)} y={-(sy + (h ? 25 : 10.5))} width={h ? 21 : 50} height={h ? 50 : 21} rx={2} fill="#f59e42" stroke="#7a4a12" strokeWidth={fs(1)} />}
              {m.kind === 'dock' && <rect x={sx - 9} y={-(sy + 10.4)} width={18} height={20.8} rx={1.5} transform={`rotate(${rot} ${sx} ${-sy})`} fill="#5b8def" stroke="#1d3f8a" strokeWidth={fs(1)} />}
              {m.kind === 'dock' && <path d={`M${sx - 3.5} ${-sy - 3} L${sx} ${-sy - 8} L${sx + 3.5} ${-sy - 3}`} transform={`rotate(${rot} ${sx} ${-sy})`} fill="none" stroke="#fff" strokeWidth={fs(1.8)} strokeLinecap="round" strokeLinejoin="round" />}
              {m.kind === 'flat' && <rect x={sx - (h ? 7 : 25)} y={-(sy + (h ? 25 : 7))} width={h ? 14 : 50} height={h ? 50 : 14} rx={2} fill="#ff6b5b" stroke="#7a2a22" strokeWidth={fs(1)} />}
            </g>
          );
          if (layer === 'body') return (
            <g key={`b${m.id}`} data-kind="mount" data-id={m.id} style={{ cursor: 'grab' }} opacity={ghost?.ids.includes(m.id) ? 0.7 : 1}>
              <rect x={m.foot[0] + o[0] - 2} y={-(m.foot[3] + o[1] + 2)} width={m.foot[2] - m.foot[0] + 4} height={m.foot[3] - m.foot[1] + 4} rx={4} fill="transparent" stroke={on ? 'var(--accent)' : 'transparent'} strokeWidth={fs(2)} strokeDasharray={`${fs(6)} ${fs(4)}`} />
              {mods.map((q) => {
                const c = color.get(q.id) ?? '#888';
                const f = q.foot;
                const bad = collide.has(q.id);
                return (
                  <g key={q.id}>
                    <rect x={f[0] + o[0]} y={-(f[3] + o[1])} width={f[2] - f[0]} height={f[3] - f[1]} rx={2.5} fill={c} fillOpacity={on ? 0.28 : 0.17} stroke={bad ? 'var(--bad)' : c} strokeWidth={fs(1.5)} />
                    {bad && <rect x={f[0] + o[0]} y={-(f[3] + o[1])} width={f[2] - f[0]} height={f[3] - f[1]} fill="url(#clash)" />}
                  </g>
                );
              })}
            </g>
          );
          return (
            <g key={`l${m.id}`} style={{ pointerEvents: 'none' }}>
              {mods.map((q) => {
                const c = color.get(q.id) ?? '#888';
                const f = q.foot;
                const cnt = accessCounts(q.access);
                // label in the part of the footprint away from the rail
                const railC = h ? r.y : r.x;
                const lo = h ? f[1] : f[0], hi = h ? f[3] : f[2];
                const upSide = hi - (railC + 17.5) >= railC - 17.5 - lo;
                const a0 = upSide ? Math.max(lo, railC + 17.5) : lo, a1 = upSide ? hi : Math.min(hi, railC - 17.5);
                const mid = (a0 + a1) / 2;
                const cx = (h ? (f[0] + f[2]) / 2 : mid) + o[0], cy = (h ? mid : (f[1] + f[3]) / 2) + o[1];
                const across = (h ? f[2] - f[0] : f[3] - f[1]) / px, along = Math.abs(a1 - a0) / px;
                const name = nameOf(q.id);
                const fsz = 11.5;
                const vertical = h ? across < Math.max(name.length * fsz * 0.6, 24 * 5.9) + 16 && along > across : false;
                const sub = `${q.edge} edge in · ◉${cnt.front} ✓${cnt.good - cnt.front}${cnt.side ? ` ⚠${cnt.side}` : ''}${cnt.blocked ? ` ✕${cnt.blocked}` : ''}`;
                const tw = Math.max(Math.min(name.length, 26) * fsz * 0.6, sub.length * 9.5 * 0.62) + 16;
                const dirs = ['up', 'down', 'left', 'right'] as const;
                return (
                  <g key={q.id}>
                    {dirs.map((d) => {
                      const list = q.access.filter((a) => a.dir === d);
                      if (!list.length) return null;
                      const col = list.some((a) => a.ok === 'side') ? 'var(--warn)' : 'var(--good)';
                      const ax = d === 'left' ? f[0] + o[0] - fs(11) : d === 'right' ? f[2] + o[0] + fs(11) : (f[0] + f[2]) / 2 + o[0];
                      const ay = d === 'up' ? f[3] + o[1] + fs(11) : d === 'down' ? f[1] + o[1] - fs(11) : (f[1] + f[3]) / 2 + o[1];
                      return <text key={d} x={ax} y={-ay} fontSize={fs(12)} textAnchor="middle" dominantBaseline="central" fill={col} className="mono">{`${ARROW[d]}${list.length > 1 ? list.length : ''}`}</text>;
                    })}
                    <g transform={vertical ? `rotate(-90 ${cx} ${-cy})` : undefined}>
                      <rect x={cx - fs(tw / 2)} y={-cy - fs(17)} width={fs(tw)} height={fs(34)} rx={fs(8)} fill="var(--panel)" fillOpacity={0.92} stroke={c} strokeWidth={fs(1.2)} />
                      <text x={cx} y={-cy - fs(6)} fontSize={fs(fsz)} textAnchor="middle" dominantBaseline="central" fill="var(--fg)" fontWeight={600}>{name.slice(0, 26)}</text>
                      <text x={cx} y={-cy + fs(8)} fontSize={fs(9.5)} textAnchor="middle" dominantBaseline="central" className="mono" fill="var(--muted)">{sub}</text>
                    </g>
                  </g>
                );
              })}
            </g>
          );
        }))}

        {(rep?.rails ?? []).map((r) => {
          const o = ghost?.railMove === r.id ? ghost.d : [0, 0];
          const h = r.dir === 'h';
          const tx = h ? r.x + o[0] - fs(10) : r.x + o[0], ty = h ? r.y + o[1] : r.y + o[1] - fs(10);
          const label = `RAIL ${r.id.replace(/^r/, '')} · ${Math.round(r.length)} mm`;
          return (
            <g key={`rl${r.id}`} style={{ pointerEvents: 'none' }}>
              <rect x={h ? tx - fs(label.length * 6.6 + 12) : tx - fs(label.length * 3.3 + 6)} y={h ? -ty - fs(10) : -ty} width={fs(label.length * 6.6 + 12)} height={fs(20)} rx={fs(6)} fill="#56616c" />
              <text x={h ? tx - fs(label.length * 3.3 + 6) : tx} y={h ? -ty : -ty + fs(10)} fontSize={fs(10.5)} textAnchor="middle" dominantBaseline="central" className="mono" fill="#e8eef4">{label}</text>
            </g>
          );
        })}
        {ghost?.rail && <text x={cursor?.[0] ?? 0} y={-(cursor?.[1] ?? 0) - fs(14)} fontSize={fs(11)} textAnchor="middle" className="mono" fill="var(--accent)">move to rail {ghost.rail.replace(/^r/, '')}</text>}
        {dropAt && <circle cx={dropAt[0]} cy={-dropAt[1]} r={fs(6)} fill="var(--accent)" />}
        {dropAt && shownDrop && <text x={dropAt[0]} y={-dropAt[1] - fs(14)} fontSize={fs(11)} textAnchor="middle" className="mono" fill="var(--accent)">{'m' in shownDrop ? 'into this dock (back to back)' : 'new dock here'}</text>}
        {marquee && <rect x={Math.min(marquee.a[0], marquee.b[0])} y={-Math.max(marquee.a[1], marquee.b[1])} width={Math.abs(marquee.b[0] - marquee.a[0])} height={Math.abs(marquee.b[1] - marquee.a[1])} fill="var(--accent)" fillOpacity={0.08} stroke="var(--accent)" strokeWidth={fs(1)} strokeDasharray={`${fs(4)} ${fs(3)}`} />}
      </svg>

      <div className="toolbar floating">
        <button className={`tbtn wide ${project.panel.auto ? 'on' : ''}`} onClick={autoArrange} title="Lay everything out automatically: orientations for plug access, back-to-back pairs, packing, new rows">⚡ Auto-arrange</button>
        <span className="tsep" />
        <button className="tbtn wide" onClick={() => addRail('h')} title="Add a horizontal rail">+ Rail ⟷</button>
        <button className="tbtn wide" onClick={() => addRail('v')} title="Add a vertical rail">+ Rail ↕</button>
        <button className="tbtn wide" onClick={() => addDock(sel.find((s) => s.kind === 'rail')?.id)} title="Add an empty dock at the end of the selected (or last) rail">+ Dock</button>
        <span className="tsep" />
        <button className="tbtn" onClick={() => setVb(fit(rep))} title="Fit to view">⤢</button>
      </div>

      {selMounts.length > 0 && (
        <div className="selbar floating">
          <b className="mono">{selMounts.length} dock{selMounts.length > 1 ? 's' : ''}</b>
          <button className="btn small ghost" onClick={() => turnMounts(selMounts, -90)} title="Shift+R">⟲ Turn</button>
          <button className="btn small ghost" onClick={() => turnMounts(selMounts, 90)} title="R">Turn ⟳</button>
          <button className="btn small ghost" onClick={() => swapSlots(selMounts)} title="F">Swap front / back</button>
          <span className="tsep" />
          <button className="btn small danger" onClick={() => removeMounts(selMounts)} title="Delete (boards go back to the list)">Remove</button>
          <button className="btn small ghost icon" onClick={() => select([])} title="Esc">✕</button>
        </div>
      )}

      <div className="hud floating mono">
        <span>{building && !rep ? 'building the panel…' : rep ? `${rep.rails.length} rail${rep.rails.length === 1 ? '' : 's'} · ${rep.mounts.length} mount${rep.mounts.length === 1 ? '' : 's'} · ${Math.round(rep.depth)} mm deep${project.panel.auto ? ' · auto' : ' · manual'}` : project.layout === 'panel' ? '' : 'Loose holders: switch the Panel step to DIN rails'}</span>
        <span>drag docks along or between rails · R turn · F swap · drag boards from the list onto a rail</span>
        {cursor && <span className="xy">{cursor[0].toFixed(0)}, {cursor[1].toFixed(0)}</span>}
      </div>
      {!rep && !building && <div className="empty-note">{project.layout === 'panel' ? 'Nothing on the panel yet.' : 'This project uses loose holders. Choose “DIN rail panel” in the Panel step.'}</div>}
    </div>
  );
}
