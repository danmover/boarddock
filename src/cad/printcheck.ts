// Printability, the way a slicer sees a part: cut it into 0.2 mm layers in its print pose and compare every layer
// with the one under it.
//  - island: a piece of a layer with nothing under it at all (it would print in mid-air: needs support). A fleck
//    narrower than one line, or a single layer under 0.5 mm², is only a speck: slicers leave it out.
//  - overhang: the part of a layer that reaches past the one below by more than a 45 degree slope allows. How far
//    it reaches is measured inside the layer (round a slot, never straight across air), from the edge of the wall
//    below. Held from roughly opposite sides it is a bridge (span = the whole opening), otherwise a one-sided
//    overhang, which droops.
//  - sloped roof: layers that each step out a little too far (a roof flatter than about 40 degrees), run after run
//  - thin: walls narrower than one 0.4 mm line; a slicer without thin-wall detection (Kiri:Moto as set up here)
//    leaves them out, OrcaSlicer and PrusaSlicer print them as single thin lines
//  - narrow gap: a slot narrower than 0.3 mm, which prints closed (bad for print-in-place parts)
//  - foot: the first layer against the biggest one; a tall part on a tiny foot gets knocked over
// Pure geometry on manifold's slices; no slicer involved.
import type { MeshData } from '../model/types';
import { K, type CS } from './kernel';

export const LAYER = 0.2;
const ALLOW = 0.25; // how far a layer may step out over the one below (a little past 45 degrees at 0.2 mm)
const LINE = 0.4; // narrowest wall a slicer prints as a full line
const GAP = 0.3; // narrowest slot that stays open

/** Where the verdict draws its lines (mm; physical sizes, from the wall below). */
export const LIMITS = {
  overhangWarn: 2, // one-sided overhang: a little droop past this
  overhangBad: 3, // ...and past this it needs support (or past overhangWarn over a big area)
  overhangBadArea: 20, // mm²
  bridgeWarn: 12, // bridges sag a little past this even with the part fan on
  bridgeBad: 25,
  slopeWarn: 3, // a roof flatter than ~40 degrees running this far out
  slopeBad: 10,
  footBad: 0.1, // first layer under this share of the biggest layer, on a part taller than 5 mm
};

export interface LayerIssue { z: number; area: number; reach?: number; span?: number; x?: number; y?: number }
export interface LayerReport {
  layers: number;
  islands: LayerIssue[]; // need support
  specks: LayerIssue[]; // islands narrower than a line or a single small layer: slicers leave them out
  cantilever: LayerIssue | null; // worst one-sided overhang (reach in mm, from the wall below)
  bridge: LayerIssue | null; // longest bridge (span in mm, the whole opening)
  slope: LayerIssue | null; // longest run of a roof flatter than the 45 degree rule allows (reach: how far it runs out)
  thin: { z0: number; z1: number; area: number; x: number; y: number } | null; // layers with walls thinner than a line
  gaps: LayerIssue | null; // narrowest-gap region that would print closed
  firstLayer: number; // mm² on the bed
  maxLayer: number; // mm², the biggest layer
  height: number;
}

const bounds = (m: MeshData) => {
  let z0 = Infinity, z1 = -Infinity;
  for (let i = 2; i < m.pos.length; i += 3) { z0 = Math.min(z0, m.pos[i]); z1 = Math.max(z1, m.pos[i]); }
  return [z0, z1];
};
const centre = (c: CS) => { const b = c.bounds(); return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2]; };
const box2 = (x0: number, y0: number, x1: number, y1: number): CS => K().CrossSection.square([x1 - x0, y1 - y0]).translate([x0, y0]) as CS;
const biggest = (c: CS): CS => (c.decompose() as CS[]).reduce((a, q) => (q.area() > a.area() ? q : a));

/**
 * How far an overhang u reaches from the supported part of its layer, growing the support inside the layer (so a
 * finger over a slot is measured along the finger, not across the slot), and the point it reaches last.
 */
