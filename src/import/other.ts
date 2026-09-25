// IDF 3.0 (.emn/.emp), Eagle / Fusion Electronics (.brd XML) and DXF outline importers.
import type { Board, Comp, Hole, Loop, V2 } from '../model/types';
import { arcByAngle, arcCenter, bbox, chainLoops, outlineFromLoops, rad, uid } from '../geom/poly';
import { finishBoard } from './common';

// ---------------- IDF 3.0 ----------------
function idfTokens(line: string): string[] {
  return (line.match(/"[^"]*"|\S+/g) ?? []).map((t) => t.replace(/^"|"$/g, ''));
}

function idfSections(text: string): { name: string; head: string[]; lines: string[][] }[] {
  const out: { name: string; head: string[]; lines: string[][] }[] = [];
  let cur: { name: string; head: string[]; lines: string[][] } | null = null;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('.END_')) { cur = null; continue; }
    if (line.startsWith('.')) {
      const t = idfTokens(line);
      cur = { name: t[0].slice(1).toUpperCase(), head: t.slice(1), lines: [] };
      out.push(cur);
      continue;
    }
    cur?.lines.push(idfTokens(line));
  }
  return out;
}

function idfLoops(rows: string[][], k: number): { loops: Loop[]; label: number[] } {
  // rows: [label, x, y, angle]; consecutive points with the same label form a loop; angle != 0 means arc from previous point
  const loops: Loop[] = [], label: number[] = [];
  let cur: V2[] = [], curLabel = NaN, prev: V2 | null = null;
  const close = () => { if (cur.length > 2) { loops.push(cur); label.push(curLabel); } cur = []; prev = null; };
  for (const r of rows) {
    const lb = +r[0], p: V2 = [+r[1] * k, +r[2] * k], ang = +(r[3] ?? 0);
    if (lb !== curLabel) { close(); curLabel = lb; }
    if (!prev) { cur.push(p); prev = p; continue; }
    if (Math.abs(ang) >= 359.999) { cur = arcCenter(prev, p, 360); close(); continue; } // prev = centre
    if (ang) cur.push(...arcByAngle(prev, p, ang).slice(1));
    else cur.push(p);
    prev = p;
  }
  close();
  return { loops: loops.map((l) => (Math.hypot(l[0][0] - l[l.length - 1][0], l[0][1] - l[l.length - 1][1]) < 1e-6 ? l.slice(0, -1) : l)), label };
}

