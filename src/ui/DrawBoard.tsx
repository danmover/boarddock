// Draw your own board: its shape and size (and its holes, if they are in a pattern), with a live picture as you type,
// and optionally a photo of it to trace over. It opens in the board editor, where its plugs, headers and parts come
// from the toolbox. The three plain shapes come first; More shapes has the ones odd boards often are (an L, a notch, a
// corner cut off, a polygon, a round board with a flat), and Your own opens straight in the editor's Shape tool. Or
// build a box of your own (a hub, a charger...): see DrawBox.
import { useMemo, useRef, useState } from 'react';
import type { Board, Hole, Loop, V2 } from '../model/types';
import { bbox, circleLoop, inside, nearestEdge, rectLoop, roundedRectLoop, uid } from '../geom/poly';
import { circlePts, combine, cornerCut, cornerHoles, polygonLoop } from '../geom/shape';
import { fitPhoto } from '../model/editorgeo';
import { store, toast } from '../state';
import { Num, Seg, Text } from './controls';
import { Icon, I } from './icons';
import { DrawBox } from './BoxEditor';
import { openShapeTool } from './ShapeTool';

type Shape = 'rect' | 'round' | 'circle' | 'L' | 'notch' | 'corner' | 'poly' | 'flat' | 'custom';
type Holes = 'none' | 'corners' | 'spacing';
type Side = 'top' | 'bottom' | 'left' | 'right';
export interface DrawOpts {
  name: string; shape: Shape; w: number; h: number; r: number; t: number; holes: Holes; inset: number; d: number; sx: number; sy: number;
  cw?: number; ch?: number; // L: the corner taken out (top right), across and down
  nw?: number; nd?: number; side?: Side; // notch: its width and depth, and which edge (in the middle of it)
  c?: number; one?: boolean; // corner cut: how far along each edge, one corner (top right) or all four
  n?: number; // polygon: sides (w: across its corners)
  f?: number; // round with a flat: how much the flat takes off the bottom (w: diameter)
}

const translate = (l: Loop, dx: number, dy: number): Loop => l.map(([x, y]) => [x + dx, y + dy] as V2);
/** With its bottom-left corner at 0, 0, as every drawn board is. */
const toOrigin = (l: Loop): Loop => { const b = bbox(l); return translate(l, -b.x0, -b.y0); };

/** The outline the form describes, or why it cannot be made. */
export function drawnOutline(o: DrawOpts): { outline: Loop } | { error: string } {
  const { w, h } = o;
  switch (o.shape) {
    case 'circle': return { outline: circleLoop(w / 2, w / 2, w / 2, 96) };
    case 'round': return { outline: translate(roundedRectLoop(w, h, Math.max(0.01, o.r), 8), w / 2, h / 2) };
    case 'L': {
      const cw = o.cw ?? w / 2, ch = o.ch ?? h / 2;
      if (!(cw > 0 && cw < w && ch > 0 && ch < h)) return { error: 'The corner taken out has to be smaller than the board both ways.' };
      return { outline: [[0, 0], [w, 0], [w, h - ch], [w - cw, h - ch], [w - cw, h], [0, h]] };
    }
    case 'notch': {
      const nw = o.nw ?? 10, nd = o.nd ?? 4, side = o.side ?? 'top', along = side === 'top' || side === 'bottom' ? w : h, across = side === 'top' || side === 'bottom' ? h : w;
      if (!(nw > 0 && nw < along && nd > 0 && nd < across)) return { error: 'The notch has to fit inside the edge it is on, and be less deep than the board.' };
      const m = along / 2, cut = side === 'top' ? rectLoop(m - nw / 2, h - nd, m + nw / 2, h + 1) : side === 'bottom' ? rectLoop(m - nw / 2, -1, m + nw / 2, nd) : side === 'left' ? rectLoop(-1, m - nw / 2, nd, m + nw / 2) : rectLoop(w - nd, m - nw / 2, w + 1, m + nw / 2);
      const r = combine(rectLoop(0, 0, w, h), [], cut, 'cut');
      return 'error' in r ? r : { outline: r.outline };
    }
    case 'corner': {
      const c = o.c ?? 5;
      if (!(c > 0) || c >= Math.min(w, h) / (o.one ? 1 : 2)) return { error: 'That corner cut is too big for the board.' };
      return { outline: cornerCut(rectLoop(0, 0, w, h), o.one ? [2] : [0, 1, 2, 3], 'cut', c).loop };
    }
    case 'poly': {
      const n = Math.round(o.n ?? 6);
      if (!(n >= 3 && n <= 16)) return { error: 'A polygon has 3 to 16 sides.' };
      return { outline: toOrigin(polygonLoop(n, w / 2)) };
    }
    case 'flat': {
      const f = o.f ?? 5;
      if (!(f > 0 && f < w * 0.75)) return { error: 'The flat has to take off less than three quarters of the board.' };
      const r = combine(circlePts([w / 2, w / 2], w / 2), [], rectLoop(-1, -1, w + 1, f), 'cut');
      return 'error' in r ? r : { outline: toOrigin(r.outline) };
    }
    default: return { outline: rectLoop(0, 0, w, h) };
  }
}

