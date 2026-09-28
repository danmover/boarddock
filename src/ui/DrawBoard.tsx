// Draw your own board: its shape and size (and its holes, if they are in a pattern), with a live picture as you type,
// and optionally a photo of it to trace over. It opens in the board editor, where its plugs, headers and parts come
// from the toolbox. Or build a box of your own (a hub, a charger...): see DrawBox.
import { useMemo, useRef, useState } from 'react';
import type { Board, Hole, V2 } from '../model/types';
import { circleLoop, roundedRectLoop, uid } from '../geom/poly';
import { fitPhoto } from '../model/editorgeo';
import { store, toast } from '../state';
import { Num, Seg, Text } from './controls';
import { Icon, I } from './icons';
import { DrawBox } from './BoxEditor';

type Shape = 'rect' | 'round' | 'circle';
type Holes = 'none' | 'corners' | 'spacing';

/** The board as the form describes it. */
export function drawnBoard(o: { name: string; shape: Shape; w: number; h: number; r: number; t: number; holes: Holes; inset: number; d: number; sx: number; sy: number }): Board {
  const H = o.shape === 'circle' ? o.w : o.h;
  const outline: V2[] = o.shape === 'circle' ? circleLoop(o.w / 2, o.w / 2, o.w / 2, 96) : roundedRectLoop(o.w, o.h, o.shape === 'round' ? Math.max(0.01, o.r) : 0.01, 8).map(([x, y]) => [x + o.w / 2, y + o.h / 2] as V2);
  const holes: Hole[] = [];
  const hole = (x: number, y: number) => holes.push({ id: uid('h'), x, y, d: o.d, plated: true, use: 'auto', role: 'mount', why: 'drawn' });
  if (o.holes === 'corners') {
    if (o.shape === 'circle') for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + (k * Math.PI) / 2, rr = o.w / 2 - o.inset; hole(o.w / 2 + rr * Math.cos(a), o.w / 2 + rr * Math.sin(a)); }
    else for (const [x, y] of [[o.inset, o.inset], [o.w - o.inset, o.inset], [o.inset, o.h - o.inset], [o.w - o.inset, o.h - o.inset]]) hole(x, y);
  } else if (o.holes === 'spacing') for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) hole(o.w / 2 + (x * o.sx) / 2, H / 2 + (y * o.sy) / 2);
  return { name: o.name.trim() || 'My board', outline, cutouts: [], thickness: o.t, holes, comps: [], source: 'drawn', notes: [] };
}