export function reachInLayer(piece: CS, held: CS, u: CS): { reach: number; far: [number, number] } {
  const ub = u.bounds();
  let margin = 8;
  const win = (m: number) => piece.intersect(box2(ub.min[0] - m, ub.min[1] - m, ub.max[0] + m, ub.max[1] + m));
  let P = win(margin);
  let S = held.intersect(P);
  let d = 0, last = u;
  const pb = piece.bounds();
  const diag = Math.hypot(pb.max[0] - pb.min[0], pb.max[1] - pb.min[1]) + 1;
  let prevS = S, step = 0.25;
  // covered: what is left is thinner than 0.1 mm everywhere (slivers at round corners)
  const covered = (rest: CS) => rest.area() < 1e-3 || rest.offset(-0.05, 'Round').isEmpty();
  for (;;) {
    const rest = u.subtract(S);
    if (covered(rest) || d > diag) break;
    last = rest;
    // small steps near the wall (never jumping a slot), longer ones far out where only size matters
    step = d < 5 ? 0.25 : d < 20 ? 0.5 : 1.0;
    if (d + step > margin - 1) { margin *= 2; P = win(margin); }
    prevS = S;
    S = S.offset(step, 'Round').intersect(P).simplify(0.01); // (simplified: round joins on round joins multiply the points)
    d += step;
  }
  // refine the last step
  if (d > 0) {
    let lo = d - step, hi = d;
    for (let k = 0; k < 4; k++) { const m = (lo + hi) / 2; if (covered(u.subtract(prevS.offset(m - (d - step), 'Round').intersect(P)))) hi = m; else lo = m; }
    d = hi;
  }
  const f = centre(biggest(last));
  return { reach: d, far: [f[0], f[1]] };
}

/** Held from opposite sides: seen from the point reached last, contacts spread over more than 150 degrees. */
function heldAcross(touch: CS, far: [number, number], reach: number): boolean {
  const lim = 1.35 * reach + 0.5;
  const dirs: number[] = [];
  for (const loop of touch.toPolygons() as [number, number][][]) {
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i], q = loop[(i + 1) % loop.length];
      const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.3));
      for (let k = 0; k < n; k++) {
        const x = p[0] + ((q[0] - p[0]) * k) / n - far[0], y = p[1] + ((q[1] - p[1]) * k) / n - far[1];
        const r = Math.hypot(x, y);
        if (r <= lim && r > 1e-6) dirs.push(Math.atan2(y, x));
      }
    }
  }
  dirs.sort((a, b) => a - b);
  if (dirs.length < 2) return false;
  // the largest empty arc of directions: under 210 degrees means contacts spread over more than 150 (a strip held
  // along one side, round ends and all, spreads to about 140)
  let gap = dirs[0] + 2 * Math.PI - dirs[dirs.length - 1];
  for (let i = 1; i < dirs.length; i++) gap = Math.max(gap, dirs[i] - dirs[i - 1]);
  return gap < (7 * Math.PI) / 6;
}

