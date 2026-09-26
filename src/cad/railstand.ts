// Table stands for the rails. Sleepers run across every rail at both rail ends and at least every 200 mm between;
// each sleeper is a row of pieces: a block under each rail (an end block the rail end pushes into, or a saddle it
// rests in), spacer bars between the blocks, and outriggers past the outer rails where cables run or a lone rail
// needs a wider footprint. Spacers join the blocks with dovetails and carry cable combs where a cable street
// between two rails crosses them, one snap-in slot per cable, sized for it.
// Every piece is a (v, z) profile extruded along the rail, printed standing on that profile: no supports, no
// bridges, every load in the plane of the layers. Rack frame: u along the rails, v across, z up, rail crown
// underside at z = 0, table at z = -STAND.H.
import type { MeshData } from '../model/types';
import { basis, type M4 } from '../geom/mat';
import { extCh, poly, rect2, roundCS, toMesh, unionCS, circle2, type CS, type MF } from './kernel';

export const STAND = {
  H: 10, // rail crown above the table: room to run cables under the rails
  len: 10, // blocks, along the rail
  back: 3, // end block wall behind the rail end
  half: 21, // block half-width across the rail
  clr: 0.3, // rail pocket clearance
  spacerT: 4, // spacer bars and outriggers, along the rail
  floor: -8, // cable comb slot bottoms (rack z)
  every: 200, // longest unsupported rail span
  lip: 17.5, // TS35 lip edge
};
const DT = { z: -5.2, face: 2.4, inner: 3.4, depth: 4.2, fit: 0.12 }; // dovetail: half-widths at the block face and inside
const TOP = 9.8; // end block top (caps the lips)
const H = STAND.H;

const P = (pts: number[][]): CS => poly(pts as [number, number][], 'NonZero');

/** TS35 x 7.5 rail cross-section (y across, z up), crown underside at z = 0. */
export function railSection(): CS {
  return unionCS([rect2(-13.5, 0, 13.5, 1), rect2(-13.5, 0, -12.5, 7.5), rect2(12.5, 0, 13.5, 7.5), rect2(-17.5, 6.5, -12.5, 7.5), rect2(12.5, 6.5, 17.5, 7.5)]);
}

/** Bending stress (MPa) in one end block's cap over a rail lip when the rail end is lifted with F newtons
 * (hand calculation: each cap a cantilever from the side wall, loaded at mid-span, over the pocket depth). */
export function capStress(F: number): number {
  const arm = (STAND.lip + STAND.clr - (12.5 - STAND.clr)) / 2, b = STAND.len - STAND.back, h = TOP - (7.5 + STAND.clr);
  return (6 * (F / 2) * arm) / (b * h * h);
}

/** Second moment of area of the rail about its horizontal centroidal axis (mm^4), for the sag check. */
export function railI(): number {
  const parts = [[-13.5, 0, 13.5, 1], [-13.5, 1, -12.5, 6.5], [12.5, 1, 13.5, 6.5], [-17.5, 6.5, -12.5, 7.5], [12.5, 6.5, 17.5, 7.5]];
  const A = parts.map((q) => (q[2] - q[0]) * (q[3] - q[1])), zc = parts.reduce((s, q, i) => s + A[i] * (q[1] + q[3]) / 2, 0) / A.reduce((s, a) => s + a, 0);
  return parts.reduce((s, q, i) => s + ((q[2] - q[0]) * (q[3] - q[1]) ** 3) / 12 + A[i] * ((q[1] + q[3]) / 2 - zc) ** 2, 0);
}

function socketCut(side: 1 | -1): CS {
  const f = STAND.half + 0.01, d = STAND.half - DT.depth;
  return P([[side * f, DT.z - DT.face], [side * f, DT.z + DT.face], [side * d, DT.z + DT.inner], [side * d, DT.z - DT.inner]]);
}
/** Tail for a socket whose block face is at y = at, pointing toward -dir (into the block). */
function tail(at: number, dir: 1 | -1): CS {
  const w = (y: number) => DT.face + ((Math.abs(y - at)) / DT.depth) * (DT.inner - DT.face) - DT.fit;
  const tip = at - dir * (DT.depth - DT.fit), root = at + dir * 0.6;
  return roundCS(P([[root, DT.z - w(at)], [at, DT.z - w(at)], [tip, DT.z - w(tip)], [tip, DT.z + w(tip)], [at, DT.z + w(at)], [root, DT.z + w(at)]]), 0.3);
}

