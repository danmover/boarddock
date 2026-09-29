// FEA of the DIN clip profile: release (pull tab), snap-on (lip pushed over the flange) and the travel stop.
// Linear, small-displacement: forces are scaled so the lip moves the required distance.
import type { Loop } from '../model/types';
import { assemble2D, elementStrain, meshPolygons, nearestNode, pcg, q6Element } from './fea2d';
import type { clipDims } from '../cad/dinclip';
import { GRIP } from '../cad/dockdims';

const RAIL = { flangeFront: 7.5 }; // (dinclip.ts RAIL: the flanges' front face)

type Dims = ReturnType<typeof clipDims>;

export interface ClipFeaCase {
  name: string;
  force: number; // N needed to reach the target
  target: string;
  peakStrain: number; // max principal strain (fraction)
  p99Strain: number;
  lipMove: [number, number]; // du, dv of the lip retention face at the target
  notes: string[];
}

export interface ClipFeaResult {
  cases: ClipFeaCase[];
  mesh: { h: number; elements: number; dofs: number };
  field: { x0: number; y0: number; h: number; nx: number; ny: number; elems: Int32Array; strain: Float32Array }; // release case strain map
  stopGap: number;
  lipAtStop: number;
  barMoveAtRelease: number;
  tongueMoveAtRelease: number;
}

