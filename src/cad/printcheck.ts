// Printability, the way a slicer sees a part: cut it into 0.2 mm layers in its print pose and compare every layer
// with the one under it.
//  - island: a piece of a layer with nothing under it at all (it would print in mid-air: needs support)
//  - overhang: the part of a layer that reaches past the one below by more than a 45 degree slope allows; held on
//    one side it is a cantilever (droops), held on two or more it is a bridge (fine when short)
//  - thin: walls narrower than one 0.4 mm line; a slicer without thin-wall detection (Kiri:Moto as set up here)
//    leaves them out, OrcaSlicer and PrusaSlicer print them as single thin lines
//  - narrow gap: a slot narrower than 0.3 mm, which prints closed (bad for print-in-place parts)
// Pure geometry on manifold's slices; no slicer involved.
import type { MeshData } from '../model/types';
import { K, type CS } from './kernel';

export const LAYER = 0.2;
const ALLOW = 0.25; // how far a layer may step out over the one below (a little past 45 degrees at 0.2 mm)
const LINE = 0.4; // narrowest wall a slicer prints as a full line
const GAP = 0.3; // narrowest slot that stays open

export interface LayerIssue { z: number; area: number; reach?: number; span?: number; x?: number; y?: number }
/** A place where an overhang is part of the design (a snap finger over its slot), in the print frame. */
export interface Expected { box: [number, number, number, number]; why: string }
export interface LayerReport {
  layers: number;
  islands: LayerIssue[]; // need support
  cantilever: LayerIssue | null; // worst one-sided overhang (reach in mm)
  bridge: LayerIssue | null; // longest bridge (span in mm)
  thin: { z0: number; z1: number; area: number; x: number; y: number } | null; // layers with walls thinner than a line
  gaps: LayerIssue | null; // narrowest-gap region that would print closed
  expected: { why: string; reach: number }[]; // overhangs the design means to have
  firstLayer: number; // mm² on the bed
  height: number;
}

const bounds = (m: MeshData) => {
  let z0 = Infinity, z1 = -Infinity;
  for (let i = 2; i < m.pos.length; i += 3) { z0 = Math.min(z0, m.pos[i]); z1 = Math.max(z1, m.pos[i]); }
  return [z0, z1];
};
const centre = (c: CS) => { const b = c.bounds(); return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2]; };

