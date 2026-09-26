// 2D FEA of the dock's springs: the socket latch (18 mm wide, plain spring) and the rail shoe (hinge split into two
// 7 mm segments, so 14 mm effective). Both are constant profiles, which is what a plane-stress model needs.
// Linear, small displacement: each case is solved for a unit load and scaled to the travel it must reach.
import type { Loop } from '../model/types';
import { assemble2D, elementStrain, meshPolygons, nearestNode, pcg, q6Element, type Mesh2D } from './fea2d';
import { NOSE_TIP } from '../cad/dockdims';

export interface DockFeaCase { part: 'latch' | 'shoe'; name: string; force: number; target: string; peakStrain: number; p99Strain: number; notes: string[] }
export interface DockField { name: string; x0: number; y0: number; h: number; nx: number; ny: number; elems: Int32Array; strain: Float32Array }
export interface DockFeaResult { cases: DockFeaCase[]; fields: DockField[]; mesh: { h: number; elements: number } }

const MU = 0.3; // plastic on plastic / steel
// strain limit by stiffness (PLA stiff and brittle, PETG / ABS / ASA tougher)
const allowFor = (E: number) => (E >= 3000 ? 0.015 : 0.02);
const S2 = Math.SQRT1_2;

function model(loops: Loop[], h: number, E: number, nu: number, t: number, fix: (x: number, y: number) => boolean) {
  const m = meshPolygons(loops, h);
  const { Ke, R } = q6Element(h, E, nu, t);
  const S = assemble2D(m, Ke);
  const fixed = new Uint8Array(S.n);
  for (let i = 0; i < m.nNodes; i++) if (fix(m.nodeXY[2 * i], m.nodeXY[2 * i + 1])) { fixed[2 * i] = 1; fixed[2 * i + 1] = 1; }
  return { m, S, R, fixed };
}

function solve(M: ReturnType<typeof model>, sel: (x: number, y: number) => boolean, dir: [number, number]) {
  const { m, S, fixed } = M;
  const f = new Float64Array(S.n);
  const ids: number[] = [];
  for (let i = 0; i < m.nNodes; i++) if (!(fixed[2 * i] && fixed[2 * i + 1]) && sel(m.nodeXY[2 * i], m.nodeXY[2 * i + 1])) ids.push(i);
  if (!ids.length) throw new Error('no load nodes');
  for (const i of ids) { f[2 * i] = dir[0] / ids.length; f[2 * i + 1] = dir[1] / ids.length; }
  return pcg(S, f, fixed, 1e-8).u; // unit total load (N)
}

function stats(m: Mesh2D, u: Float64Array, R: Float64Array, k: number) {
  const eps = elementStrain(m, u, R).map((e) => e * Math.abs(k));
  const sorted = Float64Array.from(eps).sort();
  let at = 0;
  eps.forEach((e, i) => { if (e > eps[at]) at = i; });
  const ge = m.elems[at];
  const where = `peak at y ${(m.x0 + ((ge % m.nx) + 0.5) * m.h).toFixed(1)}, z ${(m.y0 + (Math.floor(ge / m.nx) + 0.5) * m.h).toFixed(1)}`;
  return { eps, peak: sorted[sorted.length - 1], p99: sorted[Math.floor(sorted.length * 0.99)], where };
}

const field = (name: string, m: Mesh2D, h: number, eps: Float64Array): DockField => ({ name, x0: m.x0, y0: m.y0, h, nx: m.nx, ny: m.ny, elems: m.elems, strain: Float32Array.from(eps) });