/** Whether a hole sits on the board, clear of its edge. */
const holeFits = (outline: Loop, q: V2, d: number) => inside(q, outline) && nearestEdge(q, outline).d >= d / 2 + 0.3;

/** The board as the form describes it. */
export function drawnBoard(o: DrawOpts): Board {
  const r = drawnOutline(o), outline = 'outline' in r ? r.outline : rectLoop(0, 0, o.w, o.h);
  const bb = bbox(outline), W = bb.x1 - bb.x0, H = bb.y1 - bb.y0;
  const holes: Hole[] = [];
  const hole = (x: number, y: number) => holes.push({ id: uid('h'), x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, d: o.d, plated: true, use: 'auto', role: 'mount', why: 'drawn' });
  if (o.holes === 'corners') {
    let at: V2[];
    if (o.shape === 'circle' || o.shape === 'flat') {
      const rr = o.w / 2 - o.inset, cy = o.shape === 'flat' ? o.w / 2 - (o.f ?? 5) : o.w / 2;
      at = [0, 1, 2, 3].map((k) => { const a = Math.PI / 4 + (k * Math.PI) / 2; return [o.w / 2 + rr * Math.cos(a), cy + rr * Math.sin(a)] as V2; });
    } else if (o.shape === 'L' || o.shape === 'poly') at = cornerHoles(outline, o.inset, o.d);
    else {
      // a rectangle's corners; a cut corner pushes its hole in along the diagonal, as far in from the cut as the edges
      const s = o.shape === 'corner' ? Math.max(o.inset, (o.inset * Math.SQRT2 + (o.c ?? 5)) / 2) : o.inset;
      const cut = (k: number) => o.shape === 'corner' && (!o.one || k === 3);
      at = ([[0, 0], [1, 0], [0, 1], [1, 1]] as V2[]).map(([u, v], k) => { const e = cut(k) ? s : o.inset; return [u ? W - e : e, v ? H - e : e] as V2; });
    }
    for (const q of at) if (holeFits(outline, q, o.d)) hole(q[0], q[1]);
  } else if (o.holes === 'spacing') for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) hole(bb.x0 + W / 2 + (x * o.sx) / 2, bb.y0 + H / 2 + (y * o.sy) / 2);
  return { name: o.name.trim() || 'My board', outline, cutouts: [], thickness: o.t, holes, comps: [], source: 'drawn', notes: [] };
}

const SHAPES: [Shape, string, string][] = [['rect', 'Rectangle', 'M4 6h16v12H4z'], ['round', 'Rounded', 'M8 6h8a4 4 0 014 4v4a4 4 0 01-4 4H8a4 4 0 01-4-4v-4a4 4 0 014-4z'], ['circle', 'Round', 'M12 4a8 8 0 100 16a8 8 0 100-16']];
const MORE: [Shape, string, string][] = [
  ['L', 'L-shaped', 'M4 5h8v7h8v7H4z'],
  ['notch', 'Notch', 'M4 6h6v4h4V6h6v12H4z'],
  ['corner', 'Corner cut', 'M4 6h12l4 4v8H4z'],
  ['poly', 'Polygon', 'M8 4.5h8l4 7.5-4 7.5H8l-4-7.5z'],
  ['flat', 'Round, a flat', 'M6.5 17.5A8 8 0 1117.5 17.5z'],
  ['custom', 'Your own', 'M4 18l3-12 7 4 6-5-2 13z'],
];