/** Slice a part (print pose, bed at z = 0) and report what a slicer would struggle with. */
export function layerCheck(mesh: MeshData, expect: Expected[] = []): LayerReport | null {
  const W = K() as any;
  let mf: any;
  try {
    mf = W.Manifold.ofMesh(new W.Mesh({ numProp: 3, vertProperties: new Float32Array(mesh.pos), triVerts: new Uint32Array(mesh.idx) }));
    if (mf.status && mf.status() !== 'NoError' && mf.status() !== 0) return null;
  } catch {
    return null;
  }
  const [z0, z1] = bounds(mesh);
  const out: LayerReport = { layers: 0, islands: [], cantilever: null, bridge: null, thin: null, gaps: null, expected: [], firstLayer: 0, height: z1 - z0 };
  const known = (x: number, y: number) => expect.find((e) => x >= e.box[0] && x <= e.box[2] && y >= e.box[1] && y <= e.box[3]);
  let prev: CS | null = null;
  for (let z = z0 + LAYER / 2; z < z1; z += LAYER) {
    const cs: CS = mf.slice(z);
    const area = cs.area();
    if (area < 1e-4) { prev = null; continue; }
    out.layers++;
    if (!prev) {
      if (out.layers === 1) out.firstLayer = area;
      else out.islands.push({ z, area, x: centre(cs)[0], y: centre(cs)[1] }); // a layer over an empty one
    } else {
      const sup = prev.offset(ALLOW, 'Round');
      const U = cs.subtract(sup);
      if (U.area() > 0.02) for (const u of U.decompose() as CS[]) {
        const a = u.area();
        if (a < 0.02) continue;
        const touch = u.offset(0.12, 'Round').intersect(sup);
        const [x, y] = centre(u);
        if (touch.area() < 0.004) { out.islands.push({ z, area: a, x, y }); continue; }
        // how far the overhang reaches from what holds it: smallest d with (u - grown support) almost empty
        let lo = 0, hi = 30;
        for (let k = 0; k < 9; k++) { const d = (lo + hi) / 2; if (u.subtract(sup.offset(d, 'Round')).area() <= 0.03 * a) hi = d; else lo = d; }
        const reach = hi;
        const anchors = (touch.decompose() as CS[]).filter((t) => t.area() > 0.002).length;
        const k = known(x, y);
        if (k) { const e = out.expected.find((q) => q.why === k.why); if (!e) out.expected.push({ why: k.why, reach }); else e.reach = Math.max(e.reach, reach); continue; }
        if (anchors >= 2) { const span = 2 * reach; if (!out.bridge || span > out.bridge.span!) out.bridge = { z, area: a, span, x, y }; }
        else if (!out.cantilever || reach > out.cantilever.reach!) out.cantilever = { z, area: a, reach, x, y };
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
  const notes: string[] = [];
  let status = 'ok' as PrintVerdict['status'];
  if (r.islands.length) {
    status = 'bad';
    const i = r.islands[0];
    notes.push(`${r.islands.length} spot${r.islands.length > 1 ? 's start' : ' starts'} in mid-air (first at ${f(i.z)} mm up, ${f(i.area)} mm²): it needs support there`);
  }
  const warn = () => { if (status !== 'bad') status = 'warn'; };
  if (r.bridge) { if (r.bridge.span! > 20) warn(); notes.push(`longest bridge ${f(r.bridge.span!)} mm at ${f(r.bridge.z)} mm up${r.bridge.span! > 12 ? ' (bridges well with the part fan on; a slicer with bridge detection helps)' : ''}`); }
  if (r.cantilever) { if (r.cantilever.reach! > 2) warn(); notes.push(`longest one-sided overhang ${f(r.cantilever.reach!)} mm at ${f(r.cantilever.z)} mm up`); }
  for (const e of r.expected) notes.push(`${e.why} (${f(e.reach)} mm, by design)`);
  if (r.thin) { if (r.thin.area > 3) warn(); notes.push(`some walls are under ${LINE} mm (${f(r.thin.area)} mm³, ${f(r.thin.z0)} to ${f(r.thin.z1)} mm up): slicers without thin-wall detection leave them out, which is harmless here`); }
  if (r.gaps) { if (moving) warn(); notes.push(moving ? `a slot under ${GAP} mm at ${f(r.gaps.z)} mm up may print closed and stop a moving part` : `a slot under ${GAP} mm at ${f(r.gaps.z)} mm up will fill in (nothing moves there)`); }
  const value = r.islands.length ? 'needs support' : status === 'warn' ? (r.gaps && moving ? 'narrow slot' : r.thin && r.thin.area > 3 ? 'thin walls' : r.bridge && r.bridge.span! > 20 ? `${f(r.bridge.span!)} mm bridge` : 'long overhang') : 'no supports';
  const brief = [`${r.layers} layers`, r.islands.length ? `${r.islands.length} in mid-air` : '', r.bridge ? `bridge ${f(r.bridge.span!)} mm` : '', r.cantilever ? `overhang ${f(r.cantilever.reach!)} mm` : '', r.expected.length ? 'finger undersides by design' : '', r.gaps && moving ? 'narrow slot' : '', r.thin && r.thin.area > 3 ? 'thin walls' : ''].filter(Boolean).join(' · ');
  return { status, value, brief, detail: `${r.layers} layers, ${f(r.firstLayer)} mm² on the bed. ${notes.length ? notes.join('; ') + '.' : 'Every layer sits on the one below.'}` };
}
