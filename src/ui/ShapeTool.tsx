// The Shape tool (S) in the board editor: the board's outline and its cut-outs as corners and edges you can take hold
// of. Three ways to work, in a bar under the drawing:
// - Edit: drag a corner, or an edge (it slides square to itself); hover an edge for its length; click the + in the
//   middle of an edge for a new corner there; select a corner to type where it goes, round it or cut it, or Delete it;
//   select an edge to type its length or bend it into an arc. With nothing selected, round or cut every corner.
// - Line: click corners one after another (Shift: 15-degree steps) and click the first one to close; type a length
//   and angle for an exact edge (like CAD); Arc makes the next edge a three-point arc (its end, then a point on it).
//   The closed shape is added to the board, cut out of it (a notch at the edge or a cut-out inside) or becomes a new
//   outline.
// - Shapes: a rectangle, circle or slot, clicked in at the size typed or dragged out, added or cut out.
// Everything snaps (the grid, other corners' x and y, 15 degrees from the neighbours, the other edges) with the same
// guide lines parts get; Alt for none. An edit that would make an edge cross another is refused with a message, and
// holes and parts the shape leaves off the board are marked in red. Every edit is one undo step.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Board, Loop, Project, V2 } from '../model/types';
import { activeModule, commitFrom, editMod, select, store, toast } from '../state';
import { snapLines } from '../model/editorgeo';
import { followCorners } from '../model/dims';
import { area, bbox, ccw, rad, rectLoop } from '../geom/poly';
import { say } from './touch';
import {
  addCorner, arcThrough, bendEdge, circlePts, combine, cornerCut, cornersOf, edgeLength, isCorner, lenAng, loopProblem, moveCorner,
  nearestLine, offBoard, polar, removeCorner, setEdgeLength, shapeProblem, slotLoop, snapPoint, type SnapIn, type SnapOut,
} from '../geom/shape';

export type ShapeMode = 'edit' | 'line' | 'shapes';
type LineOp = 'add' | 'cut' | 'new';
type Prim = 'rect' | 'circle' | 'slot';
type Pick = { loop: number; kind: 'v' | 'e'; i: number };
type Drag =
  | { kind: 'v'; loop: number; i: number; pre: Project; orig: Loop; ctx: SnapIn; moved: boolean; client: V2; inserted: boolean }
  | { kind: 'e'; loop: number; i: number; pre: Project; orig: Loop; ctx: SnapIn; moved: boolean; client: V2; start: V2; n: V2 }
  | { kind: 'prim'; a: V2; client: V2 };

// Start in the Shape tool from elsewhere (Draw your own's custom outline): picked up when the editor opens, or at once.
let pending: { mode: ShapeMode; op?: LineOp } | null = null;
export function openShapeTool(mode: ShapeMode, op?: LineOp) {
  pending = { mode, op };
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('boarddock:shape'));
}

const loopsOf = (b: Board): Loop[] => [b.outline, ...b.cutouts];
const withLoop = (b: Board, k: number, l: Loop) => (k === 0 ? { outline: l, cutouts: b.cutouts } : { outline: b.outline, cutouts: b.cutouts.map((c, j) => (j === k - 1 ? l : c)) });
const gridFor = (px: number) => (px > 0.15 ? 1 : px > 0.05 ? 0.5 : 0.1);
const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const fmt = (v: number) => String(Math.round(v * 100) / 100);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const offWords = (o: { holes: string[]; comps: string[] }) => [o.holes.length && plural(o.holes.length, 'hole', 'holes'), o.comps.length && plural(o.comps.length, 'part', 'parts')].filter(Boolean).join(' and ');

export interface ShapeHost { b: Board; px: number; active: boolean; setTool: (t: 'shape' | 'select') => void }