/** Slice a part (print pose) and report what a slicer would struggle with. Measured from the part's own bottom. */
export function layerCheck(mesh: MeshData): LayerReport | null {
  const W = K() as any;
  let mf: any;
  try {
    mf = W.Manifold.ofMesh(new W.Mesh({ numProp: 3, vertProperties: new Float32Array(mesh.pos), triVerts: new Uint32Array(mesh.idx) }));
    if (mf.status && mf.status() !== 'NoError' && mf.status() !== 0) return null;
  } catch {
    return null;
  }
  const [z0, z1] = bounds(mesh);
  const out: LayerReport = { layers: 0, islands: [], specks: [], cantilever: null, bridge: null, slope: null, thin: null, gaps: null, firstLayer: 0, maxLayer: 0, height: z1 - z0 };
  let prev: CS | null = null;
  let runs: { u: CS; acc: number; n: number }[] = []; // overhang bands of the layer below, and how far their run has gone
  for (let z = z0 + LAYER / 2; z < z1; z += LAYER) {
    const cs: CS = mf.slice(z);
    const area = cs.area();
    if (area < 1e-4) { prev = null; runs = []; continue; }
    out.layers++;
    out.maxLayer = Math.max(out.maxLayer, area);
    if (out.layers === 1) out.firstLayer = area;
    const island = (piece: CS) => {
      const a = piece.area();
      const [x, y] = centre(piece);
      // narrower than a line, or one small layer with nothing above it: a slicer drops it
      let speck = piece.offset(-LINE / 2, 'Round').isEmpty();
      if (!speck && a < 0.5) speck = (mf.slice(z + LAYER) as CS).intersect(piece).area() < 0.01;
      (speck ? out.specks : out.islands).push({ z, area: a, x, y });
    };
    const nextRuns: typeof runs = [];
    if (!prev) {
      if (out.layers > 1) for (const piece of cs.decompose() as CS[]) island(piece); // a layer over an empty one
    } else {
      const sup = prev.offset(ALLOW, 'Round');
      const U = cs.subtract(sup);
      if (U.area() > 0.02) for (const piece of cs.decompose() as CS[]) {
        const pu = piece.subtract(sup);
        if (pu.area() < 0.02) continue;
        if (piece.intersect(prev).area() < 0.002) { island(piece); continue; }
        const held = piece.intersect(sup);
        for (const u of pu.decompose() as CS[]) {
          const a = u.area();
          if (a < 0.02) continue;
          const { reach: r, far } = reachInLayer(piece, held, u);
          const reach = r + ALLOW; // physical: from the edge of the wall below
          const [x, y] = far;
          // a sloped roof: a narrow band stepping out a little further every layer
          const chain = runs.filter((q) => !q.u.offset(0.3, 'Round').intersect(u).isEmpty());
          const acc = (chain.length ? Math.max(...chain.map((q) => q.acc)) : 0) + reach;
          const n = (chain.length ? Math.max(...chain.map((q) => q.n)) : 0) + 1;
          nextRuns.push({ u, acc, n });
          if (n >= 3 && r < 0.6 && (!out.slope || acc > out.slope.reach!)) out.slope = { z, area: a, reach: acc, x, y };
          const touch = u.offset(0.12, 'Round').intersect(held);
          if (heldAcross(touch, far, r)) { const span = 2 * reach; if (!out.bridge || span > out.bridge.span!) out.bridge = { z, area: a, span, x, y }; }
          else if (!out.cantilever || reach > out.cantilever.reach! || (reach > LIMITS.overhangWarn && a > out.cantilever.area && out.cantilever.reach! > LIMITS.overhangWarn)) out.cantilever = { z, area: a, reach, x, y };
        }
      }
      // walls thinner than a line (the opening removes them); tiny corner slivers do not count
      const lost = cs.subtract(cs.offset(-LINE / 2, 'Round').offset(LINE / 2 + 0.01, 'Round'));
      for (const t of lost.decompose() as CS[]) {
        const ta = t.area();
        if (ta < 0.12) continue;
        const [x, y] = centre(t);
        if (!out.thin) out.thin = { z0: z, z1: z, area: 0, x, y };
        out.thin.z1 = z; out.thin.area += ta * LAYER;
      }
      // slots narrower than a gap stays open (closing fills them)
      const shut = cs.offset(GAP / 2, 'Round').offset(-GAP / 2 - 0.01, 'Round').subtract(cs);
      for (const g of shut.decompose() as CS[]) {
        const ga = g.area();
        if (ga < 0.15) continue;
        if (!out.gaps || ga > out.gaps.area) { const [x, y] = centre(g); out.gaps = { z, area: ga, x, y }; }
      }
    }
    runs = nextRuns;
    prev = cs;
  }
  return out;
}

export type PrintVerdict = { status: 'ok' | 'warn' | 'bad'; value: string; detail: string; brief: string }; // brief: one line of facts

/**
 * What the layer check means for printing, in words. `moving`: the part has print-in-place movement (the shoe's
 * lever, the socket's latches), where a slot that prints closed is a real fault; elsewhere it just fills in.
 */