export function importIdf(emn: string, emp = '', fileName = 'board.emn'): Board {
  const secs = idfSections(emn);
  const header = secs.find((s) => s.name === 'HEADER');
  const units = header?.lines[1]?.[1]?.toUpperCase() ?? 'MM';
  const k = units === 'THOU' || units === 'MIL' ? 0.0254 : units === 'TNM' ? 1e-5 : 1;
  const name = header?.lines[1]?.[0] ?? fileName;
  const bo = secs.find((s) => s.name === 'BOARD_OUTLINE');
  if (!bo) throw new Error('IDF file has no .BOARD_OUTLINE');
  const thickness = +bo.lines[0][0] * k || 1.6;
  const { loops } = idfLoops(bo.lines.slice(1), k);
  const ol = outlineFromLoops(loops);
  if (!ol) throw new Error('IDF board outline is empty');
  const holes: Hole[] = [];
  const leads: { x: number; y: number }[] = [];
  for (const r of secs.find((s) => s.name === 'DRILLED_HOLES')?.lines ?? []) {
    const d = +r[0] * k, x = +r[1] * k, y = +r[2] * k, plated = (r[3] ?? '').toUpperCase() === 'PTH';
    const type = (r[5] ?? '').toUpperCase();
    if (type === 'MTG' || type === 'TOOL' || d >= 2.2 || (!plated && d >= 1.9)) holes.push({ id: uid('h'), x, y, d, plated, use: 'auto' });
    else if (plated) leads.push({ x, y });
  }
  // library outlines and heights
  const lib = new Map<string, { loop: Loop; h: number }>();
  const libK = (u: string) => (u.toUpperCase() === 'THOU' || u.toUpperCase() === 'MIL' ? 0.0254 : 1);
  for (const s of idfSections(emp)) {
    if (s.name !== 'ELECTRICAL' && s.name !== 'MECHANICAL') continue;
    const h0 = s.lines[0];
    const kk = libK(h0[2] ?? 'MM');
    const { loops: ll } = idfLoops(s.lines.slice(1), kk);
    lib.set(`${h0[0]}|${h0[1]}`, { loop: ll[0] ?? [], h: +(h0[3] ?? 0) * kk });
  }
  const comps: Comp[] = [];
  const pl = secs.find((s) => s.name === 'PLACEMENT')?.lines ?? [];
  for (let i = 0; i + 1 < pl.length; i += 2) {
    const [pkg, part, ref] = pl[i];
    const [x, y, , rot, side] = pl[i + 1];
    const bottom = (side ?? '').toUpperCase() === 'BOTTOM';
    const L = lib.get(`${pkg}|${part}`);
    let w = 0, l = 0, cx = 0, cy = 0, h = 0;
    if (L && L.loop.length) {
      const bb = bbox(L.loop);
      w = bb.x1 - bb.x0; l = bb.y1 - bb.y0; cx = (bb.x0 + bb.x1) / 2; cy = (bb.y0 + bb.y1) / 2; h = L.h;
      if (bottom) cx = -cx;
    }
    const a = rad(+rot || 0);
    const px = +x * k + cx * Math.cos(a) - cy * Math.sin(a), py = +y * k + cx * Math.sin(a) + cy * Math.cos(a);
    comps.push({ id: uid('c'), ref: ref ?? '?', pkg: `${pkg} ${part}`, side: bottom ? 'bottom' : 'top', x: px, y: py, rot: +rot || 0, w, l, h, kind: 'generic', tht: leads.some((p) => Math.hypot(p.x - px, p.y - py) < Math.max(w, l) / 2) });
  }
  const board: Board = { name, outline: ol.outline, cutouts: ol.cutouts, thickness, holes, comps, source: `IDF: ${fileName}`, notes: emp ? [] : ['No .emp library given: component sizes and heights are guessed from package names.'] };
  const done = finishBoard(board, { sizesKnown: !!emp, heightsKnown: !!emp });
  return done;
}

// ---------------- Eagle / Fusion 360 Electronics ----------------
function attrs(el: Element) {
  const n = (k: string) => parseFloat(el.getAttribute(k) ?? '0') || 0;
  return { n, s: (k: string) => el.getAttribute(k) ?? '' };
}