/** Lightening windows under a block's floor, legs outboard of them. */
const windows = (top: number) => unionCS([-1, 1].map((s) => roundCS(rect2(s > 0 ? 1.6 : -15.2, -H + 2, s > 0 ? 15.2 : -1.6, top), 1.6)));

function blockOutline(top: number, rTop: number): CS {
  const w = STAND.half;
  return roundCS(rect2(-w, -H, w, top), 0.8).intersect(roundCS(rect2(-w, -H - 5, w, top), rTop));
}

/** End block: the rail end slides 6 mm into a TS35-shaped pocket; crush ribs above the lips and under the crown
 * make it a light press fit. Print pose: the back wall on the bed, pocket mouth up (the top chamfer is its lead-in). */
export function endBlock(): MF {
  const base = blockOutline(TOP, 2.4).subtract(windows(-2.3)).subtract(socketCut(1)).subtract(socketCut(-1));
  const c = STAND.clr;
  const ribs = unionCS([circle2(-7, -c - 0.05, 0.45, 20), circle2(7, -c - 0.05, 0.45, 20), circle2(-15.5, 7.5 + c + 0.35, 0.45, 20), circle2(15.5, 7.5 + c + 0.35, 0.45, 20)]);
  const pocket = unionCS([railSection().offset(c, 'Miter'), rect2(-12.5 + c, 1 + c, 12.5 - c, TOP + 1), P([[-12.5 + c, TOP - 1.2], [12.5 - c, TOP - 1.2], [13.7, TOP + 0.01], [-13.7, TOP + 0.01]])]).subtract(ribs);
  const walled = roundCS(base.subtract(pocket), 0.3);
  const hat = rect2(-12.5 + c, 1 + c, 12.5 - c, TOP + 1).add(P([[-12.5 + c, TOP - 1.2], [12.5 - c, TOP - 1.2], [13.7, TOP + 0.01], [-13.7, TOP + 0.01]]));
  return unionCMF([extCh(roundCS(base.subtract(hat), 0.3), 0, STAND.back, 0, 0.4), extCh(walled, STAND.back, STAND.len, 0.6, 0)]);
}

/** Saddle: the rail's crown rests on it between two low cheeks (they stay under the dock shoes' jaws). */
export function saddle(): MF {
  const cheeks = unionCS([-1, 1].map((s) => roundCS(P([[s * 13.8, -0.5], [s * 15.6, -0.5], [s * 15.6, 1.6], [s * 14.8, 2.4], [s * 13.8, 2.4]]), 0.25)));
  const c = unionCS([blockOutline(0, 1.2), cheeks]).subtract(windows(-2.2)).subtract(socketCut(1)).subtract(socketCut(-1));
  return extCh(roundCS(c, 0.3), 0, STAND.len, 0.4, 0.4);
}

/** Comb slots at lane positions y (this piece's frame): round-bottomed, with snap lips above the cable and a
 * lead-in at the comb top (ct). */
function combCut(lanes: { y: number; d: number }[], ct: number): CS {
  return unionCS(lanes.map(({ y, d }) => {
    const r = d / 2 + 0.25, cz = STAND.floor + r, mouth = Math.max(1.4, d * 0.78) / 2;
    return unionCS([circle2(y, cz, r), rect2(y - r, cz, y + r, cz + r * 0.35), rect2(y - mouth, cz, y + mouth, ct + 1), P([[y - mouth, ct - 1.4], [y + mouth, ct - 1.4], [y + mouth + 1.0, ct + 0.01], [y - mouth - 1.0, ct + 0.01]])]);
  }));
}
export const combTop = (lanes: { d: number }[]) => (lanes.length ? Math.max(1, STAND.floor + Math.max(...lanes.map((l) => l.d)) + 0.5 + 1.6 + 1.2) : -1);

/** Ladder windows between two chords over [a, b]: rounded slots with 2 mm posts. */
function ladder(a: number, b: number, zb: number, zt: number): CS {
  const w = b - a;
  if (w < 8) return rect2(0, 0, 0, 0);
  const n = Math.max(1, Math.round((w + 2) / 14)), s = (w + 2) / n;
  return unionCS([...Array(n)].map((_, k) => roundCS(rect2(a + k * s, zb, a + (k + 1) * s - 2, zt), Math.min(1.6, (zt - zb) / 2 - 0.05))));
}