const SHAPES: [Shape, string, string][] = [['rect', 'Rectangle', 'M4 6h16v12H4z'], ['round', 'Rounded', 'M8 6h8a4 4 0 014 4v4a4 4 0 01-4 4H8a4 4 0 01-4-4v-4a4 4 0 014-4z'], ['circle', 'Round', 'M12 4a8 8 0 100 16a8 8 0 100-16']];

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
  const [w, setW] = useState(60), [h, setH] = useState(40), [r, setR] = useState(3), [t, setT] = useState(1.6);
  const [holes, setHoles] = useState<Holes>('corners');
  const [inset, setInset] = useState(3.5), [d, setD] = useState(3.2), [sx, setSx] = useState(53), [sy, setSy] = useState(33);
  const [photo, setPhoto] = useState<{ url: string; w: number; h: number; name: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const H = shape === 'circle' ? w : h;
  const bad = holes === 'spacing' && (sx + d > w || sy + d > H) ? `Holes ${sx} × ${sy} mm apart don't fit on a ${w} × ${H} mm board.` : holes === 'corners' && 2 * inset + d > Math.min(w, H) ? 'The holes would overlap: make them closer to the edges.' : null;
  const b = useMemo(() => drawnBoard({ name, shape, w, h, r, t, holes, inset, d, sx, sy }), [name, shape, w, h, r, t, holes, inset, d, sx, sy]);
  const pickPhoto = (f: File) => {
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const k = Math.min(1, 1400 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      setPhoto({ url: cv.toDataURL('image/jpeg', 0.82), w: cv.width, h: cv.height, name: f.name });
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('That file is not a picture this browser can read.'); };
    img.src = url;
  };
  const create = () => {
    const nb = structuredClone(b);
    if (photo) nb.photo = fitPhoto(nb, photo.url, photo.w, photo.h);
    put(nb);
    store.set({ step: 'board', view: 'editor' });
    toast(`${nb.name} is in the editor. Add its plugs, headers and tall parts from the toolbox on the left: click one, then where it goes.${photo ? ' Scale the photo under it from Photo (two points and the distance between them).' : ''}`);
  };
  // the preview: the outline, the holes, the sizes
  const pad = 10, vw = w + 2 * pad, vh = H + 2 * pad + 6;
  const P = (l: V2[]) => 'M' + l.map((q) => `${(q[0] + pad).toFixed(2)},${(H - q[1] + pad).toFixed(2)}`).join('L') + 'Z';
  return (
    <div className="drawboard">
      <div className="db-form">
        <div className="db-shapes" role="radiogroup" aria-label="Shape">
          {SHAPES.map(([k, n, dd]) => (
            <button key={k} role="radio" aria-checked={shape === k} className={shape === k ? 'on' : ''} onClick={() => setShape(k)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d={dd} /></svg><span>{n}</span>
            </button>
          ))}
        </div>
        <Text label="Name" value={name} placeholder="My board" onChange={setName} />
        <div className="row3" style={{ marginTop: 8 }}>
          <Num label={shape === 'circle' ? 'Diameter' : 'Width'} value={w} onChange={setW} step={0.5} min={5} />
          {shape !== 'circle' ? <Num label="Height" value={h} onChange={setH} step={0.5} min={5} /> : <Num label="Thickness" value={t} onChange={setT} min={0.4} max={3.2} step={0.1} />}
          {shape === 'round' ? <Num label="Corners" value={r} onChange={setR} min={0} step={0.5} /> : shape !== 'circle' ? <Num label="Thickness" value={t} onChange={setT} min={0.4} max={3.2} step={0.1} /> : <span />}
        </div>
        {shape === 'round' && <div className="row3" style={{ marginTop: 8 }}><Num label="Thickness" value={t} onChange={setT} min={0.4} max={3.2} step={0.1} /></div>}
        <div className="field" style={{ marginTop: 10 }}><span>Holes</span></div>
        <Seg value={holes} options={[['corners', 'At the corners'], ['spacing', 'By spacing'], ['none', 'None']]} onChange={(v) => {
          if (v === 'spacing' && (sx >= w - 2 || sy >= H - 2)) { setSx(Math.max(1, w - 2 * inset)); setSy(Math.max(1, H - 2 * inset)); }
          setHoles(v);
        }} />
        {holes === 'corners' && <div className="row" style={{ marginTop: 6 }}><Num label="In from each edge" value={inset} onChange={setInset} step={0.5} /><Num label="Hole Ø" value={d} min={1} onChange={setD} step={0.1} /></div>}
        {holes === 'spacing' && <div className="row3" style={{ marginTop: 6 }}><Num label="Apart across" value={sx} min={1} onChange={setSx} step={0.5} /><Num label="Apart up" value={sy} min={1} onChange={setSy} step={0.5} /><Num label="Hole Ø" value={d} min={1} onChange={setD} step={0.1} /></div>}
        {holes === 'spacing' && !bad && <p className="hint" style={{ margin: '4px 0 0' }}>Many boards give their hole spacing (a Pi: 58 across × 49 up). Centred on the board; move any of them after.</p>}
        {holes === 'none' && <p className="hint" style={{ margin: '4px 0 0' }}>No holes: the holder grips it by its edges with snap fingers.</p>}
        {bad && <div className="err" style={{ marginTop: 6 }}>{bad}</div>}
        <div className="db-photo">
          <button className="btn small ghost" onClick={() => file.current?.click()}><Icon d={I.camera} /> {photo ? 'Another photo' : 'A photo of it to trace over (optional)'}</button>
          {photo && <><span className="mono">{photo.name.slice(0, 24)}</span><button className="btn small ghost icon" onClick={() => setPhoto(null)} title="No photo">×</button></>}
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pickPhoto(f); e.target.value = ''; }} />
        </div>
        <button className="btn primary db-go" disabled={!!bad} onClick={create}><Icon d={I.pencil} /> Create and open in the editor</button>
        <p className="hint" style={{ margin: '6px 0 0' }}>Its plugs, headers and tall parts go on in the editor, from the toolbox with a picture of each; Measure there puts in what your calipers read.</p>
      </div>
      <svg className="db-preview" viewBox={`0 0 ${vw} ${vh}`} aria-label="Preview">
        {photo && <image href={photo.url} x={pad} y={pad} width={w} height={H} preserveAspectRatio="xMidYMid meet" opacity={0.55} />}
        <path d={P(b.outline)} className="db-pcb" fillOpacity={photo ? 0.35 : 1} />
        {b.holes.map((q) => <g key={q.id}><circle cx={q.x + pad} cy={H - q.y + pad} r={q.d / 2 + 1.1} className="db-ring" /><circle cx={q.x + pad} cy={H - q.y + pad} r={q.d / 2} className="db-hole" /></g>)}
        <text x={pad + w / 2} y={H + pad + 7} className="db-dim" textAnchor="middle">{w} mm</text>
        {shape !== 'circle' && <text x={pad - 3} y={pad + H / 2} className="db-dim" textAnchor="middle" transform={`rotate(-90 ${pad - 3} ${pad + H / 2})`}>{h} mm</text>}
      </svg>
    </div>
  );
}
