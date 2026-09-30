// The board editor: a drawing of the board, the toolbox docked beside it, and a photo of the real board under it if
// you have one. Click a part in the toolbox (or drag it over) and it follows the pointer until you place it; plugs
// snap to the nearest edge. Drag parts about: they snap to the board's edges and middle and to the other parts, and
// show how far they are from the nearest edges. Measure puts a dimension between two things and typing what your
// calipers say moves the part there. Shape (ShapeTool) edits the outline and cut-outs. Hover anything for what it is.
// Keys: V select, H pan (or Space / right-drag), M measure, S shape, T toolbox, ⌘A all, Esc none, Del delete, R rotate,
// ⌘D duplicate, arrows nudge (Shift 1 mm), Alt while dragging: no snapping. Wheel zooms.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Comp, Dim, Feat, Project, V2 } from '../model/types';
import { bbox, compRect, extentAlong, rad, uid } from '../geom/poly';
import { connById } from '../model/library';
import { boxFromEdits } from '../model/boxes';
import { activeModule, commitFrom, editMod, isSel, select, store, toast, useApp, type SelItem } from '../state';
import { ROLE_INFO } from '../model/holes';
import { PALETTE } from '../model/palette';
import { axisOf, featAt, layoutDims, lineMates, measure, pickFeat, setDim, type DimBox, type DimMove } from '../model/dims';
import { boardCopper } from '../model/copper';
import { boardLights } from '../model/lights';
import { headerPins } from '../model/probes';
import { cardOf } from '../model/cards';
import { plugName } from '../model/links';
import { alignPhoto, dimPopupAt, edgeGaps, fitPhoto, itemsBox, scalePhoto, snapBox, snapLines, type Box2 } from '../model/editorgeo';
import { PART_DRAG, Toolbox } from './Toolbox';
import { useShapeTool } from './ShapeTool';
import { say, touchy } from './touch';

export type Tool = 'select' | 'pan' | 'place' | 'measure' | 'shape' | 'photoScale' | 'photoAlign';
const PIN_TYPES = new Set(['header', 'pins_ra', 'jst_ph', 'jst_xh', 'jst_gh', 'jst_zh', 'picoblade', 'kk254', 'swd10', 'cortex20', 'jtag20', 'idc']);
const snap = (v: number) => Math.round(v * 10) / 10;
const TBX_KEY = 'boarddock.toolbox';
const CU_KEY = 'boarddock.copper';

/** How a part looks from above, by what it is. */
function look(c: Comp): { fill: string; stroke: string; round?: boolean; ic?: boolean; metal?: boolean; hatch?: boolean; ends?: boolean; label: 'dark' | 'light' } {
  const n = `${c.pkg} ${c.value ?? ''}`;
  const round = Math.abs(c.w - c.l) < 0.25 * Math.min(c.w, c.l);
  if (c.conn?.entry === 'edge') return { fill: '#c5cad1', stroke: '#eef2f6', metal: true, label: 'dark' };
  if (c.conn || c.kind === 'header') return { fill: '#1d2024', stroke: '#6b7480', label: 'light' };
  if (/elec|\bCP_|cap/i.test(n) && round && c.h > 3) return { fill: '#2f5fa8', stroke: '#b9c6d6', round: true, label: 'light' };
  if (/keep-?out/i.test(n)) return { fill: 'transparent', stroke: '#ff8a5c', hatch: true, label: 'light' };
  switch (c.kind) {
    case 'led': return { fill: '#ffd166', stroke: '#fff1c2', round, label: 'dark' };
    case 'switch': return { fill: '#3a4048', stroke: '#9aa6b3', label: 'light' };
    case 'module': return { fill: '#3d5872', stroke: '#a7b6c6', label: 'light' };
    case 'hot': return { fill: '#b8553a', stroke: '#ffb3aa', label: 'light' };
    case 'antenna': return { fill: '#2a6db5', stroke: '#b7d8ff', hatch: true, label: 'light' };
  }
  if (/relay/i.test(n)) return { fill: '#2f62b8', stroke: '#b7d0ff', label: 'light' };
  // a resistor (black) or a capacitor (tan) the size of a grain of rice, its two tinned ends
  if (Math.max(c.w, c.l) <= 4.5 && Math.min(c.w, c.l) < 3 && c.h <= 2 && !c.conn) return { fill: /^C/i.test(c.ref) ? '#b08d5e' : '#1f2226', stroke: '#6b7480', ends: true, label: 'light' };
  if (/qfp|qfn|soic|sop|dfn|bga|tssop|ic\b|mcu|lqfp/i.test(n) || (Math.min(c.w, c.l) >= 3 && c.h <= 3)) return { fill: '#26292e', stroke: '#707985', ic: true, label: 'light' };
  return { fill: '#3d4957', stroke: '#8b99a8', label: 'light' };
}

/** The legs or pads round a chip, from its footprint name: four sides (QFP), two long sides (SOIC, SOP, TSSOP), pads just
 * inside the edges (QFN, DFN). In the part's own frame (x along w, y along l). */
function icPads(c: Comp): { x: number; y: number; w: number; h: number }[] {
  const n = `${c.pkg} ${c.value ?? ''}`, m = /(?:QFP|QFN|SOIC|SOP|SSOP|TSSOP|DFN|MSOP)[^\d]{0,3}(\d{1,3})/i.exec(n);
  const pins = m ? +m[1] : 0, pm = /P(\d+(?:\.\d+)?)mm/i.exec(n), pitch = pm ? +pm[1] : 0.5;
  if (!pins || c.w < 2 || c.l < 2) return [];
  const out: { x: number; y: number; w: number; h: number }[] = [];
  const four = /QFP|QFN/i.test(m![0]), under = /QFN|DFN/i.test(m![0]);
  const per = four ? Math.round(pins / 4) : Math.round(pins / 2), len = under ? 0.5 : 0.7, wid = Math.min(pitch * 0.55, 0.4);
  const side = (horiz: boolean, s: number) => {
    const span = horiz ? c.w : c.l, k = Math.min(per, Math.floor((span - 1) / pitch) + 1);
    for (let i = 0; i < k; i++) {
      const u = (i - (k - 1) / 2) * pitch;
      const edge = (horiz ? c.l : c.w) / 2 + (under ? -len / 2 : len / 2 - 0.1);
      out.push(horiz ? { x: u, y: s * edge, w: wid, h: len } : { x: s * edge, y: u, w: len, h: wid });
    }
  };
  if (four) { side(true, 1); side(true, -1); side(false, 1); side(false, -1); }
  else if (c.w >= c.l) { side(true, 1); side(true, -1); } else { side(false, 1); side(false, -1); }
  return out;
}

/** A phone-sized window (the toolbox closes itself there so the board stays tappable). */
const phone = () => !!window.matchMedia?.('(max-width: 600px)').matches;