/**
 * Spacer bar from a block face at y = 21 to one at y = to - 21 (to = the other block's centre), or an outrigger
 * (to = null) that ends in a rounded foot at `reach`. Cable comb over the lanes if any.
 */
export function spacer(to: number | null, lanes: { y: number; d: number }[], reach = 40): MF {
  const w = STAND.half, y0 = w + 0.1, y1 = to != null ? to - w - 0.1 : reach;
  const ct = combTop(lanes), zTop = -2.5;
  const cy0 = lanes.length ? Math.max(y0, Math.min(...lanes.map((l) => l.y - l.d / 2)) - 3.2) : 0, cy1 = lanes.length ? Math.min(y1, Math.max(...lanes.map((l) => l.y + l.d / 2)) + 3.2) : 0;
  let body = roundCS(rect2(y0, -H, y1, zTop), 0.8);
  if (to == null) body = body.intersect(roundCS(rect2(y0 - 10, -H, y1, zTop), 4));
  const comb = lanes.length ? roundCS(rect2(cy0, -H, cy1, ct), 1.4) : null;
  // windows in the plain stretches only
  const spans: [number, number][] = [];
  const pad = 2.2;
  if (comb) { spans.push([y0 + pad, cy0 - pad], [cy1 + pad, y1 - (to == null ? 6 : pad)]); } else spans.push([y0 + pad, y1 - (to == null ? 6 : pad)]);
  const win = unionCS(spans.filter(([a, b]) => b - a > 8).map(([a, b]) => ladder(a, b, -H + 1.6, zTop - 1.6)));
  let c = unionCS([body.subtract(win), comb ?? rect2(0, 0, 0, 0), tail(w, 1)]);
  if (to != null) c = c.add(tail(to - w, -1));
  if (comb) c = c.subtract(combCut(lanes, ct));
  return extCh(roundCS(c, 0.25), 0, STAND.spacerT, 0.4, 0.4);
}

const unionCMF = (l: MF[]) => (l.length === 1 ? l[0] : l[0].add(l[1]));

// ---------------- layout ----------------
export interface StandRail { id: string; u0: number; u1: number; v: number }
export interface StandLane { street: number; y: number; d: number; u0: number; u1: number } // y: rack v of the lane
export type PieceKind = 'end' | 'saddle' | 'spacer' | 'outrigger';
export interface StandPiece { kind: PieceKind; key: string; station: number; M: M4; lanes: { y: number; d: number }[]; to: number | null; reach: number }
export interface StandPlan { stations: number[]; pieces: StandPiece[]; span: number; warnings: string[] }