export function importEagle(xml: string, fileName = 'board.brd', parser?: (s: string) => Document): Board {
  const doc = parser ? parser(xml) : new DOMParser().parseFromString(xml, 'application/xml');
  const board = doc.querySelector('board');
  if (!board) throw new Error('Not an Eagle board (.brd XML) file');
  const paths: V2[][] = [];
  const holes: Hole[] = [];
  const wirePath = (el: Element, tf: (p: V2) => V2, flip = false): V2[] => {
    const a = attrs(el);
    const p0 = tf([a.n('x1'), a.n('y1')]), p1 = tf([a.n('x2'), a.n('y2')]);
    const curve = a.n('curve');
    return curve ? arcByAngle(p0, p1, flip ? -curve : curve) : [p0, p1]; // mirroring reverses arc direction
  };
  const ident = (p: V2) => p;
  const plain = board.querySelector('plain');
  for (const w of Array.from(plain?.querySelectorAll('wire') ?? [])) if (w.getAttribute('layer') === '20') paths.push(wirePath(w, ident));
  for (const c of Array.from(plain?.querySelectorAll('circle') ?? [])) {
    if (c.getAttribute('layer') !== '20') continue;
    const a = attrs(c);
    paths.push(arcCenter([a.n('x'), a.n('y')], [a.n('x') + a.n('radius'), a.n('y')], 360));
  }
  for (const h of Array.from(plain?.querySelectorAll('hole') ?? [])) {
    const a = attrs(h);
    holes.push({ id: uid('h'), x: a.n('x'), y: a.n('y'), d: a.n('drill'), plated: false, use: 'auto' });
  }
  // packages
  const pkgs = new Map<string, Element>();
  for (const lib of Array.from(board.querySelectorAll('libraries > library'))) {
    for (const p of Array.from(lib.querySelectorAll('packages > package'))) pkgs.set(`${lib.getAttribute('name')}|${p.getAttribute('name')}`, p);
  }
  const comps: Comp[] = [];
  for (const el of Array.from(board.querySelectorAll('elements > element'))) {
    const a = attrs(el);
    const rotS = a.s('rot') || 'R0';
    const mirror = rotS.includes('M');
    const ang = parseFloat(rotS.replace(/[^\d.-]/g, '')) || 0;
    const r = rad(ang), cr = Math.cos(r), sr = Math.sin(r);
    const ex = a.n('x'), ey = a.n('y');
    const tf = (p: V2): V2 => { const x = mirror ? -p[0] : p[0]; return [ex + x * cr - p[1] * sr, ey + x * sr + p[1] * cr]; };
    const pkg = pkgs.get(`${a.s('library')}|${a.s('package')}`);
    const body: V2[] = [], pads: V2[] = [];
    let tht = false;
    const isMount = /hole|mount|mtg|stand ?off/i.test(a.s('package'));
    if (pkg) {
      for (const w of Array.from(pkg.querySelectorAll('wire'))) {
        const L = w.getAttribute('layer');
        const aw = attrs(w);
        if (L === '20') paths.push(wirePath(w, tf, mirror)); // package cut-outs on the dimension layer
        if (L === '21' || L === '22' || L === '51' || L === '52' || L === '39' || L === '40') body.push([aw.n('x1'), aw.n('y1')], [aw.n('x2'), aw.n('y2')]);
      }
      for (const p of Array.from(pkg.querySelectorAll('pad'))) {
        const ap = attrs(p);
        pads.push([ap.n('x'), ap.n('y')]);
        const d = ap.n('drill');
        if (isMount && d >= 1.5) { const [x, y] = tf([ap.n('x'), ap.n('y')]); holes.push({ id: uid('h'), x, y, d, plated: true, use: 'auto' }); }
        else tht = true;
      }
      for (const s of Array.from(pkg.querySelectorAll('smd'))) {
        const as = attrs(s);
        pads.push([as.n('x') - as.n('dx') / 2, as.n('y') - as.n('dy') / 2], [as.n('x') + as.n('dx') / 2, as.n('y') + as.n('dy') / 2]);
      }
      for (const h of Array.from(pkg.querySelectorAll('hole'))) {
        const ah = attrs(h);
        const [x, y] = tf([ah.n('x'), ah.n('y')]);
        if (isMount || ah.n('drill') >= 2.2) holes.push({ id: uid('h'), x, y, d: ah.n('drill'), plated: false, use: 'auto' });
      }
    }
    if (isMount) continue;
    const src = body.length > 1 ? body : pads;
    if (src.length < 2) continue;
    const bb = bbox(src);
    const cl: V2 = [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2];
    const [cx, cy] = tf(cl);
    comps.push({
      id: uid('c'), ref: a.s('name'), pkg: a.s('package'), value: a.s('value'), side: mirror ? 'bottom' : 'top',
      x: cx, y: cy, rot: mirror ? -ang : ang, w: Math.max(0.3, bb.x1 - bb.x0), l: Math.max(0.3, bb.y1 - bb.y0), h: 0, kind: 'generic', tht,
    });
  }
  const loops = chainLoops(paths, 0.02);
  const ol = outlineFromLoops(loops);
  if (!ol) throw new Error('No closed board outline on the Dimension layer (20)');
  const thickness = 1.6; // Eagle stores the stack-up in the DRU, not the board; 1.6 mm assumed
  const out: Board = { name: fileName.replace(/\.brd$/i, ''), outline: ol.outline, cutouts: ol.cutouts, thickness, holes, comps, source: `Eagle/Fusion: ${fileName}`, notes: [] };
  return finishBoard(out, { sizesKnown: true });
}