export function clipFea(loops: Loop[], d: Dims, W: number, E: number, nu: number, h = 0.2, onProgress?: (s: string) => void): ClipFeaResult {
  const m = meshPolygons(loops, h);
  const { Ke, R } = q6Element(h, E, nu, W);
  const S = assemble2D(m, Ke);
  const fixed = new Uint8Array(S.n);
  // body clamped: everything above the leaf root, plus the back plate and top hook
  for (let i = 0; i < m.nNodes; i++) if (m.nodeXY[2 * i + 1] > -11.9) { fixed[2 * i] = 1; fixed[2 * i + 1] = 1; }
  const lip = nearestNode(m, d.uL, d.lipTop - 0.1);
  const bar = nearestNode(m, d.barEnd, d.barV[0]);
  const tongue = nearestNode(m, d.tongueU, -16.2);
  const cases: ClipFeaCase[] = [];

  const run = (name: string, sel: (x: number, y: number) => boolean, dir: [number, number], targetDv: number, target: string) => {
    const f = new Float64Array(S.n);
    const ids: number[] = [];
    for (let i = 0; i < m.nNodes; i++) if (!fixed[2 * i] && sel(m.nodeXY[2 * i], m.nodeXY[2 * i + 1])) ids.push(i);
    if (!ids.length) throw new Error(`no load nodes for ${name}`);
    for (const i of ids) { f[2 * i] = dir[0] / ids.length; f[2 * i + 1] = dir[1] / ids.length; }
    onProgress?.(`Solving ${name}`);
    const { u } = pcg(S, f, fixed, 1e-8);
    const k = targetDv / u[2 * lip + 1]; // scale to reach the lip travel
    const eps = elementStrain(m, u, R).map((e) => e * Math.abs(k));
    const sorted = Float64Array.from(eps).sort();
    let at = 0;
    eps.forEach((e, i) => { if (e > eps[at]) at = i; });
    const ge = m.elems[at];
    const where: [number, number] = [m.x0 + ((ge % m.nx) + 0.5) * h, m.y0 + (Math.floor(ge / m.nx) + 0.5) * h];
    cases.push({
      name, force: Math.abs(k), target, peakStrain: sorted[sorted.length - 1], p99Strain: sorted[Math.floor(sorted.length * 0.99)],
      lipMove: [u[2 * lip] * k, u[2 * lip + 1] * k], notes: [`peak at u=${where[0].toFixed(1)}, v=${where[1].toFixed(1)}`],
    });
    return { u: u.map((x) => x * k), eps };
  };

  const lipTravel = -(d.eL + 0.45); // lip must drop past the flange edge with 0.45 mm to spare
  const tgt = `lip moves ${(-lipTravel).toFixed(2)} mm down (engagement ${d.eL} mm)`;
  const rel = run('Release: pull tab down and forward (30 deg)', (x, y) => y < d.tabEnd + 0.01 && y > d.tabEnd - 3.2 && x > 9, [0.5, -0.866], lipTravel, tgt);
  const barMove = rel.u[2 * bar];
  const tongueMove = rel.u[2 * tongue];
  // straight down pull for comparison
  run('Release: pull tab towards you', (x, y) => y < d.tabEnd + 0.01 && y > d.tabEnd - 3.2 && x > 9, [1, 0], lipTravel, tgt);
  run('Release: pull tab straight down (back of the grip)', (x, y) => y < d.tabEnd + 0.01 && y > d.tabEnd - 3.2 && x < 8, [0, -1], lipTravel, tgt);
  // snap-on: flange edge pushes on the lip ramp (normal of the ramp)
  const a = [d.uL0, -17.7], b = [d.uL, d.lipTop];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nrm: [number, number] = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
  run('Snap-on: flange pushes the lip ramp', (x, y) => {
    const t = ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / (L * L);
    const px = a[0] + t * (b[0] - a[0]), py = a[1] + t * (b[1] - a[1]);
    return t > 0.15 && t < 0.95 && Math.hypot(x - px, y - py) < h * 0.8;
  }, nrm, -(d.eL + 0.1), `lip pushed ${(d.eL + 0.1).toFixed(2)} mm down to pass the flange edge`);
  // rail grip: the fork under the top wall, everything else held, its pad pushed back GRIP.pre by the wall
  onProgress?.('Solving the rail grip');
  const padV = d.gripWall + d.gripGap + GRIP.pre;
  const gfix = new Uint8Array(S.n);
  for (let i = 0; i < m.nNodes; i++) { const x = m.nodeXY[2 * i], y = m.nodeXY[2 * i + 1]; if (x > RAIL.flangeFront + 0.15 || y < d.gripWall - 9) { gfix[2 * i] = 1; gfix[2 * i + 1] = 1; } }
  const gf = new Float64Array(S.n);
  const gids: number[] = [];
  for (let i = 0; i < m.nNodes; i++) if (!gfix[2 * i] && m.nodeXY[2 * i + 1] > padV - h * 1.5 && Math.abs(m.nodeXY[2 * i] - GRIP.pad) < 0.35) gids.push(i);
  if (gids.length) {
    for (const i of gids) gf[2 * i + 1] = -1 / gids.length;
    const ug = pcg(S, gf, gfix, 1e-8).u;
    let dv = 0; for (const i of gids) dv += ug[2 * i + 1] / gids.length;
    const kg = 1 / Math.abs(dv), Fg = kg * GRIP.pre;
    // (peak and 99% over the fork alone: the rest of the clip is held)
    const eps = elementStrain(m, ug, R).map((e) => e * Fg);
    const inFork = (ge: number) => { const x = m.x0 + ((ge % m.nx) + 0.5) * h, y = m.y0 + (Math.floor(ge / m.nx) + 0.5) * h; return x < RAIL.flangeFront + 0.1 && y > d.gripWall - 9 && y < d.gripWall + 1; };
    const sorted = Float64Array.from(eps.filter((_, i) => inFork(m.elems[i]))).sort();
    const knock = (GRIP.pre + GRIP.stop) / GRIP.pre;
    cases.push({
      name: `Rail grip: pad pressed ${GRIP.pre} mm by the rail's top wall`, force: Fg, target: `holds the clip down on the top flange: it slides along the rail at about ${(2 * 0.3 * Fg).toFixed(1)} N (friction 0.3); ${kg.toFixed(0)} N per mm of pad travel; a knock that lifts the clip takes it to ${((sorted[sorted.length - 1] * knock) * 100).toFixed(2)}% before the tooth meets the wall`,
      peakStrain: sorted[sorted.length - 1], p99Strain: sorted[Math.floor(sorted.length * 0.99)], lipMove: [0, 0], notes: [`${(kg * 0.2).toFixed(1)} to ${(kg * 0.5).toFixed(1)} N for 0.2 to 0.5 mm (print and rail tolerance)`],
    });
  }
  // strain field of the release case for display
  const strain = Float32Array.from(rel.eps);
  return {
    cases,
    mesh: { h, elements: m.elems.length, dofs: S.n },
    field: { x0: m.x0, y0: m.y0, h, nx: m.nx, ny: m.ny, elems: m.elems, strain },
    stopGap: d.legU - d.barEnd,
    lipAtStop: (-lipTravel * (d.legU - d.barEnd)) / barMove,
    barMoveAtRelease: barMove,
    tongueMoveAtRelease: tongueMove,
  };
}