/** Where the sleepers go and what each one is made of. `streets`: v of every cable street (outer ones included). */
export function planStands(rails: StandRail[], streets: number[], lanes: StandLane[]): StandPlan {
  const warnings: string[] = [];
  const pieces: StandPiece[] = [];
  if (!rails.length) return { stations: [], pieces, span: 0, warnings };
  const ends = [...new Set(rails.flatMap((r) => [Math.round(r.u0), Math.round(r.u1)]))].sort((a, b) => a - b);
  const stations: number[] = [];
  ends.forEach((u, i) => {
    if (i) {
      const gap = u - ends[i - 1], n = Math.ceil(gap / STAND.every - 1e-9);
      for (let k = 1; k < n; k++) stations.push(ends[i - 1] + (gap * k) / n);
    }
    stations.push(u);
  });
  const w = STAND.half, s3 = STAND.spacerT / 2;
  const lanesAt = (u: number, street: number, vFrom: number) => {
    const all = lanes.filter((l) => l.street === street);
    return all.some((l) => l.u0 - 2 <= u && u <= l.u1 + 2) ? all.map((l) => ({ y: +(l.y - vFrom).toFixed(2), d: l.d })) : [];
  };
  const key = (ls: { y: number; d: number }[]) => ls.map((l) => `${l.y}/${l.d}`).join(',');
  stations.forEach((u, si) => {
    const on = rails.filter((r) => r.u0 - 0.5 <= u && u <= r.u1 + 0.5).sort((a, b) => a.v - b.v);
    const isEnd = on.some((r) => Math.abs(u - r.u0) < 0.6 || Math.abs(u - r.u1) < 0.6);
    for (const r of on) {
      const kind: PieceKind = Math.abs(u - r.u0) < 0.6 ? 'end' : Math.abs(u - r.u1) < 0.6 ? 'end' : 'saddle';
      const M = kind === 'saddle' ? basis([0, 1, 0], [0, 0, 1], [1, 0, 0], [u - STAND.len / 2, r.v, 0])
        : Math.abs(u - r.u0) < 0.6 ? basis([0, 1, 0], [0, 0, 1], [1, 0, 0], [u - STAND.back, r.v, 0])
        : basis([0, -1, 0], [0, 0, 1], [-1, 0, 0], [u + STAND.back, r.v, 0]);
      pieces.push({ kind, key: kind, station: si, M, lanes: [], to: null, reach: 0 });
    }
    for (let i = 0; i + 1 < on.length; i++) {
      const a = on[i], b = on[i + 1], dv = b.v - a.v;
      if (dv < 2 * w + 6) { warnings.push(`Rails ${a.id.replace(/^r/, '')} and ${b.id.replace(/^r/, '')} are ${Math.round(dv)} mm apart: the stand blocks need ${2 * w + 6} mm, so they are not joined there.`); continue; }
      const st = streets.findIndex((v) => v > a.v + w && v < b.v - w);
      const ls = st >= 0 ? lanesAt(u, st, a.v) : [];
      // between the ends a saddle stands on its own under its rail: a spacer only goes in to carry a comb
      if (!ls.length && !isEnd) continue;
      if (ls.some((l) => l.y - l.d / 2 < w + 2.5 || l.y + l.d / 2 > dv - w - 2.5)) warnings.push(`Too many cables run between rails ${a.id.replace(/^r/, '')} and ${b.id.replace(/^r/, '')} for their comb; space the rails further apart.`);
      pieces.push({ kind: 'spacer', key: `spacer ${Math.round(dv * 10) / 10} ${key(ls)}`, station: si, M: basis([0, 1, 0], [0, 0, 1], [1, 0, 0], [u - s3, a.v, 0]), lanes: ls, to: dv, reach: 0 });
    }
    if (!on.length) return;
    // outriggers: to the outer streets when cables run there, or short feet under a lone rail
    for (const side of [-1, 1] as const) {
      const r = side > 0 ? on[on.length - 1] : on[0];
      const st = side > 0 ? streets.length - 1 : 0;
      const ls = streets.length && (side > 0 ? streets[st] > r.v : streets[st] < r.v) ? lanesAt(u, st, r.v).map((l) => ({ y: +(side * l.y).toFixed(2), d: l.d })) : [];
      if (!ls.length && (on.length > 1 || !isEnd)) continue;
      const reach = ls.length ? Math.max(...ls.map((l) => l.y + l.d / 2)) + 9 : w + 18;
      const M = side > 0 ? basis([0, 1, 0], [0, 0, 1], [1, 0, 0], [u - s3, r.v, 0]) : basis([0, -1, 0], [0, 0, 1], [-1, 0, 0], [u + s3, r.v, 0]);
      pieces.push({ kind: 'outrigger', key: `outrigger ${Math.round(reach * 10) / 10} ${key(ls)}`, station: si, M, lanes: ls, to: null, reach });
    }
  });
  let span = 0;
  for (const r of rails) {
    const st = [r.u0, ...stations.filter((u) => u > r.u0 + 0.5 && u < r.u1 - 0.5), r.u1];
    for (let i = 1; i < st.length; i++) span = Math.max(span, st[i] - st[i - 1]);
  }
  return { stations, pieces, span, warnings };
}

const meshCache = new Map<string, { mesh: MeshData; volume: number; size: [number, number, number] }>();
/** Print mesh for a piece (cached by its key). */
export function pieceMesh(pc: StandPiece) {
  let m = meshCache.get(pc.key);
  if (!m) {
    const mf = pc.kind === 'end' ? endBlock() : pc.kind === 'saddle' ? saddle() : spacer(pc.to, pc.lanes, pc.reach);
    // print frame: profile y -> X, z -> Y (shift so the part rests on z = 0 in its print pose: it already does)
    const bb = mf.boundingBox();
    m = { mesh: toMesh(mf), volume: mf.volume(), size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]] };
    meshCache.set(pc.key, m);
    if (meshCache.size > 64) meshCache.delete(meshCache.keys().next().value!);
  }
  return m;
}