export function BoardEditor({ tool, setTool }: { tool: Tool; setTool: (t: Tool) => void }) {
  const project = useApp((s) => s.project)!;
  const sel = useApp((s) => s.sel);
  const result = useApp((s) => s.result);
  const mod = activeModule(project);
  const b = mod.board, H = mod.holder;
  const bb = useMemo(() => bbox(b.outline), [b.outline]);
  const svg = useRef<SVGSVGElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [vb, setVb] = useState(() => fitBox(bb));
  const [px, setPx] = useState(0.1); // mm per screen pixel
  const [cursor, setCursor] = useState<V2 | null>(null);
  const [marquee, setMarquee] = useState<{ a: V2; b: V2 } | null>(null);
  const [space, setSpace] = useState(false);
  const [item, setItem] = useState<string | null>(null); // the toolbox part being placed
  // on a phone the toolbox would cover the board: it starts closed there
  const [tbx, setTbx] = useState(() => { if (phone()) return false; try { return localStorage.getItem(TBX_KEY) !== '0'; } catch { return true; } });
  const [showCu, setShowCu] = useState(() => { try { return localStorage.getItem(CU_KEY) !== '0'; } catch { return true; } });
  const [dimA, setDimA] = useState<Feat | null>(null);
  const [editDim, setEditDim] = useState<{ id: string; v: string } | null>(null);
  const [together, setTogether] = useState(true); // a measured hole takes the holes in line with it along
  const [moveEnd, setMoveEnd] = useState<DimMove>('b'); // which end a typed measurement moves
  const [hov, setHov] = useState<{ kind: string; id: string; x: number; y: number } | null>(null);
  const [snapF, setSnapF] = useState<Feat | null>(null);
  const [guides, setGuides] = useState<{ gx: number | null; gy: number | null; box: Box2 } | null>(null);
  const [photoA, setPhotoA] = useState<V2 | null>(null);
  const [photoAsk, setPhotoAsk] = useState<{ a: V2; c: V2; v: string } | null>(null);
  const [photoMenu, setPhotoMenu] = useState(false);
  const photoFile = useRef<HTMLInputElement>(null);
  const drag = useRef<{ kind: 'pan' | 'move' | 'box' | 'dim'; start: V2; client: V2; vb0: typeof vb; orig?: Map<string, V2>; moved?: boolean; pre?: Project; additive?: boolean; dim?: { id: string; axis: 'x' | 'y'; va: number; vb: number; line0: number; t0: number; anchor: number } } | null>(null);
  const [dimLast, setDimLast] = useState<string | null>(null); // the dimension dragged last: it steps aside, not the others
  // the Measure popup: its number is focused and selected when it opens (a beat later: the click that made the dimension
  // would take focus back), and its size is read so it can sit beside the dimension line
  const dimPop = useRef<HTMLDivElement>(null), dimIn = useRef<HTMLInputElement>(null);
  const [popSize, setPopSize] = useState({ w: 236, h: 120 });
  useEffect(() => {
    if (!editDim) return;
    const t = setTimeout(() => { dimIn.current?.focus(); dimIn.current?.select(); }, 0);
    return () => clearTimeout(t);
  }, [editDim?.id]);
  useLayoutEffect(() => {
    const el = dimPop.current;
    if (el && (Math.abs(el.offsetWidth - popSize.w) > 1 || Math.abs(el.offsetHeight - popSize.h) > 1)) setPopSize({ w: el.offsetWidth, h: el.offsetHeight });
  });
  const shape = useShapeTool({ b, px, active: tool === 'shape', setTool });
  // on a phone the toolbox lies over the drawing: the Shape tool needs the board, so it closes it
  useEffect(() => { if (tool === 'shape' && typeof matchMedia !== 'undefined' && matchMedia('(max-width: 900px)').matches) setTbx(false); }, [tool]);

  useEffect(() => setVb(fitBox(bb)), [mod.id]);
  // a new size fits the view to it, but not while the Shape tool changes it (the view would move under the pointer)
  useEffect(() => { if (tool !== 'shape') setVb(fitBox(bb)); }, [bb.x0, bb.y0, bb.x1, bb.y1]);
  useEffect(() => { try { localStorage.setItem(TBX_KEY, tbx ? '1' : '0'); } catch { /* private mode */ } }, [tbx]);
  useEffect(() => { try { localStorage.setItem(CU_KEY, showCu ? '1' : '0'); } catch { /* private mode */ } }, [showCu]);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const upd = () => { const r = el.getBoundingClientRect(); setPx(Math.max(vb.w / Math.max(1, r.width), vb.h / Math.max(1, r.height))); };
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    upd();
    return () => ro.disconnect();
  }, [vb.w, vb.h, tbx]);

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
  const zoom = (k: number, at?: V2) => setVb((v) => { const w = at ?? [v.x + v.w / 2, -(v.y + v.h / 2)]; return { x: w[0] - (w[0] - v.x) * k, y: -w[1] - (-w[1] - v.y) * k, w: v.w * k, h: v.h * k }; });

  const putPart = (id: string, w: V2) => {
    const it = PALETTE.find((x) => x.id === id);
    if (!it) return;
    const made = it.make(b, w);
    editMod((m) => { if (made.comp) m.board.comps.push(made.comp); if (made.hole) m.board.holes.push(made.hole); if (made.comp?.conn) boxFromEdits(m.board); });
    if (made.comp) select([{ kind: 'comp', id: made.comp.id }]); else if (made.hole) select([{ kind: 'hole', id: made.hole.id }]);
  };
  const arm = (id: string | null) => { setItem(id); setTool(id ? 'place' : 'select'); if (id && phone()) setTbx(false); };

  const onDown = (e: React.PointerEvent) => {
    const w = toWorld(e);
    setPhotoMenu(false);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const panning = e.button === 1 || e.button === 2 || space || tool === 'pan';
    if (panning || (tool === 'shape' && !shape.onDown(e, w))) { drag.current = { kind: 'pan', start: w, client: [e.clientX, e.clientY], vb0: vb }; return; }
    if (tool === 'shape') return;
    if (tool === 'place' && item) { putPart(item, w); if (!e.shiftKey) arm(null); return; }
    if (tool === 'measure') {
      const f = pickFeat(b, w, 12 * px);
      if (!f) return;
      if (!dimA) { setDimA(f); return; }
      const axis = axisOf(b, dimA, f);
      if (!axis || JSON.stringify(dimA) === JSON.stringify(f)) { toast('Those two do not line up along x or y: pick a hole, a part, a side of one, or an edge of the board.'); setDimA(null); return; }
      const d: Dim = { id: uid('dim'), a: dimA, b: f, axis };
      editMod((m) => { m.board.dims = [...(m.board.dims ?? []), d]; });
      setDimA(null);
      setEditDim({ id: d.id, v: (measure(b, d) ?? 0).toFixed(2) });
      return;
    }
    if (tool === 'photoScale' || tool === 'photoAlign') {
      if (!photoA) { setPhotoA(w); return; }
      if (tool === 'photoScale') setPhotoAsk({ a: photoA, c: w, v: '' });
      else { editMod((m) => { if (m.board.photo) m.board.photo = alignPhoto(m.board.photo, photoA, w); }); setTool('select'); }
      setPhotoA(null);
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
    if (tool === 'measure') setSnapF(pickFeat(b, w, 12 * px));
    if (tool === 'shape' && !d) { shape.onMove(e, w); setHov(null); return; }
    if (!d) {
      const t = (e.target as SVGElement).closest('[data-id]') as SVGElement | null;
      const r = wrap.current?.getBoundingClientRect();
      setHov(t && r && tool === 'select' ? { kind: t.dataset.kind!, id: t.dataset.id!, x: e.clientX - r.left, y: e.clientY - r.top } : null);
      return;
    }
    if (d.kind === 'pan') {
      const r = svg.current!.getBoundingClientRect();
      const s = Math.max(d.vb0.w / r.width, d.vb0.h / r.height);
      setVb({ ...d.vb0, x: d.vb0.x - (e.clientX - d.client[0]) * s, y: d.vb0.y - (e.clientY - d.client[1]) * s });
    } else if (d.kind === 'dim' && d.dim) {
      // a dimension's label: across its line moves the line, along it slides the label (past the ends is fine)
      if (!d.moved && Math.hypot(e.clientX - d.client[0], e.clientY - d.client[1]) < 3) return;
      d.moved = true;
      const q = d.dim, du = q.axis === 'x' ? w[0] - d.start[0] : w[1] - d.start[1], dv = q.axis === 'x' ? w[1] - d.start[1] : w[0] - d.start[0];
      const span = q.vb - q.va, t = Math.abs(span) > 1e-6 ? Math.max(-0.8, Math.min(1.8, q.t0 + du / span)) : q.t0;
      const p = structuredClone(store.get().project!);
      const dd = (activeModule(p).board.dims ?? []).find((x) => x.id === q.id);
      if (dd) { dd.off = Math.round((q.line0 + dv - q.anchor) * 100) / 100; dd.t = Math.round(t * 1000) / 1000; }
      store.set({ project: p });
    } else if (d.kind === 'box') {
      setMarquee({ a: d.start, b: w });
    } else if (d.orig) {
      if (!d.moved && Math.hypot(e.clientX - d.client[0], e.clientY - d.client[1]) < 3) return;
      d.moved = true;
      let dx = w[0] - d.start[0], dy = w[1] - d.start[1];
      // snap to the board's edges and middle and to the other parts (Alt: freely), from where they started
      const ids = new Set(d.orig.keys());
      const pre = activeModule(d.pre!).board;
      const b0 = itemsBox(pre, ids);
      let box: Box2 | null = b0 && { x0: b0.x0 + dx, y0: b0.y0 + dy, x1: b0.x1 + dx, y1: b0.y1 + dy };
      let gx: number | null = null, gy: number | null = null;
      if (box && !e.altKey) {
        const s = snapBox(box, snapLines(pre, ids), 6 * px);
        dx += s.dx; dy += s.dy; gx = s.gx; gy = s.gy;
        box = { x0: box.x0 + s.dx, y0: box.y0 + s.dy, x1: box.x1 + s.dx, y1: box.y1 + s.dy };
      }
      setGuides(box ? { gx, gy, box } : null);
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
    if (tool === 'shape') shape.onUp();
    const d = drag.current;
    drag.current = null;
    setGuides(null);
    if (d?.kind === 'move' && d.moved && d.pre) {
      // a box's ports stay where they were dragged: written into the box, so its next layout keeps them
      const p = structuredClone(store.get().project!);
      if (boxFromEdits(activeModule(p).board)) store.set({ project: p });
      commitFrom(d.pre);
    }
    if (d?.kind === 'dim' && d.dim) {
      const id = d.dim.id;
      if (!d.moved) { const q = dimsDraw.find((x) => x.id === id); if (q) setEditDim({ id, v: q.value.toFixed(2) }); }
      else if (d.pre) {
        // keep it where it is drawn: if it was let go on top of another it has stepped aside, and stays there
        const p = structuredClone(store.get().project!), mb = activeModule(p).board;
        const q = layoutDims(mb, px, { avoid: sizeBoxes, last: id }).find((x) => x.id === id), dd = (mb.dims ?? []).find((x) => x.id === id);
        if (q && dd) { dd.off = Math.round((q.line - q.anchor) * 100) / 100; dd.t = q.t; store.set({ project: p }); }
        commitFrom(d.pre);
      }
    }
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
      if (e.key === 'Escape') { select([]); setTool('select'); setItem(null); setDimA(null); setEditDim(null); setPhotoA(null); setPhotoAsk(null); return; }
      if (!cmd && !s.length) {
        const k = e.key.toLowerCase();
        if (k === 'v') { setTool('select'); setItem(null); return; }
        if (k === 'h') { setTool('pan'); return; }
        if (k === 'm') { setTool('measure'); setDimA(null); return; }
        if (k === 's' && mb.kind !== 'box') { setTool('shape'); setItem(null); return; }
        if (k === 't') { setTbx((x) => !x); return; }
      }
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

  // a photo of the real board: made small enough to keep with the project, fitted inside the outline
  const loadPhoto = (f: File) => {
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const k = Math.min(1, 1400 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
      const data = cv.toDataURL('image/jpeg', 0.82);
      URL.revokeObjectURL(url);
      editMod((m) => { m.board.photo = fitPhoto(m.board, data, cv.width, cv.height); });
      toast('Photo under the board. Scale it: two points on it you know the distance between (two holes), then that distance. Then line it up: a point on the photo, then the same point on the drawing.');
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('That file is not a picture this browser can read.'); };
    img.src = url;
  };

  const path = (l: V2[]) => 'M' + l.map(([x, y]) => `${x.toFixed(3)},${(-y).toFixed(3)}`).join('L') + 'Z';
  const fs = (n: number) => n * px; // screen-constant sizes
  const clipAt = result?.report.clipAt;
  const levels = result?.report.levels;
  const nSel = sel.length;
  // what each plug on an edge is, printed on the board just inside it (on the plug itself the plug hides it): its
  // reference and its kind, along the edge, reading the right way up, pushed further in where it would sit on another.
  // Zoomed out it is still written big enough to read on screen, if there is room for it; else at its own size
  const plugLabels = useMemo(() => {
    const out: { x: number; y: number; deg: number; ref: string; kind: string; fz: number }[] = [];
    const shown = b.comps.filter((c) => !c.hidden), boxes = shown.map((c) => bbox(compRect(c, 0.2)));
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const c of b.comps) {
      if (c.hidden || c.side === 'bottom' || c.conn?.entry !== 'edge') continue;
      const d: V2 = [Math.cos(rad(c.conn.angle)), Math.sin(rad(c.conn.angle))], t: V2 = [-d[1], d[0]];
      const back = extentAlong(c, c.conn.angle + 180), wide = Math.abs(t[0]) * c.w + Math.abs(t[1]) * c.l;
      const own = Math.max(1, Math.min(2.2, wide / Math.max(4, c.ref.length) / 0.7)), readable = 8.5 * px;
      const kind = plugName(c.conn.type);
      let deg = (Math.atan2(t[1], t[0]) * 180) / Math.PI;
      if (deg > 90.01) deg -= 180; else if (deg <= -90.01) deg += 180;
      const others = boxes.filter((_, i) => shown[i] !== c);
      const hit = (r: { x0: number; y0: number; x1: number; y1: number }) => r.x0 < bb.x0 || r.x1 > bb.x1 || r.y0 < bb.y0 || r.y1 > bb.y1 || [...taken, ...others].some((o) => o.x0 < r.x1 && r.x0 < o.x1 && o.y0 < r.y1 && r.y0 < o.y1);
      // one size: where it goes, stepping further in while it sits on something
      const place = (fz: number) => {
        const len = Math.max(c.ref.length * fz, kind.length * fz * 0.72) * 0.62, h = fz * 1.9;
        const boxAt = (q: V2) => { const hx = Math.abs(t[0]) * len / 2 + Math.abs(d[0]) * h / 2, hy = Math.abs(t[1]) * len / 2 + Math.abs(d[1]) * h / 2; return { x0: q[0] - hx, x1: q[0] + hx, y0: q[1] - hy, y1: q[1] + hy }; };
        let at: V2 = [c.x - d[0] * (back + 0.8 + h / 2), c.y - d[1] * (back + 0.8 + h / 2)];
        for (let k = 0; k < 4 && hit(boxAt(at)); k++) at = [at[0] - d[0] * (h + 0.4), at[1] - d[1] * (h + 0.4)];
        return { fz, at, box: boxAt(at), clear: !hit(boxAt(at)) };
      };
      const tries = readable > own ? [place(readable), place(own)] : [place(own)];
      const pick = tries.find((q) => q.clear) ?? (own / Math.max(px, 1e-6) > 5.5 ? tries[tries.length - 1] : null);
      if (!pick) continue; // too small to read here and nowhere clear to write it bigger
      taken.push(pick.box);
      out.push({ x: pick.at[0], y: pick.at[1], deg, ref: c.ref, kind, fz: pick.fz });
    }
    return out;
  }, [b.comps, bb, px]);
  // the board's size, on the sides with fewer edge plugs so it doesn't cover one; its labels are kept clear of
  const sizeAt = useMemo(() => {
    const n = (ang: number) => b.comps.filter((c) => c.conn && c.conn.entry === 'edge' && Math.round(c.conn.angle) === ang).length;
    return { top: n(90) <= n(-90), left: n(180) <= n(0) };
  }, [b.comps]);
  // where the board's size labels sit: mid-side, 30 px out, slid along their line off any plug's opening (the hatched
  // space its plug needs); where a side is full of them, further out past the openings
  const sizeLab = useMemo(() => {
    const zones = b.comps.filter((c) => !c.hidden && c.conn?.entry === 'edge').map((c) => {
      const dd = c.conn!, e = extentAlong(c, dd.angle);
      return bbox(plugPoly([c.x + Math.cos(rad(dd.angle)) * e, c.y + Math.sin(rad(dd.angle)) * e], dd.angle, dd.plug.w, dd.plug.len));
    });
    const hh = 9 * px, pad = 4 * px;
    const side = (vertical: boolean, v: number) => {
      const half = ((v.toFixed(1).length * 7.2 + 14) * px) / 2;
      const lo = vertical ? bb.y0 : bb.x0, hi = vertical ? bb.y1 : bb.x1, mid = (lo + hi) / 2;
      const out = vertical ? (sizeAt.left ? -1 : 1) : (sizeAt.top ? 1 : -1), edge = vertical ? (sizeAt.left ? bb.x0 : bb.x1) : (sizeAt.top ? bb.y1 : bb.y0);
      const boxAt = (at: number, off: number) => { const q = edge + out * off; return vertical ? { x0: q - hh - pad, x1: q + hh + pad, y0: at - half - pad, y1: at + half + pad } : { x0: at - half - pad, x1: at + half + pad, y0: q - hh - pad, y1: q + hh + pad }; };
      const hits = (r: DimBox) => zones.filter((z) => z.x0 < r.x1 && r.x0 < z.x1 && z.y0 < r.y1 && r.y0 < z.y1);
      const off = 30 * px, n = 24;
      for (let k = 0; k <= n; k++) for (const sgn of k ? [1, -1] : [1]) {
        const at = mid + (sgn * k * (hi - lo)) / (2 * n);
        if (!hits(boxAt(at, off)).length) return { at, off };
      }
      // nowhere clear along it: the line goes out past the openings it would cross
      const far = Math.max(...hits(boxAt(mid, off)).map((z) => vertical ? (out > 0 ? z.x1 - edge : edge - z.x0) : (out > 0 ? z.y1 - edge : edge - z.y0)));
      return { at: mid, off: Math.max(off, far + hh + 6 * px) };
    };
    return { w: side(false, bb.x1 - bb.x0), h: side(true, bb.y1 - bb.y0) };
  }, [b.comps, bb, px, sizeAt]);
  const sizeBoxes = useMemo((): DimBox[] => {
    const lw = (v: number) => (v.toFixed(1).length * 7.2 + 14) * px, hh = 9 * px;
    const w = bb.x1 - bb.x0, h = bb.y1 - bb.y0, { w: sw, h: sh } = sizeLab;
    const y = sizeAt.top ? bb.y1 + sw.off : bb.y0 - sw.off, x = sizeAt.left ? bb.x0 - sh.off : bb.x1 + sh.off;
    return [{ x0: sw.at - lw(w) / 2, x1: sw.at + lw(w) / 2, y0: y - hh, y1: y + hh }, { x0: x - hh, x1: x + hh, y0: sh.at - lw(h) / 2, y1: sh.at + lw(h) / 2 }];
  }, [bb, px, sizeAt, sizeLab]);
  // every dimension's line and label, none on top of another (model/dims)
  const dimsDraw = useMemo(() => layoutDims(b, px, { avoid: sizeBoxes, last: dimLast ?? undefined }), [b.dims, b.holes, b.comps, b.outline, px, sizeBoxes, dimLast]);
  // copper as a few paths (one per side and width), not thousands of elements: the board's own tracks, else plausible
  // ones from each plug to the main chip and between neighbours (model/copper), redrawn as parts move
  // its LEDs, lit and doing what they do (with the tracks: the look-real layer)
  const lamps = useMemo(() => boardLights(b), [b]);
  const copper = useMemo(() => {
    const cu = boardCopper(b);
    const g = new Map<string, { d: string[]; w: number; bottom: boolean }>();
    for (const t of cu.tracks.slice(0, 6000)) {
      const w = Math.max(0.1, Math.round(t.w * 10) / 10), k = `${t.side}:${w}`;
      const e = g.get(k) ?? g.set(k, { d: [], w, bottom: t.side === 'bottom' }).get(k)!;
      e.d.push(`M${t.a[0].toFixed(2)},${(-t.a[1]).toFixed(2)}L${t.b[0].toFixed(2)},${(-t.b[1]).toFixed(2)}`);
    }
    const paths = [...g.values()].sort((x, y) => Number(y.bottom) - Number(x.bottom)).map((e) => ({ d: e.d.join(''), w: e.w, bottom: e.bottom }));
    return { paths, vias: cu.vias.slice(0, 1500), real: !!b.traces?.length };
  }, [b.traces, b.vias, b.comps, b.holes, b.outline, b.cutouts, b.name]);
  // the part about to be placed, where it would land
  const ghost = useMemo(() => {
    if (tool !== 'place' || !item || !cursor) return null;
    const it = PALETTE.find((x) => x.id === item);
    return it ? it.make(b, cursor) : null;
  }, [tool, item, cursor?.[0], cursor?.[1], b]);
  const armedItem = PALETTE.find((x) => x.id === item);

  const partSvg = (c: Comp, ghostly = false) => {
    const r = compRect(c), on = !ghostly && isSel(sel, c.id), L = look(c), bottom = c.side === 'bottom';
    const lbl = !ghostly && c.conn?.entry !== 'edge' && Math.min(c.w, c.l) / Math.max(px, 1e-6) > 22;
    const d = c.conn?.entry === 'edge' ? [Math.cos(rad(c.conn.angle)), Math.sin(rad(c.conn.angle))] : null;
    const ext = d ? extentAlong(c, c.conn!.angle) : 0;
    const rr = Math.min(c.w, c.l) / 2;
    // a shadow as long as the part is tall (light from the top left), the silkscreen outline round it, its legs
    const shadow = bottom || ghostly || L.hatch ? undefined : c.h >= 8 ? 'url(#sh3)' : c.h >= 3 ? 'url(#sh2)' : 'url(#sh1)';
    const T = `translate(${c.x},${-c.y}) rotate(${-c.rot})`;
    const pads = L.ic ? icPads(c) : [];
    const pins = c.conn && PIN_TYPES.has(c.conn.type) ? headerPins(c) : [];
    const pitchPx = (c.conn?.type === 'swd10' ? 1.27 : 2.54) / Math.max(px, 1e-6);
    return (
      <g key={c.id} data-id={ghostly ? undefined : c.id} data-kind={ghostly ? undefined : 'comp'} style={{ cursor: ghostly ? 'none' : 'move', pointerEvents: ghostly ? 'none' : undefined }} opacity={ghostly ? 0.65 : 1}>
        {/* the card in a card socket (M.2, PCIe, DIMM): not drawn in 3D, but the holder keeps clear of its box */}
        {!ghostly && (() => { const k = cardOf(c, b); return k && <polygon points={compRect(k).map(([x, y]) => `${x},${-y}`).join(' ')} fill="none" stroke="var(--silk)" strokeOpacity={0.7} strokeWidth={fs(1)} strokeDasharray={`${fs(5)} ${fs(3)}`} style={{ pointerEvents: 'none' }}><title>{`Card in ${c.ref}: the holder keeps clear of it`}</title></polygon>; })()}
        {!bottom && !ghostly && !L.metal && <rect transform={T} x={-c.w / 2 - 0.45} y={-c.l / 2 - 0.45} width={c.w + 0.9} height={c.l + 0.9} rx={L.round ? rr + 0.45 : 0.2} fill="none" stroke="var(--silk)" strokeOpacity={0.55} strokeWidth={0.15} style={{ pointerEvents: 'none' }} />}
        {pads.length > 0 && pitchPx * 0.5 > 1.2 && <g transform={T} style={{ pointerEvents: 'none' }}>{pads.map((q, i) => <rect key={i} x={q.x - q.w / 2} y={q.y - q.h / 2} width={q.w} height={q.h} fill="#c9cdd2" />)}</g>}
        <g filter={shadow}>
        {L.round ? <circle cx={c.x} cy={-c.y} r={rr} fill={L.fill} fillOpacity={bottom ? 0.2 : 1} stroke={on || ghostly ? 'var(--accent)' : L.stroke} strokeWidth={fs(on ? 2.5 : 1)} filter={on ? 'url(#glow)' : undefined} />
          : <polygon points={r.map(([x, y]) => `${x},${-y}`).join(' ')} fill={L.hatch ? 'url(#hatch2)' : L.metal ? 'url(#metal)' : L.fill} fillOpacity={bottom ? 0.2 : 1} stroke={on || ghostly ? 'var(--accent)' : L.stroke} strokeOpacity={on || ghostly ? 1 : 0.75} strokeWidth={fs(on ? 2.5 : 1)} strokeDasharray={bottom || L.hatch || ghostly ? `${fs(5)} ${fs(3)}` : undefined} strokeLinejoin="round" filter={on ? 'url(#glow)' : undefined} />}
        </g>
        {L.round && /elec|\bCP_|cap/i.test(c.pkg) && <path d={`M${c.x - rr * 0.64},${-c.y - rr * 0.72}A${rr * 0.98},${rr * 0.98} 0 0 1 ${c.x + rr * 0.64},${-c.y - rr * 0.72}`} fill="none" stroke="#e8edf4" strokeWidth={rr * 0.24} style={{ pointerEvents: 'none' }} />}
        {L.ends && <g transform={T} style={{ pointerEvents: 'none' }}>{c.w >= c.l
          ? <><rect x={-c.w / 2} y={-c.l / 2} width={c.w * 0.24} height={c.l} fill="#c9cdd2" /><rect x={c.w / 2 - c.w * 0.24} y={-c.l / 2} width={c.w * 0.24} height={c.l} fill="#c9cdd2" /></>
          : <><rect x={-c.w / 2} y={-c.l / 2} width={c.w} height={c.l * 0.24} fill="#c9cdd2" /><rect x={-c.w / 2} y={c.l / 2 - c.l * 0.24} width={c.w} height={c.l * 0.24} fill="#c9cdd2" /></>}</g>}
        {L.ic && <circle cx={r[0][0] + (r[2][0] - r[0][0]) * 0.14} cy={-(r[0][1] + (r[2][1] - r[0][1]) * 0.14)} r={Math.min(c.w, c.l) * 0.07} fill="#8a939e" style={{ pointerEvents: 'none' }} />}
        {/* the mouth of a plug on an edge: a dark band where the plug goes in */}
        {d && (() => { const m = [c.x + d[0] * ext, c.y + d[1] * ext], t = [-d[1], d[0]], hw = (Math.abs(t[0]) * c.w + Math.abs(t[1]) * c.l) / 2 * 0.8; return <line x1={m[0] - d[0] * 0.5 + t[0] * hw} y1={-(m[1] - d[1] * 0.5 + t[1] * hw)} x2={m[0] - d[0] * 0.5 - t[0] * hw} y2={-(m[1] - d[1] * 0.5 - t[1] * hw)} stroke="#2a2e33" strokeWidth={Math.min(1.1, Math.max(c.w, c.l) * 0.15)} style={{ pointerEvents: 'none' }} />; })()}
        {/* pins, pin 1 square, where there is room to see them */}
        {pins.length > 0 && pitchPx > 7 && pins.map((q, i) => i === 0
          ? <rect key={i} x={q.x - 0.55} y={-q.y - 0.55} width={1.1} height={1.1} fill="#d8b14a" style={{ pointerEvents: 'none' }} />
          : <circle key={i} cx={q.x} cy={-q.y} r={0.5} fill="#d8b14a" style={{ pointerEvents: 'none' }} />)}
        {/* what each pin is (its net), beside it, when there is room to read it */}
        {!ghostly && pins.length > 0 && pitchPx > 16 && pins.some((q) => q.net) && (() => {
          // on the board side of the header (a right-angle one's away from its pins), reading left to right or upward
          const a = ((c.w >= c.l ? c.rot : c.rot + 90) * Math.PI) / 180;
          let n: V2 = c.conn!.type === 'pins_ra' ? [-Math.cos(rad(c.conn!.angle)), -Math.sin(rad(c.conn!.angle))] : [-Math.sin(a), Math.cos(a)];
          if (c.conn!.type !== 'pins_ra' && n[0] * ((bb.x0 + bb.x1) / 2 - c.x) + n[1] * ((bb.y0 + bb.y1) / 2 - c.y) < 0) n = [-n[0], -n[1]];
          const off = Math.abs(n[0]) * c.w / 2 + Math.abs(n[1]) * c.l / 2 + 0.9, deg = (Math.atan2(n[1], n[0]) * 180) / Math.PI;
          const flip = Math.cos(rad(deg)) < -1e-6 || (Math.abs(Math.cos(rad(deg))) < 1e-6 && n[1] < 0);
          return pins.map((q, i) => { const x = q.x + n[0] * off, y = q.y + n[1] * off; return q.net && <text key={'n' + i} x={x} y={-y} fontSize={Math.min(1.25, fs(10))} textAnchor={flip ? 'end' : 'start'} dominantBaseline="central" transform={`rotate(${-(flip ? deg + 180 : deg)} ${x} ${-y})`} className="netlbl" style={{ pointerEvents: 'none' }}>{q.net.replace(/^\//, '').slice(0, 10)}</text>; });
        })()}
        {/* too small to write on: its reference printed beside it, as on the board */}
        {!lbl && !ghostly && !bottom && c.ref && c.conn?.entry !== 'edge' && 1 / Math.max(px, 1e-6) > 9 && (() => { const top = Math.max(...r.map((q) => q[1])); return <text x={c.x} y={-(top + 0.75)} fontSize={0.95} textAnchor="middle" className="netlbl" opacity={0.8} style={{ pointerEvents: 'none' }}>{c.ref.slice(0, 6)}</text>; })()}
        {lbl && <text x={c.x} y={-c.y} fontSize={fs(11)} textAnchor="middle" dominantBaseline="central" className={`silk ${L.label === 'dark' ? 'dark' : ''}`} style={{ pointerEvents: 'none' }}>{c.ref}</text>}
        {lbl && Math.min(c.w, c.l) / Math.max(px, 1e-6) > 44 && Math.max(c.w, c.l) / Math.max(px, 1e-6) > 7 * (c.conn ? plugName(c.conn.type) : c.value || 'xxxxxxxxxxxx').length && <text x={c.x} y={-c.y + fs(12)} fontSize={fs(9)} textAnchor="middle" dominantBaseline="central" className={`silk ${L.label === 'dark' ? 'dark' : ''}`} opacity={0.75} style={{ pointerEvents: 'none' }}>{c.conn ? plugName(c.conn.type) : c.value || `${c.h.toFixed(1)} mm tall`}</text>}
      </g>
    );
  };
  const plugArrow = (c: Comp, ghostly = false) => {
    const dd = c.conn!;
    const m: V2 = [c.x + Math.cos(rad(dd.angle)) * extentAlong(c, dd.angle), c.y + Math.sin(rad(dd.angle)) * extentAlong(c, dd.angle)];
    const pp = plugPoly(m, dd.angle, dd.plug.w, dd.plug.len);
    const tip: V2 = [m[0] + Math.cos(rad(dd.angle)) * 0.5, m[1] + Math.sin(rad(dd.angle)) * 0.5];
    const L = Math.min(dd.plug.len * 0.7, 16);
    const tail: V2 = [m[0] + Math.cos(rad(dd.angle)) * L, m[1] + Math.sin(rad(dd.angle)) * L];
    return (
      <g key={'p' + c.id} style={{ pointerEvents: 'none' }} opacity={ghostly ? 0.7 : 1}>
        <polygon points={pp.map(([x, y]) => `${x},${-y}`).join(' ')} fill="url(#hatch)" stroke="var(--copper)" strokeOpacity={0.7} strokeWidth={fs(1)} strokeDasharray={`${fs(4)} ${fs(3)}`} />
        <line x1={tail[0]} y1={-tail[1]} x2={tip[0]} y2={-tip[1]} stroke="var(--copper)" strokeWidth={fs(2)} markerEnd="url(#arr)" />
      </g>
    );
  };

  const toolBtn = (t: Tool, label: string, key: string, d: string) => (
    <button className={`tbtn ${tool === t ? 'on' : ''}`} onClick={() => { setTool(t); setItem(null); setDimA(null); setPhotoA(null); }} title={`${label} (${key})`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg><span>{label}</span>
    </button>
  );
  const dropPart = (e: React.DragEvent) => { const id = e.dataTransfer.getData(PART_DRAG); if (!id) return; e.preventDefault(); putPart(id, toWorld(e)); arm(null); };
  const bw = bb.x1 - bb.x0, bh = bb.y1 - bb.y0;

  return (
    <div ref={wrap} className={`editor board-editor ${tbx ? 'with-tbx' : ''}`} style={{ position: 'absolute', inset: 0 }} onContextMenu={(e) => e.preventDefault()} onPointerLeave={() => setHov(null)}>
      {tbx && <Toolbox armed={tool === 'place' ? item : null} onArm={arm} onClose={() => setTbx(false)} />}
      <svg ref={svg} className="bcanvas" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} onWheel={(e) => zoom(Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.0022), toWorld(e))} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={onUp}
        onDragOver={(e) => { if (e.dataTransfer.types.includes(PART_DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }} onDrop={dropPart}
        style={{ cursor: space || tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : tool === 'shape' ? shape.cursor : tool === 'place' ? 'copy' : 'crosshair' }}>
        <defs>
          <pattern id="g1" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="var(--grid-fine)" strokeWidth={fs(0.6)} /></pattern>
          <pattern id="g10" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill={px < 0.06 ? 'url(#g1)' : 'none'} /><path d="M10 0H0V10" fill="none" stroke="var(--grid)" strokeWidth={fs(1)} /></pattern>
          <pattern id="hatch" width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.4" stroke="var(--copper)" strokeOpacity="0.45" strokeWidth={0.3} /></pattern>
          <pattern id="hatch2" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.6" stroke="#ff8a5c" strokeOpacity="0.55" strokeWidth={0.35} /></pattern>
          <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e3e7ec" /><stop offset="0.55" stopColor="#b8bec6" /><stop offset="1" stopColor="#9aa1aa" /></linearGradient>
          <filter id="sh1" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx={0.25} dy={0.35} stdDeviation={0.3} floodColor="#000" floodOpacity={0.45} /></filter>
          <filter id="sh2" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx={0.7} dy={0.9} stdDeviation={0.7} floodColor="#000" floodOpacity={0.45} /></filter>
          <filter id="sh3" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx={1.5} dy={1.9} stdDeviation={1.3} floodColor="#000" floodOpacity={0.45} /></filter>
          <filter id="bshadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx={1.2} dy={2} stdDeviation={2.4} floodColor="#000" floodOpacity={0.5} /></filter>
          <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity={0.09} /><stop offset="0.5" stopColor="#fff" stopOpacity={0} /><stop offset="1" stopColor="#000" stopOpacity={0.14} /></linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={fs(2.5)} result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--copper)" /></marker>
          <marker id="darr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1L10,5L0,9z" fill="var(--coral)" /></marker>
          <marker id="garr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1L10,5L0,9z" fill="var(--accent)" /></marker>
          {[...new Set(lamps.map((q) => q.colour))].map((col) => (
            <radialGradient key={col} id={`lamp${col.slice(1)}`}><stop offset="0" stopColor="#fff" stopOpacity={0.95} /><stop offset="0.2" stopColor={col} stopOpacity={0.9} /><stop offset="0.55" stopColor={col} stopOpacity={0.28} /><stop offset="1" stopColor={col} stopOpacity={0} /></radialGradient>
          ))}
        </defs>
        <rect x={vb.x - vb.w * 2} y={vb.y - vb.h * 2} width={vb.w * 5} height={vb.h * 5} fill="url(#g10)" />
        {levels && <path d={path(b.outline)} fill="none" stroke="var(--accent)" strokeOpacity={0.18} strokeWidth={(H.gap + H.wall) * 2} strokeLinejoin="round" />}
        <path d={path(b.outline) + b.cutouts.map(path).join('')} fill={b.color ?? 'var(--mask)'} fillRule="evenodd" stroke={b.color ? `color-mix(in srgb, ${b.color} 55%, #fff)` : 'var(--mask-edge)'} strokeWidth={fs(1.5)} filter="url(#bshadow)" />
        <path d={path(b.outline) + b.cutouts.map(path).join('')} fill="url(#sheen)" fillRule="evenodd" style={{ pointerEvents: 'none' }} />
        {/* the board's name in its silkscreen, in a corner */}
        {b.name && bw / Math.max(px, 1e-6) > 180 && (() => {
          // past a hole in that corner, and above the row of vias along the edge
          const fz = Math.min(2.2, bw / 30), name = b.name.replace(/\s*\(.*$/, '').slice(0, 28), len = name.length * fz * 0.62;
          const boxes = b.comps.filter((c) => !c.hidden).map((c) => bbox(compRect(c, 0.6)));
          for (const top of [false, true]) {
            const y = top ? bb.y1 - 3.4 - fz : bb.y0 + 3.4, near = b.holes.filter((h) => h.x - bb.x0 < 12 && (top ? bb.y1 - h.y : h.y - bb.y0) < 12);
            const x = Math.max(bb.x0 + 2, ...near.map((h) => h.x + h.d / 2 + 2));
            if (x + len > bb.x1 - 2 || boxes.some((r) => r.x0 < x + len && r.x1 > x && r.y0 < y + fz && r.y1 > y - 0.3)) continue;
            return <text x={x} y={-y} fontSize={fz} className="netlbl" opacity={0.6} style={{ pointerEvents: 'none' }}>{name}</text>;
          }
          return null;
        })()}
        {b.photo && <image href={b.photo.url} x={b.photo.x} y={-(b.photo.y + b.photo.h)} width={b.photo.w} height={b.photo.h} preserveAspectRatio="none" opacity={b.photo.opacity ?? 0.7} style={{ pointerEvents: 'none' }} />}
        {/* the copper under the solder mask: tracks a shade lighter than the board, the bottom side's fainter, vias */}
        {showCu && <g style={{ pointerEvents: 'none', ...(b.color ? { '--trace': `color-mix(in srgb, ${b.color} 72%, #fff)`, '--trace-b': `color-mix(in srgb, ${b.color} 85%, #fff)`, '--mask': b.color } as React.CSSProperties : {}) }} className="cu">
          {copper.paths.map((t, i) => <path key={i} d={t.d} fill="none" className={t.bottom ? 'cu-b' : 'cu-t'} strokeWidth={t.w} strokeLinecap="round" strokeLinejoin="round" />)}
          {copper.vias.map((v, i) => <circle key={'v' + i} cx={v.x} cy={-v.y} r={v.d / 2 + 0.18} className="cu-via" strokeWidth={0.2} />)}
        </g>}
        {b.comps.filter((c) => !c.hidden && c.conn?.entry === 'edge').map((c) => plugArrow(c))}
        {b.comps.filter((c) => !c.hidden).map((c) => partSvg(c))}
        {showCu && lamps.length > 0 && <g style={{ pointerEvents: 'none' }}>
          {lamps.map((q, i) => {
            // a template board's LEDs are not parts: draw the little LED itself too
            const drawn = b.comps.some((c) => c.kind === 'led' && !c.hidden);
            return (
              <g key={i}>
                {!drawn && <g transform={`translate(${q.p[0]},${-q.p[1]})`}><rect x={-0.8} y={-0.4} width={1.6} height={0.8} fill="#e9e5dc" /><rect x={-0.8} y={-0.4} width={0.25} height={0.8} fill="#c9cdd2" /><rect x={0.55} y={-0.4} width={0.25} height={0.8} fill="#c9cdd2" /></g>}
                <circle cx={q.p[0]} cy={-q.p[1]} r={Math.max(1.6, q.r * 3.4)} fill={`url(#lamp${q.colour.slice(1)})`} className={`lamp lamp-${q.pattern}`} style={{ animationDelay: `${q.pattern === 'chase' ? q.i * 0.8 : -((q.i * 0.37 + q.p[0] * 0.013) % 1.7)}s` }}><title>{q.name ? `${q.name} light` : 'light'}</title></circle>
              </g>
            );
          })}
        </g>}
        {<g style={{ pointerEvents: 'none' }}>
          {plugLabels.map((q, i) => (
            <g key={i} transform={`translate(${q.x},${-q.y}) rotate(${-q.deg})`}>
              <text y={-q.fz * 0.1} fontSize={q.fz} textAnchor="middle" className="netlbl" opacity={0.92}>{q.ref}</text>
              {q.fz * 0.72 / Math.max(px, 1e-6) > 6 && <text y={q.fz * 0.95} fontSize={q.fz * 0.72} textAnchor="middle" className="netlbl" opacity={0.6}>{q.kind}</text>}
            </g>
          ))}
        </g>}
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
        {/* the Shape tool's corners, edges and drawing, and holes or parts left off the board */}
        {shape.layer}
        {/* the part about to be placed, following the pointer */}
        {ghost?.comp && <>{ghost.comp.conn?.entry === 'edge' && plugArrow(ghost.comp, true)}{partSvg(ghost.comp, true)}</>}
        {ghost?.hole && <circle cx={ghost.hole.x} cy={-ghost.hole.y} r={ghost.hole.d / 2 + 1.1} fill="none" stroke="var(--accent)" strokeWidth={fs(2)} strokeDasharray={`${fs(4)} ${fs(3)}`} style={{ pointerEvents: 'none' }} />}
        {/* while dragging: the lines it snapped to, and how far it is from the nearest edges */}
        {guides && (() => {
          const g = edgeGaps(b, guides.box);
          return (
            <g style={{ pointerEvents: 'none' }}>
              {guides.gx != null && <line x1={guides.gx} y1={-(bb.y1 + 8)} x2={guides.gx} y2={-(bb.y0 - 8)} stroke="var(--accent)" strokeWidth={fs(1)} strokeDasharray={`${fs(5)} ${fs(4)}`} />}
              {guides.gy != null && <line x1={bb.x0 - 8} y1={-guides.gy} x2={bb.x1 + 8} y2={-guides.gy} stroke="var(--accent)" strokeWidth={fs(1)} strokeDasharray={`${fs(5)} ${fs(4)}`} />}
              {[{ a: [g.x.from, g.x.at], c: [g.x.to, g.x.at], v: g.x.v }, { a: [g.y.at, g.y.from], c: [g.y.at, g.y.to], v: g.y.v }].map((q, i) => q.v > 0.05 && (
                <g key={i}>
                  <line x1={q.a[0]} y1={-q.a[1]} x2={q.c[0]} y2={-q.c[1]} stroke="var(--accent)" strokeWidth={fs(1.3)} markerStart="url(#garr)" markerEnd="url(#garr)" />
                  <g transform={`translate(${(q.a[0] + q.c[0]) / 2},${-(q.a[1] + q.c[1]) / 2})`}>
                    <rect x={-fs(24)} y={-fs(9)} width={fs(48)} height={fs(18)} rx={fs(9)} fill="var(--accent)" />
                    <text fontSize={fs(10.5)} textAnchor="middle" dominantBaseline="central" className="mono" fill="#fff">{q.v.toFixed(1)}</text>
                  </g>
                </g>
              ))}
            </g>
          );
        })()}
        {/* dimensions: from a feature to a feature, the value you measured; drag a label to put it somewhere else */}
        {dimsDraw.map((q) => {
          const on = editDim?.id === q.id || drag.current?.dim?.id === q.id, val = q.value.toFixed(2);
          const P = (u: number, v: number): V2 => (q.axis === 'x' ? [u, v] : [v, u]);
          const i = q.axis === 'x' ? 0 : 1, along = q.lab[i], lo = Math.min(q.LA[i], q.LB[i]), hi = Math.max(q.LA[i], q.LB[i]);
          const half = (q.axis === 'x' ? q.box.x1 - q.box.x0 : q.box.y1 - q.box.y0) / 2;
          // a label slid past the ends: the line carries on out to it
          const lead = along < lo ? [lo, along + half] : along > hi ? [hi, along - half] : null;
          return (
            <g key={q.id}>
              <line x1={q.A[0]} y1={-q.A[1]} x2={q.LA[0]} y2={-q.LA[1]} stroke="var(--coral)" strokeOpacity={0.6} strokeWidth={fs(1)} strokeDasharray={`${fs(3)} ${fs(2)}`} style={{ pointerEvents: 'none' }} />
              <line x1={q.B[0]} y1={-q.B[1]} x2={q.LB[0]} y2={-q.LB[1]} stroke="var(--coral)" strokeOpacity={0.6} strokeWidth={fs(1)} strokeDasharray={`${fs(3)} ${fs(2)}`} style={{ pointerEvents: 'none' }} />
              <line x1={q.LA[0]} y1={-q.LA[1]} x2={q.LB[0]} y2={-q.LB[1]} stroke="var(--coral)" strokeWidth={fs(1.4)} markerStart="url(#darr)" markerEnd="url(#darr)" style={{ pointerEvents: 'none' }} />
              {lead && (() => { const a = P(lead[0], q.line), c = P(lead[1], q.line); return <line x1={a[0]} y1={-a[1]} x2={c[0]} y2={-c[1]} stroke="var(--coral)" strokeWidth={fs(1.2)} style={{ pointerEvents: 'none' }} />; })()}
              <g className="dimlab" transform={`translate(${q.lab[0]},${-q.lab[1]})${q.axis === 'y' ? ' rotate(-90)' : ''}`} style={{ cursor: drag.current?.kind === 'dim' ? 'grabbing' : 'grab' }}
                onPointerDown={(e) => {
                  if (e.button !== 0 || tool !== 'select' && tool !== 'measure') return;
                  e.stopPropagation();
                  svg.current?.setPointerCapture?.(e.pointerId);
                  setDimLast(q.id);
                  const i2 = q.axis === 'x' ? 0 : 1;
                  drag.current = { kind: 'dim', start: toWorld(e), client: [e.clientX, e.clientY], vb0: vb, pre: store.get().project!, dim: { id: q.id, axis: q.axis, va: q.A[i2], vb: q.B[i2], line0: q.line, t0: q.t, anchor: q.anchor } };
                }}>
                <title>Drag to move it; click to type what you measured on the real board</title>
                <rect x={-val.length * 3.6 * px - 8 * px} y={-9 * px} width={val.length * 7.2 * px + 16 * px} height={18 * px} rx={9 * px} fill={on ? 'var(--coral)' : 'var(--surface)'} stroke="var(--coral)" strokeWidth={px} />
                <text x={0} y={0} fontSize={11 * px} textAnchor="middle" dominantBaseline="central" className="mono" fill={on ? '#fff' : 'var(--fg)'}>{val}</text>
              </g>
            </g>
          );
        })}
        {tool === 'measure' && (() => {
          const mark = (f: Feat | null, col: string) => {
            if (!f) return null;
            const q = featAt(b, f);
            if (!q) return null;
            if (q.x != null && q.y != null) return <circle cx={q.x} cy={-q.y} r={fs(6)} fill="none" stroke={col} strokeWidth={fs(2)} />;
            return q.x != null ? <line x1={q.x} y1={-(bb.y1 + 5)} x2={q.x} y2={-(bb.y0 - 5)} stroke={col} strokeWidth={fs(2)} strokeDasharray={`${fs(4)} ${fs(3)}`} /> : <line x1={bb.x0 - 5} y1={-q.y!} x2={bb.x1 + 5} y2={-q.y!} stroke={col} strokeWidth={fs(2)} strokeDasharray={`${fs(4)} ${fs(3)}`} />;
          };
          return <g style={{ pointerEvents: 'none' }}>{mark(dimA, 'var(--coral)')}{mark(snapF, 'var(--accent)')}</g>;
        })()}
        {(tool === 'photoScale' || tool === 'photoAlign') && photoA && cursor && (
          <g style={{ pointerEvents: 'none' }}>
            <circle cx={photoA[0]} cy={-photoA[1]} r={fs(5)} fill="none" stroke="var(--coral)" strokeWidth={fs(2)} />
            <line x1={photoA[0]} y1={-photoA[1]} x2={cursor[0]} y2={-cursor[1]} stroke="var(--coral)" strokeWidth={fs(1.5)} strokeDasharray={`${fs(5)} ${fs(3)}`} />
          </g>
        )}
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
        <g>
          {/* the board's size, on the sides with fewer edge plugs so it doesn't cover one: click either to type it */}
          {(() => {
            const { top, left } = sizeAt;
            return <>
              <DimLine a={[bb.x0, top ? bb.y1 : bb.y0]} b={[bb.x1, top ? bb.y1 : bb.y0]} off={top ? sizeLab.w.off : -sizeLab.w.off} at={sizeLab.w.at} px={px} label={`${bw.toFixed(1)}`} on={editDim?.id === '@w'} onEdit={() => setEditDim({ id: '@w', v: bw.toFixed(2) })} title="The board's width: click to type what your calipers read" />
              <DimLine a={[left ? bb.x0 : bb.x1, bb.y0]} b={[left ? bb.x0 : bb.x1, bb.y1]} off={left ? -sizeLab.h.off : sizeLab.h.off} at={sizeLab.h.at} px={px} label={`${bh.toFixed(1)}`} vertical on={editDim?.id === '@h'} onEdit={() => setEditDim({ id: '@h', v: bh.toFixed(2) })} title="The board's height: click to type what your calipers read" />
            </>;
          })()}
        </g>
      </svg>

      <div className="toolbar floating">
        {!tbx && <><button className="tbtn" onClick={() => setTbx(true)} title="Show the toolbox (T)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16v12H4zM9 7V5h6v2M4 12h16" /></svg><span>Toolbox</span></button><span className="tsep" /></>}
        {toolBtn('select', 'Select', 'V', 'M5 3l14 8-6 2-2 6z')}
        {toolBtn('pan', 'Pan', 'H', 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3')}
        {toolBtn('measure', 'Measure', 'M', 'M3 17h18M3 14v6M21 14v6M6 4h12v6H6zM9 4v3M12 4v4M15 4v3')}
        {!shape.isBox && toolBtn('shape', 'Shape', 'S', 'M5 18L7 6l11 3 1 9zM3.5 16.5h3v3h-3zM5.5 4.5h3v3h-3zM16.5 7.5h3v3h-3zM17.5 16.5h3v3h-3z')}
        <span className="tsep" />
        <div className="tpop">
          <button className={`tbtn ${photoMenu || tool.startsWith('photo') ? 'on' : ''}`} onClick={() => setPhotoMenu((x) => !x)} title="A photo of the real board under the drawing, to trace over">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h3l2-2h6l2 2h3v12H4zM12 10a3.5 3.5 0 100 7a3.5 3.5 0 100-7" /></svg><span>Photo</span>
          </button>
          {photoMenu && (
            <div className="tmenu floating">
              <button onClick={() => { setPhotoMenu(false); photoFile.current?.click(); }}>{b.photo ? 'Replace the photo…' : 'Put a photo under it…'}</button>
              {b.photo && <>
                <button onClick={() => { setPhotoMenu(false); setTool('photoScale'); setPhotoA(null); }}>Scale it: two points, then the distance</button>
                <button onClick={() => { setPhotoMenu(false); setTool('photoAlign'); setPhotoA(null); }}>Line it up: a point on it, then where it goes</button>
                <label className="trange">See-through<input type="range" min={0.15} max={1} step={0.05} value={b.photo.opacity ?? 0.7} onChange={(e) => editMod((m) => { if (m.board.photo) m.board.photo.opacity = +e.target.value; })} /></label>
                <button className="danger" onClick={() => { setPhotoMenu(false); editMod((m) => { delete m.board.photo; }); }}>Remove the photo</button>
              </>}
            </div>
          )}
          <input ref={photoFile} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadPhoto(f); e.target.value = ''; }} />
        </div>
        <button className={`tbtn ${showCu ? 'on' : ''}`} onClick={() => setShowCu((x) => !x)} aria-pressed={showCu}
          title={copper.real ? 'The copper tracks read from its files' : 'Copper tracks drawn in for the look (its files had none): they show roughly how a board like it is wired, nothing is made from them'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h6l4 4h8M3 17h4l4-4M17 17h4M5 7a2 2 0 100 .01M19 17a2 2 0 100 .01" /></svg><span>Tracks</span>
        </button>
        <span className="tsep" />
        <button className="tbtn" onClick={() => zoom(1.25)} title="Zoom out">−</button>
        <button className="tbtn mono" onClick={() => setVb(fitBox(bb))} title="Fit the board">Fit</button>
        <button className="tbtn" onClick={() => zoom(0.8)} title="Zoom in">+</button>
      </div>

      {shape.panel}

      {editDim && (() => {
        // the board's width or height (between its edges), or one of its dimensions
        const size = editDim.id === '@w' || editDim.id === '@h';
        const dm: Dim | undefined = size ? { id: editDim.id, a: { k: 'edge', at: editDim.id === '@w' ? 'x0' : 'y0' }, b: { k: 'edge', at: editDim.id === '@w' ? 'x1' : 'y1' }, axis: editDim.id === '@w' ? 'x' : 'y' } : (b.dims ?? []).find((x) => x.id === editDim.id);
        if (!dm) return null;
        const apply = () => {
          const v = parseFloat(editDim.v.replace(',', '.'));
          if (!(v > 0)) { toast('Type a length in mm.'); return; }
          let ok = false;
          editMod((m) => { const dd = size ? dm : (m.board.dims ?? []).find((x) => x.id === dm.id); if (dd) ok = setDim(m.board, dd, v, together, ends ? moveEnd : 'b'); });
          if (!ok) toast('Nothing to move there: put a dimension from an edge to a hole or a part.');
          setEditDim(null);
        };
        // where its label is on screen
        const { top, left } = sizeAt;
        const labW: V2 = size ? (editDim.id === '@w' ? [sizeLab.w.at, top ? bb.y1 + sizeLab.w.off : bb.y0 - sizeLab.w.off] : [left ? bb.x0 - sizeLab.h.off : bb.x1 + sizeLab.h.off, sizeLab.h.at]) : (dimsDraw.find((q) => q.id === dm.id)?.lab ?? [(bb.x0 + bb.x1) / 2, bb.y1]);
        const sr = svg.current?.getBoundingClientRect(), wr = wrap.current?.getBoundingClientRect();
        let sx = 200, sy = 200;
        if (sr && wr) {
          const k = Math.max(vb.w / sr.width, vb.h / sr.height), ox = vb.x + (vb.w - sr.width * k) / 2, oy = vb.y + (vb.h - sr.height * k) / 2;
          sx = (labW[0] - ox) / k + sr.left - wr.left; sy = (-labW[1] - oy) / k + sr.top - wr.top;
        }
        // beside the dimension line, on the side away from what it measures (the board's size: away from the board), so it
        // covers neither the line nor the holes and parts being measured
        const dd = size ? null : dimsDraw.find((q) => q.id === dm.id), o = dm.axis === 'x' ? 1 : 0;
        const far = labW[o] >= (dd ? (dd.A[o] + dd.B[o]) / 2 : dm.axis === 'x' ? (bb.y0 + bb.y1) / 2 : (bb.x0 + bb.x1) / 2) ? 1 : -1; // (world direction)
        const outward: 1 | -1 = dm.axis === 'x' ? (far > 0 ? -1 : 1) : far;
        const pos = dimPopupAt([sx, sy], dm.axis, outward, popSize, { w: wr?.width ?? 800, h: wr?.height ?? 600 });
        // which end moves: a choice where both could (two holes or parts; the board's own width or height)
        const ends = size || (dm.a.k !== 'edge' && dm.b.k !== 'edge');
        const endNames: [DimMove, string][] = size ? (editDim.id === '@w' ? [['b', 'Right side'], ['a', 'Left side'], ['both', 'Both sides']] : [['b', 'Top'], ['a', 'Bottom'], ['both', 'Both']]) : [['b', 'Second'], ['a', 'First'], ['both', 'Both, half each']];
        const mv = ends ? moveEnd : 'b';
        const what = size ? `the board gets that ${editDim.id === '@w' ? 'wide' : 'tall'}: ${mv === 'both' ? 'both sides move, half each (the middle stays)' : `its ${endNames.find((x) => x[0] === mv)![1].toLowerCase()} moves`}` : dm.b.k === 'edge' && dm.a.k === 'edge' ? 'the board’s size' : ends ? (mv === 'both' ? 'moves both, half each' : `moves the ${mv === 'a' ? 'first' : 'second'} one to it`) : `moves the ${dm.b.k !== 'edge' ? 'second' : 'first'} one to it`;
        return (
          <div ref={dimPop} className="dimedit floating" style={pos} onPointerDown={(e) => e.stopPropagation()}>
            <div className="dimedit-row">
              <input ref={dimIn} onFocus={(e) => e.target.select()} className="mono" value={editDim.v} onChange={(e) => setEditDim({ ...editDim, v: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') apply(); if (e.key === 'Escape') setEditDim(null); }} aria-label="Measured distance in mm" />
              <span>mm</span>
              <button className="btn small primary" onClick={apply}>Set</button>
              <button className="btn small ghost icon" onClick={() => setEditDim(null)} title="Esc" aria-label="Close">✕</button>
            </div>
            <small>{what}</small>
            {ends && <div className="seg" aria-label="Which end moves">{endNames.map(([k, n]) => <button key={k} className={mv === k ? 'on' : ''} aria-pressed={mv === k} onClick={() => setMoveEnd(k)}>{n}</button>)}</div>}
            {!size && (() => { const n = lineMates(b, dm, mv).length; return n > 0 && <label className="dimedit-mates"><input type="checkbox" checked={together} onChange={(e) => setTogether(e.target.checked)} /> and the {n} hole{n > 1 ? 's' : ''} in line with it (keeps the pattern square)</label>; })()}
            {!size && <div className="dimedit-row">
              {dm.off != null && <button className="btn small ghost" onClick={() => editMod((m) => { const dd = (m.board.dims ?? []).find((x) => x.id === dm.id); if (dd) { delete dd.off; delete dd.t; } })} title="Let it find its own place again">Put back</button>}
              {(b.dims ?? []).some((x) => x.off != null) && <button className="btn small ghost" onClick={() => editMod((m) => { for (const dd of m.board.dims ?? []) { delete dd.off; delete dd.t; } })} title="Every dimension back to its own place, none on another">Tidy all</button>}
              <button className="btn small ghost danger" onClick={() => { editMod((m) => { m.board.dims = (m.board.dims ?? []).filter((x) => x.id !== dm.id); }); setEditDim(null); }}>Delete</button>
            </div>}
          </div>
        );
      })()}

      {photoAsk && (() => {
        const apply = () => {
          const v = parseFloat(photoAsk.v.replace(',', '.'));
          if (v > 0) editMod((m) => { if (m.board.photo) m.board.photo = scalePhoto(m.board.photo, photoAsk.a, photoAsk.c, v); });
          setPhotoAsk(null); setTool('select');
        };
        return (
          <div className="selbar floating dimbar">
            <b>Really</b>
            <input autoFocus className="mono" value={photoAsk.v} placeholder={Math.hypot(photoAsk.c[0] - photoAsk.a[0], photoAsk.c[1] - photoAsk.a[1]).toFixed(1)} onChange={(e) => setPhotoAsk({ ...photoAsk, v: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') apply(); if (e.key === 'Escape') { setPhotoAsk(null); setTool('select'); } }} aria-label="Real distance in mm" />
            <span>mm apart (those two points on the photo)</span>
            <button className="btn small primary" onClick={apply}>Scale the photo</button>
            <button className="btn small ghost icon" onClick={() => { setPhotoAsk(null); setTool('select'); }} title="Esc">✕</button>
          </div>
        );
      })()}

      {hov && !drag.current && (() => {
        const c = hov.kind === 'comp' ? b.comps.find((x) => x.id === hov.id) : null, h = hov.kind === 'hole' ? b.holes.find((x) => x.id === hov.id) : null;
        if (!c && !h) return null;
        const dir = c?.conn?.entry === 'edge' ? ['right', 'top', 'left', 'bottom'][Math.round(((((c.conn.angle % 360) + 360) % 360)) / 90) % 4] : null;
        const r = wrap.current?.getBoundingClientRect();
        const cb = c ? itemsBox(b, new Set([c.id])) : null;
        return (
          <div className="hovcard floating" style={{ left: Math.min(hov.x + 16, (r?.width ?? 400) - 260), top: Math.min(hov.y + 16, (r?.height ?? 400) - 150) }}>
            {c && <>
              <b>{c.ref}{c.value ? ` · ${c.value}` : ''}</b>
              <span>{c.conn ? connById(c.conn.type).name : c.pkg}</span>
              <span className="mono">{c.w.toFixed(1)} × {c.l.toFixed(1)} mm, {c.h.toFixed(1)} tall · {c.side === 'top' ? 'on top' : 'underneath'}{c.tht ? ', leads through' : ''}</span>
              {cb && <span className="mono">{(cb.x0 - bb.x0).toFixed(1)} from the left, {(cb.y0 - bb.y0).toFixed(1)} from the bottom</span>}
              {dir && <span>its plug goes in from the {dir} edge</span>}
              {c.conn?.entry === 'top' && <span>plugged from above{c.role === 'debug' ? ': a debug header' : c.role === 'uart' ? ': a UART header' : ''}</span>}
              {c.h >= 5 && !c.conn && <span>tall: the holder keeps clear of it</span>}
            </>}
            {h && <>
              <b>Hole · Ø{h.d.toFixed(2)}</b>
              <span>{ROLE_INFO[h.role ?? 'mount'].name}{h.use === 'snap' ? ' · a snap pin' : h.use === 'none' ? ' · left free' : ''}</span>
              <span className="mono">{(h.x - bb.x0).toFixed(2)} from the left, {(h.y - bb.y0).toFixed(2)} from the bottom</span>
              {h.why && <span>{h.why}</span>}
            </>}
          </div>
        );
      })()}

      {nSel > 0 && !editDim && !photoAsk && tool !== 'shape' && (
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
      {tool === 'place' && armedItem && phone() && <div className="placebar floating">Tap the board to place the {armedItem.label} <button className="btn small" onClick={() => arm(null)}>Cancel</button></div>}
      <div className="hud floating mono">
        <span>{say(tool === 'place' ? `place ${armedItem?.label ?? 'it'}: click ${armedItem?.edge ? 'near the edge it goes on' : 'where it goes'}${touchy() ? '' : ' · Shift keeps placing · Esc stops'}`
          : tool === 'measure' ? (dimA ? 'now the second: a hole, a part (its centre or a side), a corner or an edge' : 'measure: click the first thing, an edge of the board, a corner of it, a hole, or a part (its centre or a side)')
          : tool === 'shape' ? `shape: ${shape.hint}`
          : tool === 'photoScale' ? (photoA ? 'now the second point on the photo' : 'scale the photo: click a point on it you know the distance from (a hole)')
          : tool === 'photoAlign' ? (photoA ? 'now where that point goes on the drawing' : 'line up the photo: click a point on it (a hole)')
          : touchy() ? 'drag to move · tap to select · pinch zooms' : 'drag to move (snaps; Alt: freely) · box-drag selects · Shift-click adds · right-drag pans · wheel zooms · V H M S T')}</span>
        {cursor && <span className="xy">{(cursor[0] - bb.x0).toFixed(1)}, {(cursor[1] - bb.y0).toFixed(1)}</span>}
      </div>
    </div>
  );
}

/** A dimension line `off` out from a to b, its label in the middle or at `at` along it (x, or y if vertical). */
function DimLine({ a, b, off, at, px, label, vertical, on, onEdit, title }: { a: V2; b: V2; off: number; at?: number; px: number; label: string; vertical?: boolean; on?: boolean; onEdit?: () => void; title?: string }) {
  const [ax, ay] = vertical ? [a[0] + off, a[1]] : [a[0], a[1] + off];
  const [bx, by] = vertical ? [b[0] + off, b[1]] : [b[0], b[1] + off];
  const mx = !vertical && at != null ? at : (ax + bx) / 2, my = vertical && at != null ? at : (ay + by) / 2;
  const t = 4 * px;
  return (
    <>
      <g style={{ pointerEvents: 'none' }}>
      <line x1={a[0]} y1={-a[1]} x2={ax} y2={-ay} stroke="var(--subtle)" strokeWidth={px} />
      <line x1={b[0]} y1={-b[1]} x2={bx} y2={-by} stroke="var(--subtle)" strokeWidth={px} />
      <line x1={ax} y1={-ay} x2={bx} y2={-by} stroke="var(--muted)" strokeWidth={px * 1.2} />
      <path d={vertical ? `M${ax - t},${-ay - t}L${ax + t},${-ay + t}M${bx - t},${-by - t}L${bx + t},${-by + t}` : `M${ax - t},${-ay + t}L${ax + t},${-ay - t}M${bx - t},${-by + t}L${bx + t},${-by - t}`} stroke="var(--muted)" strokeWidth={px * 1.2} />
      </g>
      <g className="dimlab" transform={`translate(${mx},${-my})${vertical ? ' rotate(-90)' : ''}`} style={{ cursor: onEdit ? 'pointer' : undefined }}
        onPointerDown={onEdit ? (e) => e.stopPropagation() : undefined} onClick={onEdit ? (e) => { e.stopPropagation(); onEdit(); } : undefined}>
        {title && <title>{title}</title>}
        <rect x={-label.length * 3.6 * px - 7 * px} y={-9 * px} width={label.length * 7.2 * px + 14 * px} height={18 * px} rx={9 * px} fill={on ? 'var(--accent)' : 'var(--surface)'} stroke={on ? 'var(--accent)' : 'var(--line-2)'} strokeWidth={px} />
        <text x={0} y={0} fontSize={11 * px} textAnchor="middle" dominantBaseline="central" className="mono" fill={on ? 'var(--accent-ink)' : 'var(--fg)'}>{label}</text>
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
  const m = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.3 + 16;
  return { x: bb.x0 - m, y: -bb.y1 - m, w: bb.x1 - bb.x0 + 2 * m, h: bb.y1 - bb.y0 + 2 * m };
}

// ---- actions on the selection (all undoable) ----
function each(s: SelItem[], fn: (it: { x: number; y: number }, kind: 'hole' | 'comp') => void) {
  editMod((m) => {
    for (const x of s) {
      const it = x.kind === 'hole' ? m.board.holes.find((h) => h.id === x.id) : m.board.comps.find((c) => c.id === x.id);
      if (it) fn(it, x.kind as 'hole' | 'comp');
    }
    boxFromEdits(m.board);
  });
}

export function removeSel(s: SelItem[]) {
  const ids = new Set(s.map((x) => x.id));
  editMod((m) => { m.board.holes = m.board.holes.filter((h) => !ids.has(h.id)); m.board.comps = m.board.comps.filter((c) => !ids.has(c.id)); boxFromEdits(m.board); });
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