/** latchLoops: latch + nose + stop post, (y, z) socket-local. shoeLoops: shoe profile, (y, z) hub. */
export function dockFea(latchLoops: Loop[], shoeLoops: Loop[], E: number, nu: number, h = 0.1, onProgress?: (s: string) => void): DockFeaResult {
  const cases: DockFeaCase[] = [];
  const fields: DockField[] = [];
  let elements = 0;

  // ---- socket latch: root clamped at the anchor slot; the stop post is fixed ----
  onProgress?.('Meshing the latch');
  const L = model(latchLoops, h, E, nu, 18, (x, y) => y < -20.2 || x > 9.05);
  elements += L.m.elems.length;
  // the nose's tip and its 45 degree lead-in (dockdims: NOSE_TIP)
  const tip = nearestNode(L.m, NOSE_TIP + 0.05, -7.2), ramp = nearestNode(L.m, 7.4, -1.7);
  onProgress?.('Solving: tongue pushes the latch open');
  let u = solve(L, (x, y) => x < NOSE_TIP + 1.45 && y > -6.7 && y < -5.1 && y - x > -6.55 - NOSE_TIP - 0.25, [S2, -S2]);
  let k = 1.3 / u[2 * tip];
  let s = stats(L.m, u, L.R, k);
  const latLat = k * S2;
  cases.push({ part: 'latch', name: 'Latch: holder pushed in (nose out 1.3 mm)', force: latLat, target: 'nose moves 1.3 mm to let the tongue past', peakStrain: s.peak, p99Strain: s.p99, notes: [`push-in about ${(latLat * (1 + MU) / (1 - MU)).toFixed(1)} N through the 45° lead-in (friction 0.3)`] });
  onProgress?.('Solving: button wedges the latch open');
  u = solve(L, (x, y) => x > 6.55 && x < 8.25 && y > -2.5 && Math.abs(y - (x - 9.0)) < h * 1.2, [S2, -S2]);
  k = 1.15 / u[2 * tip];
  s = stats(L.m, u, L.R, k);
  const fy = k * S2;
  const travel = u[2 * ramp] * k;
  cases.push({ part: 'latch', name: 'Latch: button pressed (nose clears the groove)', force: fy * (1 + Math.SQRT2 * MU), target: 'nose moves 1.15 mm out of the tongue groove', peakStrain: s.peak, p99Strain: s.p99, notes: [`button travel to release ${travel.toFixed(2)} mm of the 3.1 mm stroke`, `${fy.toFixed(1)} N without friction`] });
  fields.push(field('Latch, button pressed', L.m, h, s.eps));

  // ---- rail shoe: body clamped, the jaw hangs on the hinge leaf ----
  const hs = Math.max(h, 0.06);
  onProgress?.('Meshing the rail shoe');
  const Sh = model(shoeLoops, hs, E, nu, 14, (x, y) => (x < 14.6 && y > 7.0) || (y > 21.0 && x < 17.95));
  elements += Sh.m.elems.length;
  const lip = nearestNode(Sh.m, 16.3, 6.0), hookAt = nearestNode(Sh.m, 21.85, 32.3), post = nearestNode(Sh.m, 19.95, 21.3);
  onProgress?.('Solving: release lever pressed');
  // the lever's hook pulls the post toward the socket over z 30.8..33.8 (lever taken as rigid, turning on its pin)
  u = solve(Sh, (x, y) => x > 21.6 && x < 22.0 && y > 30.8 && y < 33.8, [-1, 0]);
  k = 1.7 / u[2 * lip];
  s = stats(Sh.m, u, Sh.R, k);
  const stopAt = (2.0 / Math.abs(u[2 * post] * k)) * 1.7; // lip travel when the post meets the body shelf (2.0 mm gap, SHOE_LEVER.stopGap)
  const hookTravel = Math.abs(u[2 * hookAt] * k);
  // lever: pivot (13.4, 39.2), hook contact 6.9 below it and 8.9 outboard, pad centre 13.6 outboard
  const Fc = Math.abs(k), padF = (Fc * (6.9 + MU * 8.9)) / 13.6, padTravel = (hookTravel * 13.6) / 6.9;
  cases.push({ part: 'shoe', name: 'Rail shoe: release lever pressed down (jaw off the flange)', force: padF, target: 'jaw lip moves 1.7 mm clear of the rail flange', peakStrain: s.peak, p99Strain: s.p99, notes: [`pad travel ${padTravel.toFixed(1)} mm`, `${Fc.toFixed(1)} N on the post from the hook, friction 0.3 at the hook`, `stop engages at ${stopAt.toFixed(2)} mm lip travel`, s.where] });
  fields.push(field('Rail shoe, lever pressed', Sh.m, hs, s.eps));
  onProgress?.('Solving: clipping onto the rail');
  const a = [15.8, 6.0], b = [17.7, 3.9];
  const Lab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nrm: [number, number] = [(a[1] - b[1]) / Lab, (b[0] - a[0]) / Lab];
  u = solve(Sh, (x, y) => {
    const t = ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / (Lab * Lab);
    const px = a[0] + t * (b[0] - a[0]), py = a[1] + t * (b[1] - a[1]);
    return t > 0.1 && t < 0.9 && Math.hypot(x - px, y - py) < hs * 1.2;
  }, [Math.abs(nrm[0]), Math.abs(nrm[1])]);
  k = 1.8 / u[2 * lip];
  s = stats(Sh.m, u, Sh.R, k);
  cases.push({ part: 'shoe', name: 'Rail shoe: pressed onto the rail', force: Math.abs(k), target: 'flange edge pushes the jaw 1.8 mm open', peakStrain: s.peak, p99Strain: s.p99, notes: [s.where] });
  onProgress?.('Solving: dock pulled off the wall');
  // the flange pushes the lip toward the wall; friction on the flange resists the lip sliding out.
  // Superpose the normal and friction parts to find the friction the hold relies on.
  const lipTop = (x: number, y: number) => x > 16.2 && x < 17.4 && Math.abs(y - 6.2) < hs * 1.2;
  const un = solve(Sh, lipTop, [0, -1]), uf = solve(Sh, lipTop, [-1, 0]);
  const dn = un[2 * lip] * 100, df = uf[2 * lip] * 100; // lip opening per 100 N normal, per 100 N friction
  const muCrit = df < 0 ? Math.max(0, -dn / df) : Infinity;
  const letGo = dn > 0 ? (1.7 / dn) * 100 : Infinity;
  // strain while friction holds: lip pinned sideways, 100 N toward the wall
  const lockFix = Sh.fixed.slice();
  for (let i = 0; i < Sh.m.nNodes; i++) if (lipTop(Sh.m.nodeXY[2 * i], Sh.m.nodeXY[2 * i + 1])) lockFix[2 * i] = 1;
  const u3 = solve({ ...Sh, fixed: lockFix }, lipTop, [0, -1]);
  s = stats(Sh.m, u3, Sh.R, 100);
  cases.push({ part: 'shoe', name: 'Rail shoe: 100 N pull away from the wall', force: 100, target: letGo > 1000 ? `holds without relying on friction (jaw opens ${Math.abs(dn).toFixed(3)} mm per 100 N)` : muCrit <= MU ? `holds while friction on the flange exceeds ${muCrit.toFixed(2)} (PETG on steel: about 0.3 to 0.5)` : `the jaw opens: needs friction above ${muCrit.toFixed(2)} to hold`, peakStrain: s.peak, p99Strain: s.p99, notes: [`hinge reaches the strain limit at about ${((allowFor(E) / s.peak) * 100).toFixed(0)} N`, letGo > 1000 ? 'the pull runs straight down the hinge leaf: it cannot pry the jaw open, friction or not' : `without friction the jaw would let go at about ${letGo.toFixed(0)} N`] });
  return { cases, fields, mesh: { h, elements } };
}