export function useShapeTool({ b, px, active, setTool }: ShapeHost) {
  const [mode, setModeRaw] = useState<ShapeMode>('edit');
  const [pick, setPick] = useState<Pick | null>(null);
  const [hovE, setHovE] = useState<{ loop: number; i: number } | null>(null);
  const [snapped, setSnapped] = useState<SnapOut | null>(null); // where the pointer lands (line and shapes), or the drag's guides
  const [bad, setBad] = useState<{ loop: Loop; msg: string } | null>(null); // a drag that would cross itself: shown, not made
  const [cs, setCs] = useState(2); // corner size: fillet radius or chamfer length
  const [bh, setBh] = useState(3); // arc height for bending an edge
  const [lineOp, setLineOp] = useState<LineOp>('add');
  const [arcOn, setArcOn] = useState(false);
  const [arcEnd, setArcEnd] = useState<V2 | null>(null);
  const [draft, setDraft] = useState<{ pts: V2[]; segs: number[] } | null>(null);
  const [typed, setTyped] = useState({ L: '', A: '' });
  const [prim, setPrim] = useState<Prim>('rect');
  const [primOp, setPrimOp] = useState<'add' | 'cut'>('cut');
  const [pw, setPw] = useState(10), [ph, setPh] = useState(6), [pd, setPd] = useState(6), [sl, setSl] = useState(12), [sw, setSw] = useState(4), [sa, setSa] = useState(0);
  const [pdrag, setPdrag] = useState<{ a: V2; b: V2 } | null>(null);
  const drag = useRef<Drag | null>(null);
  const lenRef = useRef<HTMLInputElement>(null);
  const tol = 7 * px, fs = (n: number) => n * px;
  const loops = loopsOf(b);
  const bb = useMemo(() => bbox(b.outline), [b.outline]);
  const isBox = b.kind === 'box';

  const reset = () => { setPick(null); setHovE(null); setDraft(null); setArcEnd(null); setSnapped(null); setBad(null); setPdrag(null); setTyped({ L: '', A: '' }); drag.current = null; };
  const setMode = (m: ShapeMode) => { reset(); setModeRaw(m); };
  useEffect(() => { if (active) select([]); else reset(); }, [active]);
  // opened from Draw your own
  useEffect(() => {
    const take = () => { if (!pending) return; const p = pending; pending = null; reset(); setModeRaw(p.mode); if (p.op) setLineOp(p.op); setTool('shape'); };
    take();
    window.addEventListener('boarddock:shape', take);
    return () => window.removeEventListener('boarddock:shape', take);
  }, []);

  // what the shape leaves off the board, marked in red whatever the tool
  const off = useMemo(() => (isBox ? { holes: [], comps: [] } : offBoard(b)), [b.outline, b.cutouts, b.holes, b.comps, isBox]);
  const pk = pick && loops[pick.loop] && pick.i < loops[pick.loop].length ? pick : null;

  /** Make an outline and cut-outs the board's, as one undo step, or say why not. */
  const commit = (outline: Loop, cutouts: Loop[], done?: string): boolean => {
    const p = shapeProblem(outline, cutouts);
    if (p) { toast(p); return false; }
    const before = off.holes.length + off.comps.length;
    editMod((m) => { const prev = m.board.outline; m.board.outline = outline; m.board.cutouts = cutouts; followCorners(m.board, prev); });
    report(before, done);
    return true;
  };
  const report = (before: number, done?: string) => {
    const nb = activeModule(store.get().project!).board, o = offBoard(nb), n = o.holes.length + o.comps.length;
    if (n > before) toast(`${done ? done + ' ' : ''}${offWords(o)} ${n === 1 ? 'is' : 'are'} now off the board or on its edge (marked red): move ${n === 1 ? 'it' : 'them'}, or change the shape.`);
    else if (done) toast(done);
  };
  /** A drag shown as it goes (not an undo step until it ends). */
  const live = (pre: Project, outline: Loop, cutouts: Loop[]) => {
    const p = structuredClone(pre), m = activeModule(p).board, prev = m.outline;
    m.outline = outline; m.cutouts = cutouts;
    followCorners(m, prev);
    store.set({ project: p });
  };

  /** What a point snaps to on this board: every corner but the ones moving, the lines parts snap to, the edges. */
  const ctxFor = (bd: Board, skip: { loop: number; idx: number[] } | null, anchors: V2[], extra: V2[] = []): SnapIn => {
    const L = snapLines(bd, new Set());
    const xs = [...L.xs], ys = [...L.ys], pts: V2[] = [], edges: [V2, V2][] = [];
    loopsOf(bd).forEach((l, k) => l.forEach((q, i) => {
      const j = (i + 1) % l.length, mine = skip?.loop === k;
      if (!(mine && skip!.idx.includes(i)) && isCorner(l, i)) { pts.push(q); xs.push(q[0]); ys.push(q[1]); }
      if (!(mine && (skip!.idx.includes(i) || skip!.idx.includes(j)))) edges.push([q, l[j]]);
    }));
    for (const q of extra) { pts.push(q); xs.push(q[0]); ys.push(q[1]); }
    return { xs, ys, pts, anchors, edges, grid: gridFor(px), tol };
  };
  const free = (p: V2): SnapOut => ({ p, gx: null, gy: null, rays: [], on: null });

  // ---------------------------------------------------------------- the line tool
  const drawCtx = (e: { shiftKey: boolean }) => {
    const pts = draft?.pts ?? [];
    const last = pts[pts.length - 1];
    const c = ctxFor(b, null, last ? [last] : [], pts);
    if (e.shiftKey && last && !arcEnd) c.force15 = last;
    return c;
  };
  const closeWith = (loop: Loop) => {
    const pr = loopProblem(loop);
    if (pr) { toast(`That shape will not do: ${pr}. Backspace takes the last corner off.`); return false; }
    let ok: boolean;
    if (lineOp === 'new') {
      const outline = ccw(loop), keep = b.cutouts.filter((c) => !shapeProblem(outline, [c]));
      ok = commit(outline, keep, `A new outline${keep.length < b.cutouts.length ? `; ${plural(b.cutouts.length - keep.length, 'cut-out', 'cut-outs')} outside it went` : ''}.`);
    } else {
      const r = combine(b.outline, b.cutouts, loop, lineOp);
      ok = 'error' in r ? (toast(r.error), false) : commit(r.outline, r.cutouts, lineOp === 'add' ? 'Added to the board.' : r.cutouts.length > b.cutouts.length ? 'Cut out of the board.' : 'Cut out of its edge.');
    }
    if (ok) { setDraft(null); setArcEnd(null); setTyped({ L: '', A: '' }); }
    return ok;
  };
  const addPoint = (p: V2) => {
    if (!draft) { setDraft({ pts: [p], segs: [1] }); return; }
    const first = draft.pts[0], last = draft.pts[draft.pts.length - 1];
    if (dist(p, last) < 1e-6) return;
    const closes = (q: V2) => draft.pts.length >= 2 && dist(q, first) <= Math.max(tol, 1e-6);
    let seg: V2[], shut: boolean;
    if (arcOn) {
      if (!arcEnd) { setArcEnd(closes(p) ? first : p); return; }
      shut = dist(arcEnd, first) < 1e-6;
      seg = arcThrough(last, p, arcEnd);
      setArcEnd(null);
    } else { shut = closes(p); seg = [shut ? first : p]; }
    const all = [...draft.pts, ...seg];
    if (shut) { if (!closeWith(all.slice(0, -1))) setDraft({ pts: draft.pts, segs: draft.segs }); return; }
    setDraft({ pts: all, segs: [...draft.segs, seg.length] });
  };
  const undoPoint = () => {
    if (arcEnd) { setArcEnd(null); return; }
    if (!draft) return;
    if (draft.segs.length <= 1) { setDraft(null); return; }
    const n = draft.segs[draft.segs.length - 1];
    setDraft({ pts: draft.pts.slice(0, -n), segs: draft.segs.slice(0, -1) });
  };
  /** The point the typed length and angle give (what is not typed comes from the pointer). */
  const typedPoint = (): V2 | null => {
    const last = draft?.pts[draft.pts.length - 1];
    if (!last) return null;
    const L = parseFloat(typed.L.replace(',', '.')), A = parseFloat(typed.A.replace(',', '.'));
    if (!Number.isFinite(L) && !Number.isFinite(A)) return null;
    const la = snapped ? lenAng(last, snapped.p) : { L: 10, deg: 0 };
    return polar(last, Number.isFinite(L) ? L : la.L, Number.isFinite(A) ? A : la.deg);
  };
  const closeNow = () => {
    if (!draft || draft.pts.length < 3) { toast('Three corners at least, then close it.'); return; }
    closeWith(draft.pts);
  };

  // ---------------------------------------------------------------- shapes
  const primLoop = (a: V2, c: V2 | null): Loop | null => {
    if (prim === 'rect') {
      if (c) { if (Math.abs(c[0] - a[0]) < 0.2 || Math.abs(c[1] - a[1]) < 0.2) return null; return rectLoop(Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[0], c[0]), Math.max(a[1], c[1])); }
      return rectLoop(a[0] - pw / 2, a[1] - ph / 2, a[0] + pw / 2, a[1] + ph / 2);
    }
    if (prim === 'circle') { const r = c ? dist(a, c) : pd / 2; return r > 0.1 ? circlePts(a, r) : null; }
    if (c) return slotLoop(a, c, sw);
    const half = Math.max(0, (sl - sw) / 2), d: V2 = [Math.cos(rad(sa)) * half, Math.sin(rad(sa)) * half];
    return slotLoop([a[0] - d[0], a[1] - d[1]], [a[0] + d[0], a[1] + d[1]], sw);
  };
  const putPrim = (l: Loop | null) => {
    if (!l) return;
    const r = combine(b.outline, b.cutouts, l, primOp);
    if ('error' in r) { toast(r.error); return; }
    commit(r.outline, r.cutouts, primOp === 'add' ? 'Added to the board.' : r.cutouts.length > b.cutouts.length ? 'Cut out of the board.' : 'Cut out of its edge.');
  };

  // ---------------------------------------------------------------- edits on the selection
  const onLoop = (k: number, l: Loop, done?: string) => { const w = withLoop(b, k, l); return commit(w.outline, w.cutouts, done); };
  const delCorner = (p: Pick) => {
    const l = removeCorner(loops[p.loop], p.i);
    if (l) { if (onLoop(p.loop, l)) setPick(null); return; }
    if (p.loop === 0) { toast('An outline needs at least three corners.'); return; }
    removeCutout(p.loop);
  };
  const removeCutout = (k: number) => { if (commit(b.outline, b.cutouts.filter((_, j) => j !== k - 1), 'Cut-out removed.')) setPick(null); };
  const cutCorners = (kind: 'round' | 'cut', p: Pick | null) => {
    const k = p?.loop ?? 0, l = loops[k], idx = p ? [p.i] : cornersOf(l);
    if (!idx.length) { toast('No sharp corners to change.'); return; }
    const r = cornerCut(l, idx, kind, cs);
    if (r.loop.length === l.length && r.loop.every((q, i) => q === l[i])) { toast(kind === 'round' ? 'That corner is straight: nothing to round.' : 'That corner is straight: nothing to cut.'); return; }
    if (onLoop(k, r.loop, r.clamped ? 'Its edges are too short for that size: made as big as they allow.' : undefined)) setPick(null);
  };

  // ---------------------------------------------------------------- pointer
  /** Pointer down on the drawing; false when it is not for the Shape tool (the editor pans). */
  const onDown = (e: React.PointerEvent, w: V2): boolean => {
    if (isBox) return false;
    const t = (e.target as Element).closest?.('[data-shape]') as SVGElement | null;
    const pre = store.get().project!;
    if (mode === 'line') {
      const tp = typedPoint();
      addPoint(tp ?? (e.altKey ? free(w) : snapPoint(w, drawCtx(e))).p);
      if (tp) setTyped({ L: '', A: '' });
      return true;
    }
    if (mode === 'shapes') {
      const s = e.altKey ? free(w) : snapPoint(w, ctxFor(b, null, []));
      drag.current = { kind: 'prim', a: s.p, client: [e.clientX, e.clientY] };
      return true;
    }
    if (!t) { setPick(null); return false; }
    const k = +t.dataset.loop!, i = +t.dataset.i!, l = loops[k];
    if (!l) return false;
    const n = l.length;
    if (t.dataset.shape === 'v' || t.dataset.shape === 'm') {
      // a corner, or the + in the middle of an edge (a new corner there, dragged from where it is made)
      const ins = t.dataset.shape === 'm';
      const orig = ins ? addCorner(l, i, [(l[i][0] + l[(i + 1) % n][0]) / 2, (l[i][1] + l[(i + 1) % n][1]) / 2]) : l;
      const vi = ins ? i + 1 : i, m = orig.length;
      const ctx = ctxFor(b, { loop: k, idx: [] }, [orig[(vi - 1 + m) % m], orig[(vi + 1) % m]]);
      ctx.pts = ctx.pts.filter((q) => dist(q, orig[vi]) > 1e-9);
      ctx.edges = ctx.edges.filter(([a, c]) => dist(a, orig[vi]) > 1e-9 && dist(c, orig[vi]) > 1e-9);
      drag.current = { kind: 'v', loop: k, i: vi, pre, orig, ctx, moved: false, client: [e.clientX, e.clientY], inserted: ins };
      if (ins) { const wl = withLoop(b, k, orig); live(pre, wl.outline, wl.cutouts); }
      setPick({ loop: k, kind: 'v', i: vi });
      return true;
    }
    if (t.dataset.shape === 'e') {
      const a = l[i], c = l[(i + 1) % n], L = dist(a, c) || 1;
      drag.current = { kind: 'e', loop: k, i, pre, orig: l, ctx: ctxFor(b, { loop: k, idx: [i, (i + 1) % n] }, []), moved: false, client: [e.clientX, e.clientY], start: w, n: [(c[1] - a[1]) / L, -(c[0] - a[0]) / L] };
      setPick({ loop: k, kind: 'e', i });
      return true;
    }
    return false;
  };

  const onMove = (e: React.PointerEvent, w: V2) => {
    if (!active || isBox) return;
    const d = drag.current;
    const far = (c: V2) => Math.hypot(e.clientX - c[0], e.clientY - c[1]) >= 3;
    if (!d) {
      if (mode === 'edit') {
        const t = (e.target as Element).closest?.('[data-shape="e"]') as SVGElement | null;
        setHovE(t ? { loop: +t.dataset.loop!, i: +t.dataset.i! } : null);
      } else setSnapped(mode === 'line' ? (e.altKey ? free(w) : snapPoint(w, drawCtx(e))) : e.altKey ? free(w) : snapPoint(w, ctxFor(b, null, [])));
      return;
    }
    if (d.kind === 'prim') {
      const s = e.altKey ? free(w) : snapPoint(w, ctxFor(b, null, prim === 'circle' || prim === 'slot' ? [d.a] : []));
      setSnapped(s);
      if (far(d.client)) setPdrag({ a: d.a, b: s.p });
      return;
    }
    if (!d.moved && !far(d.client)) return;
    d.moved = true;
    const pb = activeModule(d.pre).board;
    let next: Loop;
    if (d.kind === 'v') {
      const s = e.altKey ? free(w) : snapPoint(w, d.ctx);
      setSnapped(s);
      next = moveCorner(d.orig, d.i, s.p);
    } else {
      // an edge slides square to itself; one along x or y lines up with the lines, any other moves in grid steps
      const m = d.orig.length, a = d.orig[d.i], g = gridFor(px);
      let o = (w[0] - d.start[0]) * d.n[0] + (w[1] - d.start[1]) * d.n[1], gx: number | null = null, gy: number | null = null;
      if (!e.altKey) {
        const ax: 0 | 1 | null = Math.abs(d.n[0]) > 0.999 ? 0 : Math.abs(d.n[1]) > 0.999 ? 1 : null;
        if (ax != null) {
          const v = a[ax] + o * d.n[ax], s = nearestLine(v, ax ? d.ctx.ys : d.ctx.xs, tol), to = s ?? Math.round(v / g) * g;
          o = (to - a[ax]) / d.n[ax];
          if (s != null) { if (ax) gy = s; else gx = s; }
        } else o = Math.round(o / g) * g;
      }
      setSnapped({ p: w, gx, gy, rays: [], on: null });
      next = d.orig.map((q, k) => (k === d.i || k === (d.i + 1) % m ? [Math.round((q[0] + d.n[0] * o) * 1e6) / 1e6, Math.round((q[1] + d.n[1] * o) * 1e6) / 1e6] as V2 : q));
    }
    const wl = withLoop(pb, d.loop, next), pr = shapeProblem(wl.outline, wl.cutouts);
    if (pr) { setBad({ loop: next, msg: pr }); return; }
    setBad(null);
    live(d.pre, wl.outline, wl.cutouts);
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'prim') {
      const moved = pdrag != null;
      putPrim(primLoop(d.a, moved ? pdrag.b : null));
      setPdrag(null);
      return;
    }
    setSnapped(null);
    if (bad) {
      // the last place it was dragged to crosses: back to where it started
      store.set({ project: d.pre });
      toast(`${bad.msg} Put back where it was.`);
      setBad(null);
      return;
    }
    if (d.moved || (d.kind === 'v' && d.inserted)) {
      const before = offBoard(activeModule(d.pre).board);
      commitFrom(d.pre);
      report(before.holes.length + before.comps.length);
    }
  };

  // ---------------------------------------------------------------- keys (before the editor's own: Esc, Delete, Enter)
  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey) return;
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      const key = e.key.toLowerCase();
      if (e.key === 'Escape') { if (draft || arcEnd || drag.current || pick) { reset(); stop(); } return; } // else the editor goes back to Select
      if (key === 'e' && mode !== 'edit') { stop(); setMode('edit'); return; }
      if (key === 'l' && mode !== 'line') { stop(); setMode('line'); return; }
      if (mode === 'line') {
        if (key === 'a') { stop(); setArcOn((x) => !x); setArcEnd(null); return; }
        if (!draft) return;
        if (e.key === 'Enter') { stop(); closeNow(); return; }
        if (e.key === 'Backspace' || e.key === 'Delete') { stop(); undoPoint(); return; }
        // a number typed on the drawing goes into Length (focused here, the browser puts the key into it)
        if (/^[0-9.,-]$/.test(e.key) && lenRef.current) { e.stopImmediatePropagation(); lenRef.current.focus(); lenRef.current.select(); }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && pk?.kind === 'v') { stop(); delCorner(pk); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });

  // ---------------------------------------------------------------- drawing
  const P = (q: V2) => `${q[0]},${-q[1]}`;
  const path = (l: V2[], close = true) => 'M' + l.map(P).join('L') + (close ? 'Z' : '');
  const chip = (at: V2, text: string, tone: 'accent' | 'coral' = 'accent', key?: string) => {
    const w = text.length * 6.6 + 14;
    return (
      <g key={key} transform={`translate(${at[0]},${-at[1]})`} style={{ pointerEvents: 'none' }}>
        <rect x={-fs(w / 2)} y={-fs(9)} width={fs(w)} height={fs(18)} rx={fs(9)} fill={`var(--${tone})`} />
        <text fontSize={fs(10.5)} textAnchor="middle" dominantBaseline="central" className="mono" fill="#fff">{text}</text>
      </g>
    );
  };
  const guides = (s: SnapOut | null) => s && (
    <g style={{ pointerEvents: 'none' }}>
      {s.gx != null && <line x1={s.gx} y1={-(bb.y1 + 8)} x2={s.gx} y2={-(bb.y0 - 8)} stroke="var(--accent)" strokeWidth={fs(1)} strokeDasharray={`${fs(5)} ${fs(4)}`} />}
      {s.gy != null && <line x1={bb.x0 - 8} y1={-s.gy} x2={bb.x1 + 8} y2={-s.gy} stroke="var(--accent)" strokeWidth={fs(1)} strokeDasharray={`${fs(5)} ${fs(4)}`} />}
      {s.rays.map((r, i) => {
        const L = Math.max(dist(r.from, s.p) + fs(40), fs(60)), e2 = polar(r.from, L, r.deg);
        return <g key={i}><line x1={r.from[0]} y1={-r.from[1]} x2={e2[0]} y2={-e2[1]} stroke="var(--accent)" strokeWidth={fs(1)} strokeDasharray={`${fs(2)} ${fs(4)}`} />{chip(polar(r.from, fs(34), r.deg), `${r.deg}°`, 'accent')}</g>;
      })}
      {s.on === 'corner' && <circle cx={s.p[0]} cy={-s.p[1]} r={fs(8)} fill="none" stroke="var(--accent)" strokeWidth={fs(1.5)} />}
      {s.on === 'edge' && <path d={`M${s.p[0] - fs(6)},${-s.p[1]}L${s.p[0]},${-s.p[1] - fs(6)}L${s.p[0] + fs(6)},${-s.p[1]}L${s.p[0]},${-s.p[1] + fs(6)}Z`} fill="none" stroke="var(--accent)" strokeWidth={fs(1.5)} />}
    </g>
  );

  const layer = (
    <g>
      {/* holes and parts the shape leaves off the board */}
      <g style={{ pointerEvents: 'none' }}>
        {b.holes.filter((h) => off.holes.includes(h.id)).map((h) => <circle key={h.id} cx={h.x} cy={-h.y} r={h.d / 2 + 2} fill="var(--coral)" fillOpacity={0.15} stroke="var(--coral)" strokeWidth={fs(2)} strokeDasharray={`${fs(4)} ${fs(3)}`} />)}
        {b.comps.filter((c) => off.comps.includes(c.id)).map((c) => { const r = Math.max(c.w, c.l) / 2 + 1.5; return <rect key={c.id} x={c.x - r} y={-c.y - r} width={2 * r} height={2 * r} rx={fs(4)} fill="var(--coral)" fillOpacity={0.12} stroke="var(--coral)" strokeWidth={fs(2)} strokeDasharray={`${fs(4)} ${fs(3)}`} />; })}
      </g>
      {active && !isBox && <>
        {loops.map((l, k) => {
          const n = l.length, scr = (i: number) => edgeLength(l, i) / Math.max(px, 1e-6);
          return (
            <g key={k}>
              {/* the edges: hover for the length, drag to slide one, click to select it */}
              {mode === 'edit' && l.map((a, i) => { const c = l[(i + 1) % n]; return <line key={'e' + i} data-shape="e" data-loop={k} data-i={i} x1={a[0]} y1={-a[1]} x2={c[0]} y2={-c[1]} stroke="transparent" strokeWidth={fs(12)} style={{ cursor: 'grab' }} />; })}
              {l.map((a, i) => {
                const on = pk?.loop === k && pk.kind === 'e' && pk.i === i, hv = hovE?.loop === k && hovE.i === i;
                if (!on && !hv) return null;
                const c = l[(i + 1) % n], m: V2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2], L = dist(a, c) || 1;
                // the label goes off the board: outside the outline, inside a cut-out
                const nOut: V2 = [(c[1] - a[1]) / L, -(c[0] - a[0]) / L], s = (area(l) > 0) === (k === 0) ? 1 : -1;
                return <g key={'h' + i} style={{ pointerEvents: 'none' }}>
                  <line x1={a[0]} y1={-a[1]} x2={c[0]} y2={-c[1]} stroke="var(--accent)" strokeWidth={fs(on ? 3 : 2)} strokeLinecap="round" />
                  {chip([m[0] + nOut[0] * s * fs(16), m[1] + nOut[1] * s * fs(16)], `${L.toFixed(2)} mm`)}
                </g>;
              })}
              {/* the + in the middle of each edge long enough to have room for it: a new corner there */}
              {mode === 'edit' && l.map((a, i) => {
                if (scr(i) < 44) return null;
                const c = l[(i + 1) % n], m: V2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
                return <g key={'m' + i} data-shape="m" data-loop={k} data-i={i} style={{ cursor: 'copy' }}>
                  <circle cx={m[0]} cy={-m[1]} r={fs(9)} fill="transparent" />
                  <circle cx={m[0]} cy={-m[1]} r={fs(5)} fill="var(--surface)" stroke="var(--accent)" strokeOpacity={0.8} strokeWidth={fs(1.2)} />
                  <path d={`M${m[0] - fs(2.6)},${-m[1]}H${m[0] + fs(2.6)}M${m[0]},${-m[1] - fs(2.6)}V${-m[1] + fs(2.6)}`} stroke="var(--accent)" strokeWidth={fs(1.2)} />
                </g>;
              })}
              {/* the corners: squares on real corners, dots on the points of an arc where there is room */}
              {mode === 'edit' && l.map((q, i) => {
                const corner = isCorner(l, i), room = scr(i) >= 16 && scr((i - 1 + n) % n) >= 16;
                const on = pk?.loop === k && pk.kind === 'v' && pk.i === i;
                if (!corner && !room && !on) return null;
                const r = corner ? fs(4.5) : fs(3);
                return <g key={'v' + i} data-shape="v" data-loop={k} data-i={i} style={{ cursor: 'move' }}>
                  <circle cx={q[0]} cy={-q[1]} r={fs(9)} fill="transparent" />
                  {corner ? <rect x={q[0] - r} y={-q[1] - r} width={2 * r} height={2 * r} rx={fs(1)} fill={on ? 'var(--accent)' : 'var(--surface)'} stroke="var(--accent)" strokeWidth={fs(1.5)} />
                    : <circle cx={q[0]} cy={-q[1]} r={r} fill={on ? 'var(--accent)' : 'var(--surface)'} stroke="var(--accent)" strokeWidth={fs(1.2)} />}
                </g>;
              })}
            </g>
          );
        })}
        {bad && <g style={{ pointerEvents: 'none' }}>
          <path d={path(bad.loop)} fill="var(--coral)" fillOpacity={0.12} stroke="var(--coral)" strokeWidth={fs(2)} strokeDasharray={`${fs(5)} ${fs(3)}`} />
          {snapped && chip([snapped.p[0], snapped.p[1] + fs(22)], 'edges cross', 'coral')}
        </g>}
        {drag.current && drag.current.kind !== 'prim' && guides(snapped)}
        {/* the line being drawn */}
        {mode === 'line' && (() => {
          const tp = typedPoint(), cur = tp ?? snapped?.p ?? null, pts = draft?.pts ?? [], last = pts[pts.length - 1];
          const closing = !!(cur && pts.length >= 2 && dist(cur, pts[0]) <= tol);
          const tone = lineOp === 'cut' ? 'var(--coral)' : 'var(--accent)';
          const rubber: V2[] = !cur || !last ? [] : arcOn && arcEnd ? arcThrough(last, cur, arcEnd) : [cur];
          return <g style={{ pointerEvents: 'none' }}>
            {!tp && guides(snapped)}
            {pts.length > 1 && <path d={path(pts, false)} fill="none" stroke={tone} strokeWidth={fs(2)} strokeLinejoin="round" />}
            {last && rubber.length > 0 && <path d={path([last, ...rubber], false)} fill="none" stroke={tone} strokeWidth={fs(1.5)} strokeDasharray={`${fs(5)} ${fs(3)}`} />}
            {arcEnd && <circle cx={arcEnd[0]} cy={-arcEnd[1]} r={fs(4)} fill={tone} />}
            {/* a dot on each corner clicked (not on the points of an arc) */}
            {draft && draft.segs.reduce<number[]>((acc, n) => [...acc, (acc[acc.length - 1] ?? -1) + n], []).slice(1).map((i) => <circle key={i} cx={pts[i][0]} cy={-pts[i][1]} r={fs(2.5)} fill={tone} />)}
            {pts[0] && <circle cx={pts[0][0]} cy={-pts[0][1]} r={fs(closing ? 9 : 6)} fill={closing ? tone : 'var(--surface)'} fillOpacity={closing ? 0.3 : 1} stroke={tone} strokeWidth={fs(2)} />}
            {cur && <circle cx={cur[0]} cy={-cur[1]} r={fs(3)} fill={tone} />}
            {cur && last && (() => { const q = arcOn && arcEnd ? arcEnd : cur, la = lenAng(last, q); return chip([cur[0] + fs(10) + fs(40), cur[1] - fs(22)], closing ? 'close' : `${la.L.toFixed(2)} mm  ${la.deg.toFixed(1)}°`, lineOp === 'cut' ? 'coral' : 'accent'); })()}
          </g>;
        })()}
        {/* the shape about to go in */}
        {mode === 'shapes' && (() => {
          const l = pdrag ? primLoop(pdrag.a, pdrag.b) : snapped ? primLoop(snapped.p, null) : null;
          const tone = primOp === 'cut' ? 'var(--coral)' : 'var(--accent)';
          return <g style={{ pointerEvents: 'none' }}>
            {guides(snapped)}
            {l && <path d={path(l)} fill={tone} fillOpacity={0.14} stroke={tone} strokeWidth={fs(1.6)} strokeDasharray={`${fs(5)} ${fs(3)}`} />}
            {pdrag && l && (() => { const q = bbox(l); return chip([(q.x0 + q.x1) / 2, q.y1 + fs(16)], prim === 'circle' ? `Ø ${(2 * dist(pdrag.a, pdrag.b)).toFixed(2)}` : `${(q.x1 - q.x0).toFixed(2)} × ${(q.y1 - q.y0).toFixed(2)}`, primOp === 'cut' ? 'coral' : 'accent'); })()}
          </g>;
        })()}
      </>}
    </g>
  );

  // ---------------------------------------------------------------- the bar
  const nOff = off.holes.length + off.comps.length;
  const lastPt = draft?.pts[draft.pts.length - 1];
  const liveLA = lastPt && snapped ? lenAng(lastPt, snapped.p) : null;
  const panel = active && !isBox ? (
    <div className="shapebar floating" onPointerDown={(e) => e.stopPropagation()}>
      <div className="sb-row">
        <div className="seg sb-modes" role="tablist" aria-label="How to change the shape">
          {([['edit', 'Edit', 'Drag corners and edges, round or cut corners (E)'], ['line', 'Line', 'Draw a shape corner by corner, with exact lengths if you like (L)'], ['shapes', 'Shapes', 'A rectangle, circle or slot, added or cut out']] as const).map(([k, n, t]) => (
            <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} title={t} onClick={() => setMode(k)}>{n}</button>
          ))}
        </div>
        {mode === 'edit' && !pk && <>
          <span className="sb-lbl">All corners</span>
          <MiniNum label="Size" value={cs} onSet={(v) => setCs(Math.max(0.1, v))} title="The radius to round them to, or how far along each edge to cut them" />
          <button className="btn small ghost" onClick={() => cutCorners('round', null)} title="Round every sharp corner of the outline (a fillet)">Round</button>
          <button className="btn small ghost" onClick={() => cutCorners('cut', null)} title="Cut every sharp corner of the outline off straight (a chamfer)">Cut</button>
        </>}
        {mode === 'edit' && pk?.kind === 'v' && (() => {
          const q = loops[pk.loop][pk.i];
          const set = (x: number, y: number) => onLoop(pk.loop, moveCorner(loops[pk.loop], pk.i, [x, y]));
          return <>
            <span className="sb-lbl">{pk.loop ? 'Cut-out corner' : 'Corner'}</span>
            <MiniNum label="X" value={q[0]} onSet={(v) => set(v, q[1])} title="Across, in the board's own coordinates" />
            <MiniNum label="Y" value={q[1]} onSet={(v) => set(q[0], v)} title="Up, in the board's own coordinates" />
            <span className="tsep" />
            <MiniNum label="Size" value={cs} onSet={(v) => setCs(Math.max(0.1, v))} title="The radius to round it to, or how far along each edge to cut it" />
            <button className="btn small ghost" onClick={() => cutCorners('round', pk)} title="Round this corner (a fillet)">Round</button>
            <button className="btn small ghost" onClick={() => cutCorners('cut', pk)} title="Cut this corner off straight (a chamfer)">Cut</button>
            <span className="tsep" />
            <button className="btn small danger" onClick={() => delCorner(pk)} title="Delete">Delete corner</button>
            {pk.loop > 0 && <button className="btn small ghost" onClick={() => removeCutout(pk.loop)}>Remove cut-out</button>}
          </>;
        })()}
        {mode === 'edit' && pk?.kind === 'e' && (() => {
          const l = loops[pk.loop], a = l[pk.i], c = l[(pk.i + 1) % l.length];
          return <>
            <span className="sb-lbl">{pk.loop ? 'Cut-out edge' : 'Edge'}</span>
            <MiniNum label="Length" value={dist(a, c)} onSet={(v) => { if (v > 0) onLoop(pk.loop, setEdgeLength(l, pk.i, v)); }} title="Type what it measures: its far end moves along it (a square side slides out with it)" />
            <span className="tsep" />
            <MiniNum label="Arc" value={bh} onSet={setBh} title="How far the middle of the edge bows out (a minus number: in)" />
            <button className="btn small ghost" onClick={() => { if (onLoop(pk.loop, bendEdge(l, pk.i, bh))) setPick(null); }} title="Bend this edge into an arc">Bend</button>
            <button className="btn small ghost" onClick={() => { const nl = addCorner(l, pk.i, [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]); if (onLoop(pk.loop, nl)) setPick({ loop: pk.loop, kind: 'v', i: pk.i + 1 }); }} title="A new corner in the middle of this edge">+ Corner</button>
            {pk.loop > 0 && <button className="btn small ghost" onClick={() => removeCutout(pk.loop)}>Remove cut-out</button>}
          </>;
        })()}
        {mode === 'line' && <>
          <div className="seg" aria-label="What the shape does">
            {([['add', 'Add'], ['cut', 'Cut out'], ['new', 'New outline']] as const).map(([k, n]) => <button key={k} className={lineOp === k ? 'on' : ''} onClick={() => setLineOp(k)} title={k === 'add' ? 'Joined on to the board' : k === 'cut' ? 'Taken out of the board: a notch at the edge, or a cut-out inside' : 'The board takes this shape'}>{n}</button>)}
          </div>
          <div className="seg" aria-label="The next edge">
            <button className={!arcOn ? 'on' : ''} onClick={() => { setArcOn(false); setArcEnd(null); }} title="Straight edges">Line</button>
            <button className={arcOn ? 'on' : ''} onClick={() => setArcOn(true)} title="A three-point arc: where it ends, then a point it passes through (A)">Arc</button>
          </div>
          {draft && !arcOn && <>
            <label className="sb-num" title="Type the next edge's length and press Enter (the angle comes from the pointer if you leave it empty)"><span>Length</span><input ref={lenRef} type="text" inputMode="decimal" className="mono" value={typed.L} placeholder={liveLA ? liveLA.L.toFixed(2) : ''} onChange={(e) => setTyped({ ...typed, L: e.target.value })} onKeyDown={(e) => typedKey(e)} aria-label="Next edge length in mm" /><em>mm</em></label>
            <label className="sb-num" title="0° is to the right, 90° up"><span>Angle</span><input type="text" inputMode="decimal" className="mono" value={typed.A} placeholder={liveLA ? liveLA.deg.toFixed(1) : ''} onChange={(e) => setTyped({ ...typed, A: e.target.value })} onKeyDown={(e) => typedKey(e)} aria-label="Next edge angle in degrees" /><em>°</em></label>
          </>}
          {draft && <>
            <button className="btn small ghost" onClick={undoPoint} title="Backspace">Undo point</button>
            <button className="btn small primary" onClick={closeNow} disabled={draft.pts.length < 3} title="Join the last corner to the first (Enter)">Close</button>
          </>}
        </>}
        {mode === 'shapes' && <>
          <div className="seg" aria-label="Shape">
            {([['rect', 'Rectangle'], ['circle', 'Circle'], ['slot', 'Slot']] as const).map(([k, n]) => <button key={k} className={prim === k ? 'on' : ''} onClick={() => setPrim(k)}>{n}</button>)}
          </div>
          {prim === 'rect' && <><MiniNum label="W" value={pw} onSet={(v) => setPw(Math.max(0.2, v))} title="Width" /><MiniNum label="H" value={ph} onSet={(v) => setPh(Math.max(0.2, v))} title="Height" /></>}
          {prim === 'circle' && <MiniNum label="Ø" value={pd} onSet={(v) => setPd(Math.max(0.2, v))} title="Diameter" />}
          {prim === 'slot' && <><MiniNum label="Long" value={sl} onSet={(v) => setSl(Math.max(0.2, v))} title="Length, end to end" /><MiniNum label="Wide" value={sw} onSet={(v) => setSw(Math.max(0.2, v))} title="Width" /><MiniNum label="Turn" value={sa} unit="°" onSet={setSa} title="0° lies along x, 90° up" /></>}
          <div className="seg" aria-label="Add or cut">
            <button className={primOp === 'add' ? 'on' : ''} onClick={() => setPrimOp('add')} title="Joined on to the board">Add</button>
            <button className={primOp === 'cut' ? 'on' : ''} onClick={() => setPrimOp('cut')} title="A notch at the edge, or a cut-out inside">Cut out</button>
          </div>
        </>}
      </div>
      {nOff > 0 && <div className="sb-note bad">{offWords(off)} off the board or on its edge (red): move {nOff === 1 ? 'it' : 'them'}, or change the shape.</div>}
    </div>
  ) : null;

  function typedKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = typedPoint();
      if (q) { addPoint(q); setTyped({ L: '', A: '' }); }
      else closeNow();
    }
    if (e.key === 'Escape') { setTyped({ L: '', A: '' }); (e.target as HTMLInputElement).blur(); }
  }

  const hint = say(isBox ? 'a box takes its shape from its size, under Box'
    : mode === 'edit' ? (pk?.kind === 'v' ? 'drag it (snaps; Alt: freely) · Delete removes it · type X and Y, or round or cut it · Esc' : pk?.kind === 'e' ? 'drag to slide it · type its length, or bend it into an arc · Esc' : 'drag a corner or an edge (snaps; Alt: freely) · click + to add a corner · click to select · E L')
    : mode === 'line' ? (arcOn ? (!draft ? 'arc: click where the shape starts' : arcEnd ? 'now a point the arc passes through' : 'arc: click where it ends') : !draft ? 'click the first corner · Shift: 15° steps · Alt: no snapping' : 'next corner, or type a length (Enter) · click the first point or Enter to close · Backspace undoes · A: arc')
      : `click to put a ${prim === 'rect' ? `${fmt(pw)} × ${fmt(ph)} rectangle` : prim === 'circle' ? `Ø${fmt(pd)} circle` : `${fmt(sl)} × ${fmt(sw)} slot`} there, or drag to draw one · Alt: no snapping`);

  return { onDown, onMove, onUp, layer, panel, hint, cursor: mode === 'edit' ? 'default' : 'crosshair', isBox };
}

/** A small number box for the bar: the value, a label beside it, set on Enter or leaving it. */
function MiniNum({ label, value, onSet, unit = 'mm', title }: { label: string; value: number; onSet: (v: number) => void; unit?: string; title?: string }) {
  const [txt, setTxt] = useState(fmt(value));
  useEffect(() => setTxt(fmt(value)), [value]);
  const commit = () => {
    const v = parseFloat(txt.replace(',', '.'));
    if (Number.isFinite(v) && Math.abs(v - value) > 1e-9) onSet(v);
    else setTxt(fmt(value));
  };
  return (
    <label className="sb-num" title={title}>
      <span>{label}</span>
      <input type="text" inputMode="decimal" className="mono" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') { setTxt(fmt(value)); (e.target as HTMLInputElement).blur(); } }} aria-label={title ?? label} />
      <em>{unit}</em>
    </label>
  );
}