// ---------------- DXF (outline only) ----------------
export function parseDxfOutline(text: string): { outline: Loop; cutouts: Loop[] } {
  const lines = text.replace(/\r/g, '').split('\n');
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  const paths: V2[][] = [];
  let scale = 1;
  // $INSUNITS: 1 = inch, 4 = mm
  const iu = pairs.findIndex(([c, v]) => c === 9 && v === '$INSUNITS');
  if (iu >= 0 && pairs[iu + 1]?.[1] === '1') scale = 25.4;
  let i = 0;
  const entityEnd = (j: number) => { let k = j + 1; while (k < pairs.length && pairs[k][0] !== 0) k++; return k; };
  while (i < pairs.length) {
    const [c, v] = pairs[i];
    if (c !== 0) { i++; continue; }
    const end = entityEnd(i);
    const g = (code: number) => pairs.slice(i + 1, end).filter((p) => p[0] === code).map((p) => parseFloat(p[1]));
    if (v === 'LINE') paths.push([[g(10)[0], g(20)[0]], [g(11)[0], g(21)[0]]]);
    else if (v === 'CIRCLE') paths.push(arcCenter([g(10)[0], g(20)[0]], [g(10)[0] + g(40)[0], g(20)[0]], 360));
    else if (v === 'ARC') {
      const cx = g(10)[0], cy = g(20)[0], r = g(40)[0], a0 = g(50)[0], a1 = g(51)[0];
      let sw = a1 - a0;
      if (sw <= 0) sw += 360;
      paths.push(arcCenter([cx, cy], [cx + r * Math.cos(rad(a0)), cy + r * Math.sin(rad(a0))], sw));
    } else if (v === 'LWPOLYLINE') {
      const xs = g(10), ys = g(20);
      const flags = g(70)[0] ?? 0;
      // bulges are attached to vertices in order; read them positionally
      const bul: number[] = [];
      let vi = -1;
      for (const [cc, vv] of pairs.slice(i + 1, end)) { if (cc === 10) { vi++; bul[vi] = 0; } if (cc === 42) bul[vi] = parseFloat(vv); }
      const pts: V2[] = [];
      const n = xs.length;
      for (let k = 0; k < n; k++) {
        const p: V2 = [xs[k], ys[k]];
        const q: V2 = [xs[(k + 1) % n], ys[(k + 1) % n]];
        if (!pts.length) pts.push(p);
        if (k === n - 1 && !(flags & 1)) break;
        const b = bul[k] ?? 0;
        if (b) pts.push(...arcByAngle(p, q, (4 * Math.atan(b) * 180) / Math.PI).slice(1));
        else pts.push(q);
      }
      paths.push(pts);
    }
    i = end;
  }
  const loops = chainLoops(paths.map((p) => p.map(([x, y]) => [x * scale, y * scale] as V2)), 0.02);
  const ol = outlineFromLoops(loops);
  if (!ol) throw new Error('No closed outline found in the DXF');
  return ol;
}

export function importDxf(text: string, fileName = 'outline.dxf'): Board {
  const ol = parseDxfOutline(text);
  const b: Board = { name: fileName.replace(/\.dxf$/i, ''), outline: ol.outline, cutouts: [], thickness: 1.6, holes: [], comps: [], source: `DXF: ${fileName}`, notes: ['DXF gives the outline only. Small round cut-outs were turned into holes; add connectors by hand.'] };
  // small circular inner loops are holes
  for (const c of ol.cutouts) {
    const bb = bbox(c);
    const d = bb.x1 - bb.x0;
    if (Math.abs(d - (bb.y1 - bb.y0)) < 0.05 && d < 8) b.holes.push({ id: uid('h'), x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2, d, plated: false, use: 'auto' });
    else b.cutouts.push(c);
  }
  return finishBoard(b, { sizesKnown: true });
}