export function verdict(r: LayerReport, moving = false): PrintVerdict {
  const f = (v: number) => (Math.round(v * 10) / 10).toString();
  const L = LIMITS;
  const notes: string[] = [];
  let status = 'ok' as PrintVerdict['status'];
  let value = '';
  const bad = (v: string) => { status = 'bad'; if (!value || !/support|foot/.test(value)) value = v; };
  const warn = (v: string) => { if (status !== 'bad') { status = 'warn'; if (!value) value = v; } };
  if (r.islands.length) {
    bad('needs support');
    const i = r.islands[0];
    notes.push(`${r.islands.length} spot${r.islands.length > 1 ? 's start' : ' starts'} in mid-air (first at ${f(i.z)} mm up, ${f(i.area)} mm²): it needs support there`);
  }
  const tall = r.height > 5 && r.firstLayer < L.footBad * r.maxLayer;
  if (tall) { bad('tiny foot'); notes.push(`it stands on ${f(r.firstLayer)} mm² under a ${f(r.maxLayer)} mm² layer: it would be knocked over or need support`); }
  if (r.bridge) {
    const s = r.bridge.span!;
    if (s > L.bridgeBad) bad(`${f(s)} mm bridge`); else if (s > L.bridgeWarn) warn(`${f(s)} mm bridge`);
    notes.push(`longest bridge ${f(s)} mm at ${f(r.bridge.z)} mm up${s > L.bridgeWarn ? ' (it sags a little: the part fan and a slicer with bridge detection help)' : ''}`);
  }
  if (r.cantilever) {
    const c = r.cantilever;
    if (c.reach! > L.overhangBad || (c.reach! > L.overhangWarn && c.area > L.overhangBadArea)) bad('long overhang'); else if (c.reach! > L.overhangWarn) warn('long overhang');
    notes.push(`longest one-sided overhang ${f(c.reach!)} mm at ${f(c.z)} mm up`);
  }
  if (r.slope) {
    const s = r.slope.reach!;
    if (s > L.slopeBad) bad('flat roof'); else if (s > L.slopeWarn) warn('flat roof');
    notes.push(`a roof flatter than 45 degrees runs ${f(s)} mm out at ${f(r.slope.z)} mm up`);
  }
  if (r.specks.length) notes.push(`${r.specks.length} speck${r.specks.length > 1 ? 's' : ''} thinner than a line in mid-air (slicers leave ${r.specks.length > 1 ? 'them' : 'it'} out)`);
  if (r.thin) { if (r.thin.area > 3) warn('thin walls'); notes.push(`some walls are under ${LINE} mm (${f(r.thin.area)} mm³, ${f(r.thin.z0)} to ${f(r.thin.z1)} mm up): slicers without thin-wall detection leave them out, which is harmless here`); }
  if (r.gaps) { if (moving) warn('narrow slot'); notes.push(moving ? `a slot under ${GAP} mm at ${f(r.gaps.z)} mm up may print closed and stop a moving part` : `a slot under ${GAP} mm at ${f(r.gaps.z)} mm up will fill in (nothing moves there)`); }
  if (status === 'ok') value = 'no supports';
  const brief = [`${r.layers} layers`, r.islands.length ? `${r.islands.length} in mid-air` : '', tall ? 'tiny foot' : '', r.bridge ? `bridge ${f(r.bridge.span!)} mm` : '', r.cantilever ? `overhang ${f(r.cantilever.reach!)} mm` : '', r.slope ? `flat roof ${f(r.slope.reach!)} mm` : '', r.gaps && moving ? 'narrow slot' : '', r.thin && r.thin.area > 3 ? 'thin walls' : ''].filter(Boolean).join(' · ');
  return { status, value, brief, detail: `${r.layers} layers, ${f(r.firstLayer)} mm² on the bed. ${notes.length ? notes.join('; ') + '.' : 'Every layer sits on the one below.'}` };
}