/** Draw your own: a board (its shape, size and holes), or a box (a hub, a charger, a supply, a probe, an adapter) built from scratch. */
export function DrawBoard({ put }: { put: (b: Board) => void }) {
  const [what, setWhat] = useState<'board' | 'box'>('board');
  return (
    <>
      <div className="db-what"><Seg value={what} options={[['board', 'A board'], ['box', 'A box (hub, charger…)']]} onChange={setWhat} /></div>
      {what === 'box' ? <DrawBox put={put} /> : <DrawPcb put={put} />}
    </>
  );
}

function DrawPcb({ put }: { put: (b: Board) => void }) {
  const [name, setName] = useState('');
  const [shape, setShape] = useState<Shape>('rect');
  const [more, setMore] = useState(false);
  const [w, setW] = useState(60), [h, setH] = useState(40), [r, setR] = useState(3), [t, setT] = useState(1.6);
  const [cw, setCw] = useState(25), [ch, setCh] = useState(18);
  const [nw, setNw] = useState(12), [nd, setNd] = useState(5), [side, setSide] = useState<Side>('top');
  const [c, setC] = useState(6), [one, setOne] = useState(true);
  const [n, setN] = useState(6), [f, setF] = useState(8);
  const [holes, setHoles] = useState<Holes>('corners');
  const [inset, setInset] = useState(3.5), [d, setD] = useState(3.2), [sx, setSx] = useState(53), [sy, setSy] = useState(33);
  const [photo, setPhoto] = useState<{ url: string; w: number; h: number; name: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const opts: DrawOpts = { name, shape, w, h, r, t, holes, inset, d, sx, sy, cw, ch, nw, nd, side, c, one, n, f };
  const made = useMemo(() => drawnOutline(opts), [shape, w, h, cw, ch, nw, nd, side, c, one, n, f, r]);
  const b = useMemo(() => drawnBoard(opts), [name, shape, w, h, r, t, holes, inset, d, sx, sy, cw, ch, nw, nd, side, c, one, n, f]);
  const bb = bbox(b.outline), W = bb.x1 - bb.x0, H = bb.y1 - bb.y0;
  const round = shape === 'circle' || shape === 'poly' || shape === 'flat'; // sized by one number
  const bad = 'error' in made ? made.error
    : holes === 'spacing' && (sx + d > W || sy + d > H || b.holes.some((q) => !holeFits(b.outline, [q.x, q.y], d))) ? `Holes ${sx} × ${sy} mm apart don't fit on this board.`
    : holes === 'corners' && shape !== 'custom' && !b.holes.length ? 'No room for holes in its corners: make them closer to the edges, or smaller.'
    : holes === 'corners' && (shape === 'rect' || shape === 'round') && 2 * inset + d > Math.min(W, H) ? 'The holes would overlap: make them closer to the edges.' : null;
  const pickPhoto = (fl: File) => {
    const img = new Image(), url = URL.createObjectURL(fl);
    img.onload = () => {
      const k = Math.min(1, 1400 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      setPhoto({ url: cv.toDataURL('image/jpeg', 0.82), w: cv.width, h: cv.height, name: fl.name });
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('That file is not a picture this browser can read.'); };
    img.src = url;
  };
  const create = () => {
    const nb = structuredClone(b);
    if (photo) nb.photo = fitPhoto(nb, photo.url, photo.w, photo.h);
    put(nb);
    store.set({ step: 'board', view: 'editor' });
    if (shape === 'custom') {
      openShapeTool('line', 'new');
      toast(`${nb.name} is in the editor with the Shape tool open. Click its corners one by one (or type each edge's length and angle), then click the first one to close it. Or pick Edit and drag the corners of this rectangle.${photo ? ' Scale the photo first, from Photo, to trace over it.' : ''}`);
    } else toast(`${nb.name} is in the editor. Add its plugs, headers and tall parts from the toolbox on the left: click one, then where it goes. Shape (S) changes its outline.${photo ? ' Scale the photo under it from Photo (two points and the distance between them).' : ''}`);
  };
  const tile = ([k, nm, dd]: [Shape, string, string]) => (
    <button key={k} role="radio" aria-checked={shape === k} className={shape === k ? 'on' : ''} onClick={() => setShape(k)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d={dd} /></svg><span>{nm}</span>
    </button>
  );
  const isMore = MORE.some(([k]) => k === shape);
  const thick = <Num label="Thickness" value={t} onChange={setT} min={0.4} max={3.2} step={0.1} />;
  // the preview: the outline, the holes, the sizes
  const pad = 10, vw = W + 2 * pad, vh = H + 2 * pad + 6;
  const P = (l: V2[]) => 'M' + l.map((q) => `${(q[0] - bb.x0 + pad).toFixed(2)},${(bb.y1 - q[1] + pad).toFixed(2)}`).join('L') + 'Z';
  return (
    <div className="drawboard">
      <div className="db-form">
        <div className="db-shapes" role="radiogroup" aria-label="Shape">
          {SHAPES.map(tile)}
        </div>
        <button className={`db-more ${more || isMore ? 'open' : ''}`} onClick={() => setMore((x) => !x)} aria-expanded={more || isMore}>More shapes <span aria-hidden>{more || isMore ? '▴' : '▾'}</span></button>
        {(more || isMore) && <div className="db-shapes more" role="radiogroup" aria-label="More shapes">{MORE.map(tile)}</div>}
        <Text label="Name" value={name} placeholder="My board" onChange={setName} />
        <div className="row3" style={{ marginTop: 8 }}>
          {shape === 'poly' ? <Num label="Sides" value={n} onChange={(v) => setN(Math.round(v))} step={1} min={3} max={16} unit="" /> : null}
          <Num label={shape === 'poly' ? 'Across corners' : round ? 'Diameter' : shape === 'custom' ? 'Width, roughly' : 'Width'} value={w} onChange={setW} step={0.5} min={5} />
          {!round && <Num label={shape === 'custom' ? 'Height, roughly' : 'Height'} value={h} onChange={setH} step={0.5} min={5} />}
          {shape === 'round' && <Num label="Corners" value={r} onChange={setR} min={0} step={0.5} hint="Their radius" />}
          {shape === 'flat' && <Num label="Flat cuts off" value={f} onChange={setF} min={0.5} step={0.5} hint="How much the flat takes off the bottom of the circle" />}
          {shape !== 'round' && shape !== 'poly' && thick}
        </div>
        {(shape === 'round' || shape === 'poly') && <div className="row3" style={{ marginTop: 8 }}>{thick}</div>}
        {shape === 'L' && <div className="row" style={{ marginTop: 8 }}>
          <Num label="Corner out, across" value={cw} onChange={setCw} step={0.5} min={0.5} hint="How wide the piece taken out of the top right corner is" />
          <Num label="Corner out, down" value={ch} onChange={setCh} step={0.5} min={0.5} hint="How far down the piece taken out of the top right corner goes" />
        </div>}
        {shape === 'notch' && <>
          <div className="field" style={{ marginTop: 8 }}><span>Notch in the middle of the</span></div>
          <Seg value={side} options={[['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']]} onChange={setSide} />
          <div className="row" style={{ marginTop: 6 }}><Num label="Notch width" value={nw} onChange={setNw} step={0.5} min={0.5} /><Num label="Notch depth" value={nd} onChange={setNd} step={0.5} min={0.5} /></div>
        </>}
        {shape === 'corner' && <>
          <div className="row" style={{ marginTop: 8 }}>
            <Num label="Cut" value={c} onChange={setC} step={0.5} min={0.5} hint="How far along each edge the cut starts from the corner" />
            <label className="field"><span>Which corners</span><Seg value={one ? 'one' : 'all'} options={[['one', 'Top right'], ['all', 'All four']]} onChange={(v) => setOne(v === 'one')} /></label>
          </div>
        </>}
        {shape === 'custom' && <p className="hint" style={{ margin: '6px 0 0' }}>It opens in the editor's Shape tool: click its corners one by one, or type each edge's length and angle as you go, and click the first corner to close it. Arcs, rounded corners and cut-outs are there too.</p>}
        {shape !== 'custom' && <>
          <div className="field" style={{ marginTop: 10 }}><span>Holes</span></div>
          <Seg value={holes} options={[['corners', 'At the corners'], ['spacing', 'By spacing'], ['none', 'None']]} onChange={(v) => {
            if (v === 'spacing' && (sx >= W - 2 || sy >= H - 2)) { setSx(Math.max(1, Math.round(W - 2 * inset))); setSy(Math.max(1, Math.round(H - 2 * inset))); }
            setHoles(v);
          }} />
          {holes === 'corners' && <div className="row" style={{ marginTop: 6 }}><Num label="In from each edge" value={inset} onChange={setInset} step={0.5} /><Num label="Hole Ø" value={d} min={1} onChange={setD} step={0.1} /></div>}
          {holes === 'spacing' && <div className="row3" style={{ marginTop: 6 }}><Num label="Apart across" value={sx} min={1} onChange={setSx} step={0.5} /><Num label="Apart up" value={sy} min={1} onChange={setSy} step={0.5} /><Num label="Hole Ø" value={d} min={1} onChange={setD} step={0.1} /></div>}
          {holes === 'spacing' && !bad && <p className="hint" style={{ margin: '4px 0 0' }}>Many boards give their hole spacing (a Pi: 58 across × 49 up). Centred on the board; move any of them after.</p>}
          {holes === 'none' && <p className="hint" style={{ margin: '4px 0 0' }}>No holes: the holder grips it by its edges with snap fingers.</p>}
        </>}
        {bad && <div className="err" style={{ marginTop: 6 }}>{bad}</div>}
        <div className="db-photo">
          <button className="btn small ghost" onClick={() => file.current?.click()}><Icon d={I.camera} /> {photo ? 'Another photo' : 'A photo of it to trace over (optional)'}</button>
          {photo && <><span className="mono">{photo.name.slice(0, 24)}</span><button className="btn small ghost icon" onClick={() => setPhoto(null)} title="No photo">×</button></>}
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const fl = e.target.files?.[0]; if (fl) pickPhoto(fl); e.target.value = ''; }} />
        </div>
        <button className="btn primary db-go" disabled={!!bad} onClick={create}><Icon d={I.pencil} /> {shape === 'custom' ? 'Create and draw its outline' : 'Create and open in the editor'}</button>
        <p className="hint" style={{ margin: '6px 0 0' }}>Its plugs, headers and tall parts go on in the editor, from the toolbox with a picture of each; Measure there puts in what your calipers read, and Shape changes its outline.</p>
      </div>
      <svg className="db-preview" viewBox={`0 0 ${vw} ${vh}`} aria-label="Preview">
        {photo && <image href={photo.url} x={pad} y={pad} width={W} height={H} preserveAspectRatio="xMidYMid meet" opacity={0.55} />}
        <path d={P(b.outline)} className="db-pcb" fillOpacity={photo ? 0.35 : 1} strokeDasharray={shape === 'custom' ? '1.5 1' : undefined} />
        {b.holes.map((q) => <g key={q.id}><circle cx={q.x - bb.x0 + pad} cy={bb.y1 - q.y + pad} r={q.d / 2 + 1.1} className="db-ring" /><circle cx={q.x - bb.x0 + pad} cy={bb.y1 - q.y + pad} r={q.d / 2} className="db-hole" /></g>)}
        <text x={pad + W / 2} y={H + pad + 7} className="db-dim" textAnchor="middle">{+W.toFixed(1)} mm</text>
        {shape !== 'circle' && <text x={pad - 3} y={pad + H / 2} className="db-dim" textAnchor="middle" transform={`rotate(-90 ${pad - 3} ${pad + H / 2})`}>{+H.toFixed(1)} mm</text>}
      </svg>
    </div>
  );
}
